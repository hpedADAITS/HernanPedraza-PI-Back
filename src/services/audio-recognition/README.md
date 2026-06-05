# Audio Recognition

Shazam-style audio fingerprinting implemented in pure Node.js. No native
dependencies — no `fpcalc`, `chromaprint`, or `acoustid` binaries. The
algorithm is a Node port of the one described in Avery Li-Chun Wang's 2003
paper "An Industrial-Strength Audio Search Algorithm" (see `Back/README.md`
for the original attribution).

## Pipeline

```
WAV file ──► wav.js ──► Float64 PCM @ 16 kHz mono
                            │
                            ▼
                  constellation.js
                  (FFT + spectral peak selection)
                            │
                            ▼
                       points: [time, freq] quantized to 16-bit
                            │
                            ▼
                        hashes.js
                  (pair-wise hashing of nearby points)
                            │
                            ▼
                  hashes: { hash, sourceTime }
                            │
                ┌───────────┴────────────┐
                ▼                        ▼
         fingerprint.js           streaming.js
         (one-shot, for upload)    (incremental, for live mic)
                │                        │
                ▼                        ▼
          AudioFingerprintModel    sharedRamMatcher (in-memory index)
                │                        │
                └───────────┬────────────┘
                            ▼
                     ram-matcher.js  (both REST and live socket paths)
```

## File map

| File | Role |
|------|------|
| `wav.js` | WAV header parser + multi-bit-depth PCM decoder + linear resampler |
| `fft.js` | Radix-2 Cooley–Tukey FFT (pure JS) |
| `constellation.js` | Per-window spectral peak selection (Shazam-style) |
| `hashes.js` | Pair-wise hashing of constellation points into 32-bit integers |
| `fingerprint.js` | `fingerprintWav` (one-shot, used by tests) and `fingerprintWavStreamed` (production, bounded memory) |
| `streaming.js` | Incremental fingerprinter + `LiveMatcher` for live mic input |
| `ram-matcher.js` | Hash matcher. Loads `AudioFingerprintModel` into RAM on first match; reused by REST and live socket paths. |

## Tunable constants

These are the levers for trading off accuracy, memory and CPU. They are
defined at the top of each module and (deliberately) not centralised.

### Constellation (`constellation.js`)

| Constant | Value | Effect |
|----------|-------|--------|
| `WINDOW_SECONDS` | `0.5` | Frame size in seconds. Larger windows improve frequency resolution but reduce time resolution. |
| `PEAKS_PER_WINDOW` | `15` | Number of spectral peaks kept per frame. More peaks → more hashes → higher match scores but more storage. |
| `MIN_PEAK_DISTANCE` | `200` | Minimum distance (in FFT bins) between two kept peaks. Prevents redundant nearby peaks. |
| `UPPER_FREQUENCY` | `7000` | Upper frequency bound (Hz) used to quantise peak frequencies into a 16-bit integer. Peaks above this can overflow the 16-bit range — see [Limitations](#limitations). |

### Hashing (`hashes.js`)

| Constant | Value | Effect |
|----------|-------|--------|
| `FREQUENCY_BITS` | `10` | Bits used per frequency in a hash. Gives 1024 frequency bins. |
| `FAN_OUT` | `100` | Maximum number of *future* points a point is paired with. Larger FAN_OUT → more hashes per anchor point but slower. |
| `MAX_UINT16` | `65535` | Input range for the (already-quantised) frequency; 16-bit packing. |

### Matcher (`ram-matcher.js`)

| Constant | Value | Effect |
|----------|-------|--------|
| `MAX_MATCH_HASHES` | `1200` | Cap on query hashes. Bounds DB round-trips and CPU per match. |
| `MIN_MATCH_SCORE` | `4` | Absolute score threshold. Matches below this are rejected outright. Prevents noise/typos from producing matches. |

### RAM matcher memory budget (`ram-matcher.js`)

Sized for the Render free tier (512 MB / 0.1 vCPU). Caps below keep each
`AudioFingerprintModel.hashes` JSON document under MongoDB's 16 MB hard
limit, and keep the in-memory index bounded.

| Constant | Value | Effect |
|----------|-------|--------|
| `MAX_TRACK_HASHES` | `100_000` | Tracks with more hashes are skipped on load. ~3-7 min of audio. |
| `MAX_INDEXED_HASHES_PER_EVENT` | `200_000` | Soft cap (logged). ~6 MB JSON, ~10 MB in-memory. |
| `MAX_CACHED_EVENTS` | `2` | LRU eviction. Two events held in RAM at once ≈ 20 MB. |

### Streaming (`streaming.js`)

| Constant | Value | Effect |
|----------|-------|--------|
| `MAX_POINTS_MEMORY_BYTES` | `5 MB` | Soft cap on the constellation size. The most recent 70 % of points are kept. |
| `MAX_HASH_ENTRIES` | `100_000` | Soft cap on the hash map. Same LRU-style truncation. |
| `MAX_BUFFER_SAMPLES` | `80_000` | Backpressure on the live path. If the input buffer exceeds 5 seconds worth of samples, oldest samples are dropped. |
| `MAX_AUDIO_SECONDS` (in `fingerprint.js`) | `600` | Reject uploads > 10 min at the source. |

## One matching path

Both REST and live socket use the same matcher. The matcher's index is
loaded from `AudioFingerprintModel.hashes` (the bundled per-track array
on the document) on first match per event and held in RAM with LRU
eviction.

| Path | When used | Storage |
|------|-----------|---------|
| `ram-matcher.js` (REST `matchHashes`) | DJ uploads a fingerprint, then queries it via `POST /events/:id/audio-match` | Reads from `AudioFingerprintModel` |
| `ram-matcher.js` (live socket) | Phone-microphone streams PCM chunks over Socket.IO; needs < 100 ms response | Same — preloaded into `sharedRamMatcher` |

If you change the matching logic, change it in `ram-matcher.js` only.

## Limitations

These are the false-positive and false-negative behaviours the algorithm
exhibits today. They are pinned by `test/unit/audio-recognition-quality.test.js`
and `test/unit/matchers.test.js`.

### False negatives (the algorithm will miss these)

- **Digital silence** produces zero constellation points and therefore
  zero hashes. A silent recording matches nothing by design.
- **Single-frequency tones** (e.g. test signals) produce very few
  constellation points and even fewer hashes. A 3-second pure tone at
  440 Hz produces well under 2 000 hashes — statistically insufficient
  to align with any real track's fingerprint.
- **Audio shorter than ~2 seconds** is unlikely to produce enough hashes
  to pass `MIN_MATCH_SCORE = 4`.
- **Reverberant / noisy phone audio** matches the original clean track
  in the existing integration test (`phone_stream_reverb_32kHz.wav`)
  with a score well above the threshold.

### False positives (the algorithm is guarded against these)

- **Two unrelated tracks** with disjoint frequency content share
  essentially zero hashes. The cross-track test
  (`audio-recognition-quality.test.js → does not confuse two unrelated
  synthetic signals`) allows up to 5 random hash collisions.
- **Random noise inputs** (no real constellation) produce no confident
  match because hash collision counts stay below `MIN_MATCH_SCORE`.

### Algorithmic caveats (current behaviour, not necessarily desirable)

- **Constellation overflow above UPPER_FREQUENCY.** When a peak lands
  in a bin above 7 kHz (i.e. between 7 kHz and the 8 kHz Nyquist at
  16 kHz sample rate), the quantised frequency exceeds 65 535. This
  spills into the bits reserved for the time delta in `hashPair`, which
  can corrupt the resulting hash. The test
  `documents the constellation overflow above UPPER_FREQUENCY` pins
  the current upper bound (~74 897). The fix is to filter high-frequency
  peaks in `constellation.js` before quantisation; left for a follow-up.
- **Linear resampling.** `wav.js → resampleLinear` uses linear
  interpolation. Higher-quality resampling (sinc) would slightly improve
  hash stability on lower-rate sources.
- **No pitch/time-stretch compensation.** A track played at a different
  speed or pitch will not match. The constellation and hash scheme are
  intentionally time/frequency-quantised to be tolerant of small
  variations, but not large ones.

## How to run the tests

```bash
cd Back
npm test -- test/unit/audio-recognition.test.js              # baseline fingerprinting
npm test -- test/unit/audio-quantization.test.js             # uint16 vs float32
npm test -- test/unit/audio-recognition-quality.test.js      # FP/FN edge cases
npm test -- test/unit/matchers.test.js                       # matcher confidence logic
npm test -- test/unit/audio-recognition-memory.test.js       # streaming memory profile
npm test -- test/integration/audio-tracks.integration.test.js  # REST + DB
```

The `matchers.test.js` file spins up an in-memory MongoDB
(`mongodb-memory-server`) — it is not a mock and uses the real matcher
implementations. Allow ~10 s for the first run while MongoDB downloads.

## Memory profile (production upload path)

The DJ upload path goes through `fingerprintWavStreamed` in
`fingerprint.js`, which is bounded-memory:

- Reads the WAV file in 64 KB chunks via `parseWavHeader` + `decodePcm` + `resampleLinear`.
- Feeds each chunk to a `StreamingFingerprinter` that keeps a sliding
  window of constellation points and hashes (capped at ~5 MB and
  100 000 entries respectively via `streaming.js`).
- Emits hashes in batches of `batchSize` (default 5 000) via the
  `onBatch` callback. The `audio-tracks.service.js` `createTrack`
  handler uses this callback to `$push` hashes into the bundled
  `AudioFingerprintModel`.

Peak heap usage is **O(1) in the audio length**: a 5-minute synthetic
WAV uses roughly the same memory as a 30-second one. The memory test
(`test/unit/audio-recognition-memory.test.js`) pins this with a
50 MB ceiling for a 5-minute input.

## Bitrate and frequency range (16 kHz / 7 kHz)

The whole pipeline is hard-wired to a single set of audio parameters:

- `TARGET_SAMPLE_RATE = 16000` Hz (mono) — defined in `wav.js`. Every input
  WAV is linear-resampled to this rate before fingerprinting. The live mic
  resamples the `AudioContext` rate to the same target on the wire
  (`Front/src/services/audio/micStream.ts`), and the DJ upload path
  (`Front/src/services/audio/ffmpegWav.ts`) transcodes the browser-side
  input to 16 kHz mono before sending it to the backend, so the backend
  no longer has to upsample.
- `UPPER_FREQUENCY = 7000` Hz — defined in `constellation.js`. Peak
  frequencies are quantised into a uint16 by `(freqHz / UPPER_FREQUENCY) *
  65535`, so the entire analysis band is 0–7 kHz. This is the Nyquist
  boundary of 16 kHz minus a 1 kHz guard band.

These two constants are the most expensive knobs in the system:

| Knob | Halve it | Doubles it |
|------|----------|------------|
| `TARGET_SAMPLE_RATE` | FFT size halves (32 768 → 16 384). Per-window CPU −50%. Per-window memory −50%. Wire bytes −50%. | Halves time resolution per window. Doubles computation per second of audio. |
| `UPPER_FREQUENCY` | The frequency bin width halves (6.84 Hz → 3.42 Hz at the current 16 kHz rate). Peaks above the new bound overflow the uint16 — see [Limitations](#limitations). | Wider band catches more high-frequency content. Above the Nyquist limit (16 kHz) the value is meaningless. |

### Why 16 kHz, not 32 kHz or 44.1 kHz

The fingerprinting algorithm only needs coarse time-frequency landmarks
— peaks and their pairwise relationships — not full-fidelity audio. The
Shazam paper itself targets an 8 kHz / 11 kHz band. We use 16 kHz / 7 kHz
because:

- The FFT size at `WINDOW_SECONDS = 0.5` is `nextPow2(8000) = 8192`, so each
  window takes ~4× less CPU than at 32 kHz (`fftSize = 32 768`).
- Wire bytes per live-mic chunk are halved, which matters on flaky mobile
  networks.
- The fingerprint hash itself only depends on the relative positions of
  spectral peaks, not on the absolute rate. Empirical testing on the
  60 s house fixture shows the hash count and matchability are unchanged
  after the 32 kHz → 16 kHz switch.

The trade-off is that we lose the 7–16 kHz band (cymbals, sibilance,
hi-hats). Real-music testing so far shows no false-negative regressions,
but if recognition quality drops for a specific genre, the first knob to
try is `UPPER_FREQUENCY` (more band) before going back up to 32 kHz.

### Re-fingerprinting existing tracks

`hashPair` quantises `(freq / UPPER_FREQUENCY) * 65535` into a 10-bit bin.
Changing `UPPER_FREQUENCY` or the source rate shifts the bin numbers, so
**stored fingerprints generated at the old rate will not match** queries
generated at the new rate. After changing either constant, every existing
track must be re-fingerprinted.

The original WAV is not persisted after upload, so the
`scripts/refingerprint-audio-tracks.js` CLI walks a local directory
(default convention: `<audioDir>/<trackId>.wav`):

```bash
# Dry-run: list what would be re-fingerprinted
npm run refingerprint -- --audio-dir ./audio-archive --dry-run

# Re-fingerprint everything in the directory
npm run refingerprint -- --audio-dir ./audio-archive

# Drop fingerprints for tracks whose audio is no longer available
# (the DJ will need to re-upload them)
npm run refingerprint -- --clear-missing

# Use a side-car manifest for non-default file naming
# (manifest.json: { "<trackId>": "subdir/foo.wav", ... })
npm run refingerprint -- --audio-dir ./audio-archive --manifest ./audio-archive/manifest.json
```

If you have no audio archive, the simplest fallback is to delete the
`AudioTrackModel` rows (and their `AudioFingerprintModel` rows) and
have each DJ re-upload. Nothing in the live path references the old
rate.

## Adding new tests

For the FP/FN characteristics, follow the existing structure:

- Use synthetic in-memory WAVs (see `synthTonePcm` / `synthWavBuffer`
  in `audio-recognition-quality.test.js`) for fast, deterministic tests.
- Use the real house-track fixture
  (`/home/herp/TFG/repo/simple_house_140bpm_60s.wav`) when you need
  realistic constellation density.
- For tests that exercise the RAM matcher, use `mongodb-memory-server`
  rather than mocking. Mocks would hide the very bugs the tests are
  supposed to catch.
