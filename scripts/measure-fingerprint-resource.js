'use strict';

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const {
  fingerprintWavStreamed,
} = require('../src/services/audio-recognition/fingerprint');

const DEFAULT_AUDIO = path.resolve(__dirname, '../../simple_house_140bpm_60s.wav');
const audioFile = path.resolve(process.argv[2] || DEFAULT_AUDIO);
const sampleIntervalMs = Number(process.env.SAMPLE_INTERVAL_MS || 25);

function mb(bytes) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function snapshot() {
  const memory = process.memoryUsage();
  return {
    rss: memory.rss,
    heapUsed: memory.heapUsed,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
  };
}

function maxInto(max, current) {
  max.rss = Math.max(max.rss, current.rss);
  max.heapUsed = Math.max(max.heapUsed, current.heapUsed);
  max.external = Math.max(max.external, current.external);
  max.arrayBuffers = Math.max(max.arrayBuffers, current.arrayBuffers);
}

async function main() {
  if (!fs.existsSync(audioFile)) {
    throw new Error(`Audio file not found: ${audioFile}`);
  }

  if (global.gc) global.gc();

  const before = snapshot();
  const peak = { ...before };
  let batches = 0;
  let batchHashes = 0;

  const timer = setInterval(() => maxInto(peak, snapshot()), sampleIntervalMs);
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();

  try {
    const totals = await fingerprintWavStreamed(audioFile, {
      batchSize: 5000,
      onBatch: (batch) => {
        batches += 1;
        batchHashes += batch.length;
        maxInto(peak, snapshot());
      },
    });

    const wallMs = performance.now() - wallStart;
    const cpu = process.cpuUsage(cpuStart);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    const after = snapshot();
    maxInto(peak, after);

    const rssMax = process.resourceUsage().maxRSS * 1024;
    const result = {
      file: audioFile,
      fileMB: mb(fs.statSync(audioFile).size),
      wallMs: Math.round(wallMs),
      cpuMs: Math.round(cpuMs),
      cpuPercentOneCore: Math.round((cpuMs / wallMs) * 1000) / 10,
      memoryMB: {
        beforeRss: mb(before.rss),
        peakRss: mb(Math.max(peak.rss, rssMax)),
        afterRss: mb(after.rss),
        peakHeapUsed: mb(peak.heapUsed),
        peakExternal: mb(peak.external),
        peakArrayBuffers: mb(peak.arrayBuffers),
      },
      fingerprint: totals,
      batches,
      batchHashes,
      node: process.version,
      heapLimitMB: 512,
      sampleIntervalMs,
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    clearInterval(timer);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
