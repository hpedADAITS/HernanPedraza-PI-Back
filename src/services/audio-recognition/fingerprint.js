"use strict";

const fs = require("fs");
const { createConstellation } = require("./constellation");
const { createHashes } = require("./hashes");
const { readWav } = require("./wav");

function fingerprintWav(file, songId = null) {
  const { sampleRate, samples } = readWav(file);
  const constellation = createConstellation(samples, sampleRate);
  const hashes = [...createHashes(constellation, songId)].map(([hash, [time, id]]) => ({ hash, time, songId: id }));
  return { file, sampleRate, duration: samples.length / sampleRate, points: constellation.length, hashes };
}

function saveFingerprint(fingerprint, file) {
  fs.writeFileSync(file, JSON.stringify(fingerprint, null, 2));
}

function loadFingerprint(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function hashMapFromFingerprint(fingerprint) {
  return new Map(fingerprint.hashes.map(({ hash, time, songId = null }) => [hash, [time, songId]]));
}

module.exports = { fingerprintWav, hashMapFromFingerprint, loadFingerprint, saveFingerprint };
