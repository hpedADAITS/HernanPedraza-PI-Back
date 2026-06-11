'use strict';

const BYTES_PER_HASH = 8;

function encodeHashRows(rows) {
  const out = Buffer.allocUnsafe((rows?.length || 0) * BYTES_PER_HASH);
  let offset = 0;

  for (const row of rows || []) {
    const hash = Number(row.hash ?? row.h);
    const time = Number(row.time ?? row.t);
    if (!Number.isFinite(hash) || !Number.isFinite(time)) continue;
    out.writeUInt32LE(hash >>> 0, offset);
    out.writeInt32LE(time | 0, offset + 4);
    offset += BYTES_PER_HASH;
  }

  return offset === out.length ? out : out.subarray(0, offset);
}

function decodeHashRows(data) {
  if (!data?.length) return [];
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer || data);
  const rows = [];
  const end = buf.length - (buf.length % BYTES_PER_HASH);

  for (let offset = 0; offset < end; offset += BYTES_PER_HASH) {
    rows.push({
      h: buf.readUInt32LE(offset),
      t: buf.readInt32LE(offset + 4),
    });
  }

  return rows;
}

function storedHashRows(fingerprint) {
  return fingerprint?.hashData?.length
    ? decodeHashRows(fingerprint.hashData)
    : fingerprint?.hashes || [];
}

module.exports = {
  BYTES_PER_HASH,
  decodeHashRows,
  encodeHashRows,
  storedHashRows,
};
