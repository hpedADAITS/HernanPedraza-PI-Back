# Audio Recognition

Shazam-style audio fingerprinting implemented in pure Node.js. No native
dependencies — no `fpcalc`, `chromaprint`, or `acoustid` binaries. The
algorithm is a Node port of the one described in Avery Li-Chun Wang's 2003
paper "An Industrial-Strength Audio Search Algorithm" (see `Back/README.md`
for the original attribution).

## Pipeline

```
WAV file ──► wav.js ──► Float32 PCM @ 32 kHz mono
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
              ┌─────────────┴─────────────┐
              ▼                           ▼
       fingerprint.js              streaming.js
       (one-shot, for upload)   (incremental, for live mic)
              │                           │
              ▼                           ▼
        AudioFingerprintModel     sharedRamMatcher (in-memory index)
        + AudioFingerprintHashModel
              │                           │
              └──────────┬────────────────┘
                         ▼
                  mongo-matcher.js  (REST path)
                  ram-matcher.js    (live socket path)
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
| `mongo-matcher.js` | Hash matcher backed by `AudioFingerprintHashModel` (REST path) |
| `ram-matcher.js` | Hash matcher backed by `AudioFingerprintModel` in RAM (live path) |

## Tunable constants

These are the levers for trading off accuracy, memory and CPU. They are
defined at the top of each module and (deliberately) not centralised.

### Constellation (`constellation.js`)

| Constant | Value | Effect |
|----------|-------|--------|
| `WINDOW_SECONDS` | `0.5` | Frame size in seconds. Larger windows improve frequency resolution but reduce time resolution. |
| `PEAKS_PER_WINDOW` | `15` | Number of spectral peaks kept per frame. More peaks → more hashes → higher match scores but more storage. |
| `MIN_PEAK_DISTANCE` | `200` | Minimum distance (in FFT bins) between two kept peaks. Prevents redundant nearby peaks. |
| `UPPER_FREQUENCY` | `14000` | Upper frequency bound (Hz) used to quantise peak frequencies into a 16-bit integer. Peaks above this can overflow the 16-bit range — see [Limitations](#limitations). |

### Hashing (`hashes.js`)

| Constant | Value | Effect |
|----------|-------|--------|
| `FREQUENCY_BITS` | `10` | Bits used per frequency in a hash. Gives 1024 frequency bins. |
| `FAN_OUT` | `100` | Maximum number of *future* points a point is paired with. Larger FAN_OUT → more hashes per anchor point but slower. |
| `MAX_UINT16` | `65535` | Input range for the (already-quantised) frequency; 16-bit packing. |

### Matchers (`mongo-matcher.js`, `ram-matcher.js`)

| Constant | Value | Effect |
|----------|-------|--------|
| `MAX_MATCH_HASHES` | `1200` | Cap on query hashes. Bounds DB round-trips and CPU per match. |
| `MIN_ALIGNED_HASHES` | `4` | Absolute score threshold. Matches below this are rejected outright. Prevents noise/typos from producing matches. |
| `MIN_BEST_SCORE_GAP` | `2` | Minimum gap between the top match's score and the second-best. Prevents hash-collision ties from producing false positives. |

### RAM matcher memory budget (`ram-matcher.js`)

| Constant | Value | Effect |
|----------|-------|--------|
| `MAX_INDEXED_HASHES_PER_EVENT` | `40_000` | Soft cap that logs a warning when exceeded. Note: the cap **does not currently truncate** the index. |
| `MAX_TRACK_HASHES` | `40_000` | Skips loading tracks with more hashes than this to bound OOM risk. |
| `MAX_CACHED_EVENTS` | `2` | LRU eviction. Two events are held in RAM at once. |

### Streaming (`streaming.js`)

| Constant | Value | Effect |
|----------|-------|--------|
| `MAX_POINTS_MEMORY_BYTES` | `10 MB` | Soft cap on the constellation size. The most recent 70 % of points are kept. |
| `MAX_HASH_ENTRIES` | `50_000` | Soft cap on the hash map. Same LRU-style truncation. |

## Two matching paths

The system has two hash matchers. They produce **equivalent** results on
the same input, but live in different code paths for performance reasons.

| Path | When used | Storage |
|------|-----------|---------|
| `mongo-matcher.js` (REST) | DJ uploads a fingerprint, then queries it via `POST /events/:id/audio-match` | Reads from `AudioFingerprintHashModel` (legacy per-row storage) |
| `ram-matcher.js` (live socket) | Phone-microphone streams PCM chunks over Socket.IO; needs < 100 ms response | Reads from `AudioFingerprintModel` (bundled per-track storage) into RAM on first match |

Both matchers implement the same offset-histogram algorithm and the same
two-pronged confidence check (`MIN_ALIGNED_HASHES` + `MIN_BEST_SCORE_GAP`).
If you change the confidence logic, change it in **both** files.

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
  to pass `MIN_ALIGNED_HASHES = 4`.
- **Reverberant / noisy phone audio** matches the original clean track
  in the existing integration test (`phone_stream_reverb_32kHz.wav`),
  but at lower scores. Very heavy reverberation or noise will eventually
  drop the match below the threshold.

### False positives (the algorithm is guarded against these)

- **Two unrelated tracks** with disjoint frequency content share
  essentially zero hashes. The cross-track test
  (`audio-recognition-quality.test.js → does not confuse two unrelated
  synthetic signals`) allows up to 5 random hash collisions.
- **Hash-collision ties** — when two tracks have similar top scores,
  the `MIN_BEST_SCORE_GAP = 2` guard rejects the top match. The second
  candidate is then re-evaluated as the new top; this behaviour is
  documented in `matchers.test.js`.
- **Random noise inputs** (no real constellation) produce no confident
  match because hash collision counts stay below `MIN_ALIGNED_HASHES`.

### Algorithmic caveats (current behaviour, not necessarily desirable)

- **Constellation overflow above UPPER_FREQUENCY.** When a peak lands
  in a bin above 14 kHz (i.e. between 14 kHz and the 16 kHz Nyquist at
  32 kHz sample rate), the quantised frequency exceeds 65 535. This
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
npm test -- test/unit/matchers.test.js                       # confidence gap logic
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
  window of constellation points and hashes (capped at ~10 MB and
  50 000 entries respectively via `streaming.js`).
- Emits hashes in batches of `batchSize` (default 5 000) via the
  `onBatch` callback. The `audio-tracks.service.js` `createTrack`
  handler uses this callback to `$push` hashes into the bundled
  `AudioFingerprintModel` and to `insertMany` into the legacy
  `AudioFingerprintHashModel`.

Peak heap usage is **O(1) in the audio length**: a 5-minute synthetic
WAV uses roughly the same memory as a 30-second one. The memory test
(`test/unit/audio-recognition-memory.test.js`) pins this with a
50 MB ceiling for a 5-minute input. The previous one-shot path
(`fingerprintWav`) used ~38 MB of samples + ~6 MB of hashes for a
5-minute input alone, which OOM'd the 512 MB Render service on
inputs of 5+ minutes.

If you need the one-shot API for a quick script or test, `fingerprintWav`
is still available — it just won't survive a 512 MB heap on long audio.

## Adding new tests

For the FP/FN characteristics, follow the existing structure:

- Use synthetic in-memory WAVs (see `synthTonePcm` / `synthWavBuffer`
  in `audio-recognition-quality.test.js`) for fast, deterministic tests.
- Use the real house-track fixture
  (`/home/herp/TFG/repo/simple_house_140bpm_60s.wav`) when you need
  realistic constellation density.
- For tests that exercise the RAM or Mongo matcher, use
  `mongodb-memory-server` rather than mocking. Mocks would hide the very
  bugs the tests are supposed to catch.
