const crypto = require('crypto');
const config = require('../config');

const PREFIX = 'enc-cover:v1:';
const DATA_IMAGE_BASE64 = /^data:image\/[a-z0-9.+-]+;base64,/i;
const INFO = Buffer.from('Syncrequest coverUrl v1');

function encryptCoverUrl(value, token) {
  if (!shouldEncryptCoverUrl(value)) return value || null;

  const salt = token
    ? crypto.createHash('sha256').update(token).digest().subarray(0, 16)
    : crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFromSalt(salt), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${[
    salt.toString('base64url'),
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')}`;
}

function decryptCoverUrl(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value || null;

  try {
    const [saltText, ivText, tagText, ciphertextText] = value
      .slice(PREFIX.length)
      .split('.');
    const salt = Buffer.from(saltText, 'base64url');
    const iv = Buffer.from(ivText, 'base64url');
    const tag = Buffer.from(tagText, 'base64url');
    const ciphertext = Buffer.from(ciphertextText, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFromSalt(salt), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

function coverUrlCacheKey(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value)).digest('base64url');
}

function shouldEncryptCoverUrl(value) {
  return typeof value === 'string' && DATA_IMAGE_BASE64.test(value);
}

function keyFromSalt(salt) {
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.from(config.jwtSecret),
    salt,
    INFO,
    32,
  ));
}

module.exports = {
  coverUrlCacheKey,
  decryptCoverUrl,
  encryptCoverUrl,
  shouldEncryptCoverUrl,
};
