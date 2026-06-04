"use strict";
const { TARGET_SAMPLE_RATE } = require("./wav");


const UPPER_FREQUENCY = TARGET_SAMPLE_RATE / 2;
const FREQUENCY_BITS = 10;
const FAN_OUT = 10;
function createHashes(constellation, songId = null) {
  const hashes = new Map();

  for (let i = 0; i < constellation.length; i++) {
    const [time, freq] = constellation[i];
    for (let j = i; j < Math.min(i + FAN_OUT, constellation.length); j++) {
      const [otherTime, otherFreq] = constellation[j];
      const hash = hashPair(time, freq, otherTime, otherFreq);
      if (hash !== null) hashes.set(hash, [time, songId]);
    }
  }

  return hashes;
}

function hashPair(time, freq, otherTime, otherFreq) {
  const diff = otherTime - time;
  if (diff <= 1 || diff > 10) return null;

  const bins = 1 << FREQUENCY_BITS;
  const a = Math.trunc((freq / UPPER_FREQUENCY) * bins);
  const b = Math.trunc((otherFreq / UPPER_FREQUENCY) * bins);
  return a | (b << 10) | (diff << 20);
}

module.exports = { FAN_OUT, createHashes, hashPair };
