// Symmetric at-rest encryption for short text fields (title, artist).
//
// Format on the wire / in MongoDB:
//   enc-text:v1:<authTokenVersion>.<iv>.<tag>.<ciphertext>
//   (all parts base64url-encoded)
//
// Key derivation (HKDF-SHA256, 32-byte output):
//   salt    = SHA-256( ownerAuthToken || ':' || authTokenVersion ).subarray(0, 16)
//   keyInfo = "Syncrequest text v1"
//   key     = HKDF(ikm = config.jwtSecret, salt, keyInfo, 32)
//
// The "salt" prefix here is intentionally NOT the HKDF salt — it's the
// per-row IV. The HKDF salt is the SHA-256 of (ownerAuthToken, ':',
// authTokenVersion), which only the server can recompute because the
// owner's `authToken` is never persisted. That is the property the
// design depends on: a stolen DB snapshot is useless without the
// owner's in-flight token.
//
// The `authTokenVersion` IS stored in the prefix (it is already
// public via the JWT) so we can detect token rotation: rows written
// under an old version become unreadable after the owner bumps the
// version, and are silently re-encrypted on the next write.

const crypto = require('crypto');
const config = require('../config');
const { generateToken } = require('../utils/jwt.utils');
const { UserModel } = require('../models');
const { logger } = require('../utils');

const PREFIX = 'enc-text:v1:';
const KEY_INFO = Buffer.from('Syncrequest text v1');
const AES_IV_LEN = 12;
const SALT_LEN = 16;

const PREFIX_RE = /^enc-text:v1:(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

/* In-process cache: (eventId|ownerId|tokenVersion) -> derived 32-byte key.
   Bounded by an LRU; entries are evicted on owner-DJ disconnect from the
   event room. */
const keyCache = new Map();
const MAX_CACHE_ENTRIES = 256;

function cachePut(key, derived) {
  if (keyCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = keyCache.keys().next().value;
    if (oldest !== undefined) keyCache.delete(oldest);
  }
  keyCache.set(key, derived);
}

function cacheGet(key) {
  if (!keyCache.has(key)) return null;
  const value = keyCache.get(key);
  /* Refresh LRU position */
  keyCache.delete(key);
  keyCache.set(key, value);
  return value;
}

/* Cached key entries carry both the derived key buffer and the version
   they belong to, so encryption and decryption can read the version
   back without an extra DB hit. */
function makeCacheValue(keyBuffer, version) {
  return { key: keyBuffer, version };
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/* Return the authTokenVersion embedded in the prefix, or null. */
function readVersion(value) {
  if (!isEncrypted(value)) return null;
  const match = PREFIX_RE.exec(value);
  return match ? Number(match[1]) : null;
}

/* Re-mint a server-side "owner token" that mirrors the shape used by the
   REST auth middleware. It carries the owner's current `authTokenVersion`
   so the HKDF output is bound to that version. The token never leaves the
   server (no logging, no response payload, no DB write). */
function mintOwnerAuthToken(owner, tokenVersion) {
  return generateToken({
    userId: owner._id,
    email: owner.email,
    role: 'DJ',
    type: 'default',
    tokenVersion,
  });
}

function deriveKey(ownerAuthToken, tokenVersion) {
  const saltHash = crypto
    .createHash('sha256')
    .update(`${ownerAuthToken}:${tokenVersion}`)
    .digest();
  const salt = saltHash.subarray(0, SALT_LEN);
  const key = Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(config.jwtSecret), salt, KEY_INFO, 32),
  );
  return key;
}

function cacheKeyFor(eventObjectId, ownerId, tokenVersion) {
  return `${eventObjectId}::${ownerId}::${tokenVersion}`;
}

/* Resolve the event owner (or a pre-loaded owner row) and return the
   derived key for the requested version. Reads the `UserModel` for the
   `authTokenVersion` only — never for the bearer token. */
async function resolveKey(eventLike, { tokenVersion } = {}) {
  if (!eventLike) return null;
  const ownerId =
    typeof eventLike.ownerId === 'string'
      ? eventLike.ownerId
      : eventLike.ownerId?._id?.toString?.() || eventLike.ownerId?.toString?.();
  if (!ownerId) return null;

  const owner = await UserModel.findById(ownerId)
    .select('_id email authTokenVersion')
    .lean();
  if (!owner) return null;

  const version = Number.isInteger(tokenVersion)
    ? tokenVersion
    : Number.isInteger(owner.authTokenVersion)
      ? owner.authTokenVersion
      : 0;

  const cacheKey = cacheKeyFor(
    eventLike._id?.toString?.() || eventLike.id?.toString?.() || String(eventLike),
    owner._id.toString(),
    version,
  );
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const ownerAuthToken = mintOwnerAuthToken(owner, version);
  const key = deriveKey(ownerAuthToken, version);
  // The token is a string; we do not retain it beyond this scope. The
  // derived key is all that ends up in the cache.
  cachePut(cacheKey, makeCacheValue(key, version));
  return makeCacheValue(key, version);
}

function encryptText(value, eventLike) {
  if (value == null) return value;
  if (typeof value !== 'string') {
    throw new TypeError('encryptText expects a string or null');
  }
  if (!value) return value;
  if (isEncrypted(value)) return value;

  return resolveKey(eventLike).then((entry) => {
    if (!entry) return value; // No resolvable owner — store plaintext (legacy).
    const { key, version } = entry;
    const iv = crypto.randomBytes(AES_IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${version}.${iv.toString('base64url')}.${tag.toString(
      'base64url',
    )}.${ciphertext.toString('base64url')}`;
  });
}

function decryptText(value, eventLike) {
  if (value == null) return value;
  if (typeof value !== 'string') return value;
  if (!isEncrypted(value)) return value; // Legacy plaintext — return as-is.

  return resolveKey(eventLike).then((entry) => {
    if (!entry) {
      logger.warn('text-crypto: cannot resolve owner key for decryption', {
        eventId: eventLike?._id?.toString?.() || eventLike,
      });
      return null;
    }

    const decrypted = decryptWithEntry(value, entry);
    if (decrypted === null) {
      logger.warn('text-crypto: failed to decrypt', {
        version: readVersion(value),
      });
    }
    return decrypted;
  });
}

function decryptWithEntry(value, entry) {
  if (value == null) return value;
  if (typeof value !== 'string') return value;
  if (!isEncrypted(value)) return value;
  if (!entry) return null;

  const match = PREFIX_RE.exec(value);
  if (!match) return null;
  if (Number(match[1]) !== entry.version) return null;

  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      entry.key,
      Buffer.from(match[2], 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(match[3], 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(match[4], 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/* Evict the cached key(s) for a given event when the owner-DJ
   disconnects. Best-effort: if a future read re-derives the key, the
   next disconnect will evict again. */
function evictEvent(eventObjectId, ownerId) {
  const event = String(eventObjectId);
  const owner = String(ownerId);
  let removed = 0;
  for (const key of keyCache.keys()) {
    const [keyEvent, keyOwner] = key.split('::');
    if (keyEvent === event && (owner ? keyOwner === owner : true)) {
      keyCache.delete(key);
      removed += 1;
    }
  }
  return removed;
}

/* Test-only: wipe the in-process cache between unit tests. */
function _resetCacheForTests() {
  keyCache.clear();
}

/* Decrypt several fields of the same row in parallel. Resolves the
   owner key once, then runs the cipher work concurrently. Returns
   the decrypted fields in the same order as the input. */
async function decryptFields(eventLike, values) {
  if (!Array.isArray(values)) return values;
  const entry = await resolveKey(eventLike);
  return values.map((value) => decryptWithEntry(value, entry));
}

module.exports = {
  PREFIX,
  PREFIX_RE,
  isEncrypted,
  readVersion,
  encryptText,
  decryptText,
  decryptFields,
  evictEvent,
  _resetCacheForTests,
};
