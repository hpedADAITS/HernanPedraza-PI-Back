#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Re-fingerprint existing audio tracks after the bitrate / frequency-range
 * change (32 kHz / 14 kHz -> 16 kHz / 7 kHz).
 *
 * Hashes generated at the old sample rate are NOT compatible with the new one
 * (the constellation algorithm quantises peak frequencies against
 * UPPER_FREQUENCY, so the bin numbers change when either rate changes). The
 * `AudioFingerprintModel` and `AudioFingerprintHashModel` documents for every
 * existing track must therefore be regenerated.
 *
 * Because the original WAV is not persisted after upload, this script looks
 * for each track's audio file in a directory on disk. The default convention
 * is `<audioDir>/<trackId>.wav`. A side-car manifest file can override this
 * (`<audioDir>/manifest.json` mapping trackId -> relative path).
 *
 *   node scripts/refingerprint-audio-tracks.js --audio-dir ./audio-archive --dry-run
 *   node scripts/refingerprint-audio-tracks.js --audio-dir ./audio-archive
 *   node scripts/refingerprint-audio-tracks.js --clear-missing
 *
 * The `--clear-missing` flag deletes the existing fingerprint documents for
 * any track whose audio file cannot be found. The track itself is left in
 * place (with `hashesCount` and `pointsCount` zeroed) and the DJ can re-upload
 * it. Without `--clear-missing`, missing tracks are left untouched and logged.
 */

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const config = require("../src/config");
const {
  AudioTrackModel,
  AudioFingerprintModel,
  AudioFingerprintHashModel,
  connectMongo,
} = require("../src/models/schema");
const { fingerprintWavStreamed } = require("../src/services/audio-recognition/fingerprint");

const INSERT_CHUNK = 5000;

function parseArgs(argv) {
  const out = { audioDir: null, dryRun: false, clearMissing: false, manifest: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--clear-missing") out.clearMissing = true;
    else if (arg === "--audio-dir") out.audioDir = argv[++i];
    else if (arg === "--manifest") out.manifest = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/refingerprint-audio-tracks.js " +
          "[--audio-dir <dir>] [--manifest <file>] [--dry-run] [--clear-missing]"
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return out;
}

function loadManifest(manifestPath) {
  if (!manifestPath) return null;
  const resolved = path.resolve(manifestPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Manifest file not found: ${resolved}`);
  }
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Manifest must be a JSON object mapping trackId -> relative path");
  }
  return parsed;
}

function findAudioFile(track, opts) {
  if (opts.manifest) {
    const entry = opts.manifest[String(track._id)];
    if (!entry) return null;
    const candidate = path.resolve(opts.audioDir || process.cwd(), entry);
    return fs.existsSync(candidate) ? candidate : null;
  }
  if (!opts.audioDir) return null;
  const candidate = path.join(path.resolve(opts.audioDir), `${track._id}.wav`);
  return fs.existsSync(candidate) ? candidate : null;
}

async function refingerprintTrack(track, audioPath, dryRun) {
  const trackId = track._id;
  const eventObjectId = track.eventId;

  if (dryRun) {
    return { hashesCount: 0, capped: false, pointsCount: 0, duration: 0, sampleRate: 0 };
  }

  await AudioFingerprintHashModel.deleteMany({ trackId });
  await AudioFingerprintModel.deleteMany({ trackId });

  // Seed the bundled fingerprint document with an empty hashes array so the
  // streaming onBatch callback can do a simple $push without an upsert.
  await AudioFingerprintModel.create({
    eventId: eventObjectId,
    trackId,
    sampleRate: track.sampleRate || 0,
    duration: track.duration || 0,
    pointsCount: 0,
    hashesCount: 0,
    hashes: [],
  });

  const totals = await fingerprintWavStreamed(audioPath, {
    batchSize: INSERT_CHUNK,
    onBatch: async (batch) => {
      if (!batch.length) return;
      await AudioFingerprintModel.updateOne(
        { trackId },
        { $push: { hashes: { $each: batch.map(({ hash, time }) => ({ h: hash, t: time })) } } }
      );
      await AudioFingerprintHashModel.insertMany(
        batch.map(({ hash, time }) => ({
          eventId: eventObjectId,
          trackId,
          hash,
          sourceTime: time,
        })),
        { ordered: false }
      );
    },
  });

  await Promise.all([
    AudioFingerprintModel.updateOne(
      { trackId },
      {
        $set: {
          sampleRate: totals.sampleRate,
          duration: totals.duration,
          pointsCount: totals.pointsCount,
          hashesCount: totals.hashesCount,
        },
      }
    ),
    AudioTrackModel.updateOne(
      { _id: trackId },
      {
        $set: {
          sampleRate: totals.sampleRate,
          duration: totals.duration,
          pointsCount: totals.pointsCount,
          hashesCount: totals.hashesCount,
        },
      }
    ),
  ]);

  return totals;
}

async function clearTrackFingerprints(track) {
  const trackId = track._id;
  await AudioFingerprintHashModel.deleteMany({ trackId });
  await AudioFingerprintModel.deleteMany({ trackId });
  await AudioTrackModel.updateOne(
    { _id: trackId },
    { $set: { pointsCount: 0, hashesCount: 0 } }
  );
}

async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.audioDir && !opts.manifest && !opts.clearMissing) {
    console.error(
      "Nothing to do. Pass --audio-dir <dir> (with optional --manifest) to re-fingerprint, " +
        "or --clear-missing to drop old fingerprints so DJS can re-upload."
    );
    process.exit(2);
  }

  await connectMongo();
  console.log(`Connected to MongoDB (env=${config.env})`);

  const tracks = await AudioTrackModel.find({}).lean();
  console.log(`Found ${tracks.length} audio track(s) to process.`);

  let refingerprinted = 0;
  let missing = 0;
  let cleared = 0;
  let failed = 0;

  for (const track of tracks) {
    const audioPath = findAudioFile(track, opts);

    if (!audioPath) {
      missing += 1;
      if (opts.clearMissing) {
        if (!opts.dryRun) {
          try {
            await clearTrackFingerprints(track);
            cleared += 1;
          } catch (err) {
            failed += 1;
            console.error(`  [FAIL] clear track ${track._id}: ${err.message}`);
            continue;
          }
        }
        console.log(`  [CLEAR] ${track._id}  (${track.title} - ${track.artist})`);
      } else {
        console.log(
          `  [MISSING] ${track._id}  (${track.title} - ${track.artist})  ` +
            "-> re-upload required"
        );
      }
      continue;
    }

    try {
      const result = await refingerprintTrack(track, audioPath, opts.dryRun);
      refingerprinted += 1;
      const summary = opts.dryRun
        ? "dry-run"
        : `${result.hashesCount} hashes${result.capped ? " (capped)" : ""}`;
      console.log(`  [OK] ${track._id}  (${track.title} - ${track.artist})  -> ${summary}`);
    } catch (err) {
      failed += 1;
      console.error(`  [FAIL] ${track._id}  (${track.title} - ${track.artist}): ${err.message}`);
    }
  }

  console.log("");
  console.log("Summary:");
  console.log(`  refingerprinted : ${refingerprinted}`);
  console.log(`  missing         : ${missing}`);
  if (opts.clearMissing) console.log(`  cleared         : ${cleared}`);
  console.log(`  failed          : ${failed}`);
  if (opts.dryRun) console.log("  (dry-run: no changes written)");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
