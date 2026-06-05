"use strict";

const fs = require("fs");
const { createConstellation } = require("./constellation");
const { createHashes } = require("./hashes");
const {
  readWavNormalized,
  parseWavHeader,
  decodePcm,
  resampleLinear,
  TARGET_SAMPLE_RATE,
} = require("./wav");
const { StreamingFingerprinter } = require("./streaming");

const STREAM_READ_CHUNK_BYTES = 64 * 1024;
const MAX_FINGERPRINT_HASHES = 80_000;

async function fingerprintWav(file, songId = null) {
  const { sampleRate, samples, originalSampleRate } = await readWavNormalized(
    file,
    TARGET_SAMPLE_RATE
  );

  const constellation = createConstellation(samples, sampleRate);

  const hashes = [...createHashes(constellation, songId)].map(
    ([hash, [time, id]]) => ({
      hash,
      time,
      songId: id,
    })
  );

  return {
    file,
    sampleRate,
    originalSampleRate,
    duration: samples.length / sampleRate,
    points: constellation.length,
    hashes,
  };
}

async function fingerprintWavStreamed(file, options = {}) {
  const {
    onBatch = null,
    batchSize = 5000,
    targetSampleRate = TARGET_SAMPLE_RATE,
    sourceSampleRate = null,
  } = options;

  const { fmt, dataOffset, dataSize } = await parseWavHeader(file);
  const originalSampleRate = sourceSampleRate || fmt.sampleRate;
  const bytesPerFrame = (fmt.bits >>> 3) * fmt.channels;
  const totalFrames = Math.floor(dataSize / bytesPerFrame);
  const duration = totalFrames / fmt.sampleRate;

  const fingerprinter = new StreamingFingerprinter(targetSampleRate);

  let hashesCount = 0;
  let pointsCount = 0;
  let pending = [];

  const flushFullBatches = async () => {
    while (pending.length >= batchSize) {
      const slice = pending.splice(0, batchSize);
      hashesCount += slice.length;
      if (onBatch) await onBatch(slice);
    }
  };

  const fd = await fs.promises.open(file, "r");
  try {
    let offset = dataOffset;
    const end = dataOffset + dataSize;
    while (offset < end) {
      const bytesToRead = Math.min(STREAM_READ_CHUNK_BYTES, end - offset);
      const buf = Buffer.alloc(bytesToRead);
      await fd.read(buf, 0, bytesToRead, offset);
      offset += bytesToRead;

      const decoded = decodePcm(buf, fmt);
      const resampled = resampleLinear(decoded, originalSampleRate, targetSampleRate);

      const emitted = fingerprinter.process(resampled);
      if (emitted.length) {
        pending.push(...emitted);
        await flushFullBatches();
      }
    }
  } finally {
    await fd.close();
  }

  const tail = fingerprinter.flush();
  if (tail.length) pending.push(...tail);
  hashesCount += pending.length;
  if (pending.length && onBatch) {
    const finalBatch = pending;
    pending = [];
    await onBatch(finalBatch);
  }

  pointsCount = fingerprinter.points.length;
  const capped = hashesCount >= MAX_FINGERPRINT_HASHES;

  return {
    sampleRate: targetSampleRate,
    originalSampleRate,
    duration,
    pointsCount,
    hashesCount,
    capped,
  };
}

function saveFingerprint(fingerprint, file) {
  fs.writeFileSync(file, JSON.stringify(fingerprint, null, 2));
}

function loadFingerprint(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function hashMapFromFingerprint(fingerprint) {
  return new Map(
    fingerprint.hashes.map(({ hash, time, songId = null }) => [
      hash,
      [time, songId],
    ])
  );
}

module.exports = {
  fingerprintWav,
  fingerprintWavStreamed,
  hashMapFromFingerprint,
  loadFingerprint,
  saveFingerprint,
  MAX_FINGERPRINT_HASHES,
};
