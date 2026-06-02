"use strict";

const { WINDOW_SECONDS, hann, windowPeaks } = require("./constellation");
const { FAN_OUT, createHashes, hashPair } = require("./hashes");

class StreamingFingerprinter {
  constructor(sampleRate) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error(`Invalid sampleRate: ${sampleRate}`);
    this.sampleRate = sampleRate;
    this.windowSize = Math.max(2, Math.floor(WINDOW_SECONDS * sampleRate));
    this.fftSize = 1 << Math.ceil(Math.log2(Math.max(1, this.windowSize)));
    this.window = hann(this.windowSize);
    this.buffer = new Float64Array(0);
    this.time = 0;
    this.points = [];
    this.hashes = new Map();
  }

  process(samples) {
    this.buffer = append(this.buffer, samples);
    const out = [];

    while (this.buffer.length >= this.windowSize) {
      this._window(this.buffer, 0, out);
      this.buffer = this.buffer.subarray(this.windowSize);
    }

    return out;
  }

  flush() {
    if (!this.buffer.length) return [];
    const padded = new Float64Array(this.windowSize);
    padded.set(this.buffer);
    this.buffer = new Float64Array(0);
    const out = [];
    this._window(padded, 0, out);
    return out;
  }

  fingerprint(songId = null) {
    return [...createHashes(this.points, songId)].map(([hash, [time, id]]) => ({ hash, time, songId: id }));
  }

  _window(samples, start, out) {
    const points = windowPeaks(samples, start, this.sampleRate, this.windowSize, this.fftSize, this.window, this.time++);
    const firstNew = this.points.length;
    this.points.push(...points);
    this._hashNewPoints(firstNew, out);
  }

  _hashNewPoints(firstNew, out) {
    for (let j = firstNew; j < this.points.length; j++) {
      const [otherTime, otherFreq] = this.points[j];
      const from = Math.max(0, j - FAN_OUT + 1);
      for (let i = from; i <= j; i++) {
        const [time, freq] = this.points[i];
        const key = hashPair(time, freq, otherTime, otherFreq);
        if (key !== null && !this.hashes.has(key)) {
          this.hashes.set(key, time);
          out.push({ hash: key, time });
        }
      }
    }
  }
}

function append(a, b) {
  const out = new Float64Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

class LiveMatcher {
  constructor(database, songs = {}) {
    this.database = database;
    this.songs = songs;
    this.buckets = new Map();
  }

  addHashes(hashes) {
    for (const { hash, time } of hashes) {
      for (const [sourceTime, songIndex] of this.database[hash] || []) {
        const byOffset = mapIn(this.buckets, songIndex);
        const offset = sourceTime - time;
        byOffset.set(offset, (byOffset.get(offset) || 0) + 1);
      }
    }
    return this.matches();
  }

  matches(limit = 5) {
    return [...this.buckets].map(([songIndex, byOffset]) => {
      let bestOffset = 0;
      let score = 0;
      for (const [offset, count] of byOffset) {
        if (count > score) {
          bestOffset = offset;
          score = count;
        }
      }
      return matchResult(this.songs[songIndex], String(songIndex), bestOffset, score);
    }).sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

function matchResult(entry, fallback, offset, score) {
  if (entry && typeof entry === "object") {
    return { ...entry, song: entry.title || entry.file || fallback, offset, score };
  }
  return { song: entry || fallback, offset, score };
}

function mapIn(parent, key) {
  let child = parent.get(key);
  if (!child) parent.set(key, child = new Map());
  return child;
}

module.exports = { LiveMatcher, StreamingFingerprinter, matchResult };
