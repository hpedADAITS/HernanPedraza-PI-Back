"use strict";

const fs = require("fs");

const PCM = 1;
const FLOAT = 3;
const TARGET_SAMPLE_RATE = 16000;

function sample(data, off, fmt) {
  if (fmt.format === FLOAT) {
    if (fmt.bits === 32) return data.readFloatLE(off);
    if (fmt.bits === 64) return data.readDoubleLE(off);
    throw new Error(`Unsupported float bit depth: ${fmt.bits}`);
  }

  if (fmt.format !== PCM) {
    throw new Error(`Unsupported WAV format: ${fmt.format}`);
  }

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

async function parseWavHeader(filePath) {
  const fd = await fs.promises.open(filePath, "r");
  try {
    const headerSize = 1024;
    const header = Buffer.alloc(headerSize);
    const { bytesRead } = await fd.read(header, 0, headerSize, 0);

    if (
      header.toString("ascii", 0, 4) !== "RIFF" ||
      header.toString("ascii", 8, 12) !== "WAVE"
    ) {
      throw new Error("Not a RIFF/WAVE file");
    }

    let fmt = null;
    let dataChunkStart = 0;
    let dataSize = 0;

    let off = 12;
    while (off + 8 <= bytesRead) {
      const id = header.toString("ascii", off, off + 4);
      const size = header.readUInt32LE(off + 4);
      const start = off + 8;

      if (id === "fmt ") {
        fmt = {
          format: header.readUInt16LE(start),
          channels: header.readUInt16LE(start + 2),
          sampleRate: header.readUInt32LE(start + 4),
          bits: header.readUInt16LE(start + 14),
        };
      } else if (id === "data") {
        dataChunkStart = start;
        dataSize = size;
        break;
      }

      off = start + size + (size & 1);
    }

    if (!fmt || !dataSize) {
      throw new Error("Missing fmt/data chunk");
    }

    return { fmt, dataOffset: dataChunkStart, dataSize };
  } finally {
    await fd.close();
  }
}

function decodePcm(data, fmt) {
  const bytes = fmt.bits >>> 3;
  const channels = fmt.channels;
  const frames = Math.floor(data.length / (bytes * channels));
  const out = new Float32Array(frames);

  for (let i = 0; i < frames; i++) {
    let sum = 0;
    const offset = i * bytes * channels;
    for (let ch = 0; ch < channels; ch++) {
      sum += sample(data, offset + ch * bytes, fmt);
    }
    out[i] = sum / channels;
  }

  return out;
}

function resampleLinear(input, fromRate, toRate) {
  if (input.length === 0 || fromRate === toRate) {
    return input;
  }

  const outputLength = Math.round(input.length * toRate / fromRate);
  const output = new Float32Array(outputLength);
  const ratio = fromRate / toRate;

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * ratio;
    const index = Math.floor(sourceIndex);
    const fraction = sourceIndex - index;

    const a = input[index];
    const b = index + 1 < input.length ? input[index + 1] : a;

    output[i] = a + (b - a) * fraction;
  }

  return output;
}

async function readWavNormalized(filePath, targetSampleRate = TARGET_SAMPLE_RATE) {
  const { fmt, dataOffset, dataSize } = await parseWavHeader(filePath);

  const bytesPerFrame = (fmt.bits >>> 3) * fmt.channels;
  const totalFrames = Math.floor(dataSize / bytesPerFrame);

  const decodedSamples = new Float32Array(totalFrames);

  const fd = await fs.promises.open(filePath, "r");
  try {
    let offset = dataOffset;
    let decodedOffset = 0;
    const chunkSize = 64 * 1024;

    while (decodedOffset < totalFrames) {
      const bytesToRead = Math.min(chunkSize, (totalFrames - decodedOffset) * bytesPerFrame);
      const buf = Buffer.alloc(bytesToRead);
      await fd.read(buf, 0, bytesToRead, offset);

      const chunkDecoded = decodePcm(buf, fmt);
      decodedSamples.set(chunkDecoded, decodedOffset);
      decodedOffset += chunkDecoded.length;
      offset += bytesToRead;
    }
  } finally {
    await fd.close();
  }

  const resampled = resampleLinear(decodedSamples, fmt.sampleRate, targetSampleRate);

  return {
    sampleRate: targetSampleRate,
    samples: resampled,
    originalSampleRate: fmt.sampleRate,
  };
}

async function readWavNormalizedChunked(filePath, targetSampleRate = TARGET_SAMPLE_RATE, onChunk) {
  const { fmt, dataOffset, dataSize } = await parseWavHeader(filePath);

  const bytesPerFrame = (fmt.bits >>> 3) * fmt.channels;
  const totalFrames = Math.floor(dataSize / bytesPerFrame);

  let frameOffset = 0;

  const fd = await fs.promises.open(filePath, "r");
  try {
    let offset = dataOffset;
    const chunkSize = 64 * 1024;

    while (frameOffset < totalFrames) {
      const bytesToRead = Math.min(chunkSize, (totalFrames - frameOffset) * bytesPerFrame);
      const buf = Buffer.alloc(bytesToRead);
      await fd.read(buf, 0, bytesToRead, offset);

      const decoded = decodePcm(buf, fmt);
      const resampled = resampleLinear(decoded, fmt.sampleRate, targetSampleRate);

      onChunk(resampled, frameOffset, totalFrames);
      frameOffset += decoded.length;
      offset += bytesToRead;
    }
  } finally {
    await fd.close();
  }
}

module.exports = {
  TARGET_SAMPLE_RATE,
  readWavNormalized,
  readWavNormalizedChunked,
  resampleLinear,
  decodePcm,
  parseWavHeader,
};