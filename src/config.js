const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const explicitEnv = { ...process.env };
const envPath = path.join(__dirname, '..', '.env');
const localEnvPath = path.join(__dirname, '..', '.env.local');

dotenv.config({ path: envPath });

if (explicitEnv.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'production') {
  if (fs.existsSync(localEnvPath)) {
    const localEnv = dotenv.parse(fs.readFileSync(localEnvPath));
    Object.entries(localEnv).forEach(([key, value]) => {
      if (explicitEnv[key] === undefined) process.env[key] = value;
    });
  }
}

const env = process.env.NODE_ENV || 'development';
const DEVELOPMENT_JWT_SECRET = 'Syncrequest-local-development-secret';
const MIN_PRODUCTION_JWT_SECRET_LENGTH = 32;

/* DEBUG_MODE is read live so tests can toggle it without re-requiring
   the module. config.js still throws at startup if it is enabled in
   production (see DEBUG_MODE_PRODUCTION_GUARD below). */
function isDebugMode() {
  return process.env.DEBUG_MODE === 'true';
}

const DEBUG_MODE_PRODUCTION_GUARD = (() => {
  if (env === 'production' && isDebugMode()) {
    throw new Error('DEBUG_MODE cannot be enabled in production');
  }
  return true;
})();

function readJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (env !== 'production') {
    return secret || DEVELOPMENT_JWT_SECRET;
  }

  if (!secret) {
    throw new Error('JWT_SECRET is required in production');
  }

  if (secret.length < MIN_PRODUCTION_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters in production`,
    );
  }

  return secret;
}

module.exports = {
  /* Servidor */
  port: process.env.PORT || 5000,
  env,
  get debugMode() {
    return isDebugMode();
  },

  /* DB — canonical lowercase name. Strip the path from MONGODB_URI in the
     loader to avoid MongoDB's "db already exists with different case" error
     when the URI and DB_NAME disagree on case. */
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/syncrekuest',
  dbName: (process.env.DB_NAME || 'syncrekuest').toLowerCase(),

  /* JWT */
  jwtSecret: readJwtSecret(),
  jwtExpiry: process.env.JWT_EXPIRES_IN || '24h',

  /* CORS */
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  allowedOrigins: (
    process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173'
  ).split(','),

  /* Socket.IO */
  socketCorsOrigin: process.env.SOCKET_CORS_ORIGIN || 'http://localhost:5173',

  /* Socket client config constants */
  socketReconnectDelay: 500,
  socketTimeout: 20000,

  /* Logger */
  logLevel: process.env.LOG_LEVEL || 'info',
  logFile: process.env.LOG_FILE || 'logs/app.log',

  /* Audio fingerprint matcher tolerance.
   *
   * Each gate rejects a different class of false positive:
   *   - minScore               : absolute lower bound (noise floor)
   *   - minOffsetConcentration : top-offset / total-aligned ratio — a real
   *                              match concentrates hashes at one
   *                              (sample, source) time delta; random
   *                              collisions spread across many offsets
   *   - minMarginRatio         : top score / second score — guards against
   *                              two equally-strong candidates
   *   - holdWindowMs           : how long a candidate is held before it is
   *                              promoted to a locked match. Long enough
   *                              to absorb chunk-to-chunk jitter and let
   *                              the queue catch up.
   *   - minPersistentChunks    : a candidate must lead the ranking in at
   *                              least this many consecutive chunks before
   *                              the hold starts. Filters single-chunk
   *                              spikes caused by noise.
   *   - minMatchQueryHashes    : minimum unique hashes that must be in the
   *                              accumulated window before a candidate can
   *                              lock. Prevents locking on a tiny sample.
   *
   * All values are tunable via env vars for live ops. They default to
   * conservative-but-usable values; the integration tests pin them so a
   * tuning change never silently flips a test. */
  matcher: {
    minScore: numberFromEnv('MATCHER_MIN_SCORE', 4),
    minOffsetConcentration: numberFromEnv('MATCHER_MIN_OFFSET_CONCENTRATION', 0.5),
    minMarginRatio: numberFromEnv('MATCHER_MIN_MARGIN_RATIO', 1.5),
    holdWindowMs: numberFromEnv('MATCHER_HOLD_WINDOW_MS', 20_000),
    minPersistentChunks: numberFromEnv('MATCHER_MIN_PERSISTENT_CHUNKS', 3),
    minMatchQueryHashes: numberFromEnv('MATCHER_MIN_QUERY_HASHES', 30),
    /* How often the streaming matcher re-runs against the accumulated
       hold window. The matcher was already throttled at
       AUDIO_MATCH_INTERVAL_MS in audio.js; this is a separate debounce so
       we don't pay the cost of re-scoring on every chunk. */
    reMatchDebounceMs: numberFromEnv('MATCHER_RE_MATCH_DEBOUNCE_MS', 700),
  },
};

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number, got: ${raw}`);
  }
  return value;
}
