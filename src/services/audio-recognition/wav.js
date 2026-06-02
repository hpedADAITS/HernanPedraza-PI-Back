"use strict";

const fs = require("fs");

const PCM = 1;
const FLOAT = 3;

function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Not a RIFF/WAVE file: ${file}`);
  }

  let fmt;
  let data;
  for (let off = 12; off + 8 <= buf.length;) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const start = off + 8;
    if (id === "fmt ") {
      fmt = {
        format: buf.readUInt16LE(start),
        channels: buf.readUInt16LE(start + 2),
        sampleRate: buf.readUInt32LE(start + 4),
        bits: buf.readUInt16LE(start + 14)
      };
    } else if (id === "data") {
      data = buf.subarray(start, start + size);
    }
    off = start + size + (size & 1);
  }

  if (!fmt || !data) throw new Error(`Missing fmt/data chunk: ${file}`);
  return { sampleRate: fmt.sampleRate, samples: decode(data, fmt) };
}

function decode(data, fmt) {
  const bytes = fmt.bits >>> 3;
  const frames = Math.floor(data.length / (bytes * fmt.channels));
  const out = new Float64Array(frames);

  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let ch = 0; ch < fmt.channels; ch++) sum += sample(data, (i * fmt.channels + ch) * bytes, fmt);
    out[i] = sum / fmt.channels;
  }
  return out;
}

function sample(data, off, fmt) {
  if (fmt.format === FLOAT) return fmt.bits === 64 ? data.readDoubleLE(off) : data.readFloatLE(off);
  if (fmt.format !== PCM) throw new Error(`Unsupported WAV format: ${fmt.format}`);

  if (fmt.bits === 8) return (data.readUInt8(off) - 128) / 128;
  if (fmt.bits === 16) return data.readInt16LE(off) / 32768;
  if (fmt.bits === 24) return readInt24LE(data, off) / 8388608;
  if (fmt.bits === 32) return data.readInt32LE(off) / 2147483648;
  throw new Error(`Unsupported PCM bit depth: ${fmt.bits}`);
}

function readInt24LE(data, off) {
  const x = data[off] | (data[off + 1] << 8) | (data[off + 2] << 16);
  return x & 0x800000 ? x | 0xff000000 : x;
}

module.exports = { readWav };
