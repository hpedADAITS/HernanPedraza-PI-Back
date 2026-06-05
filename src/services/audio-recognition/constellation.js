"use strict";

const { fft, nextPow2 } = require("./fft");

const WINDOW_SECONDS = 0.5;
const PEAKS_PER_WINDOW = 15;
const MIN_PEAK_DISTANCE = 200;

function createConstellation(samples, sampleRate) {
  const windowSize = Math.max(2, Math.floor(WINDOW_SECONDS * sampleRate));
  const fftSize = nextPow2(windowSize);
  const total = Math.ceil(samples.length / windowSize) * windowSize;
  const points = [];
  const window = hann(windowSize);

  for (let start = 0, time = 0; start < total; start += windowSize, time++) {
    points.push(...windowPeaks(samples, start, sampleRate, windowSize, fftSize, window, time));
  }

  return points;
}

function windowPeaks(samples, start, sampleRate, windowSize, fftSize, window = hann(windowSize), time = 0) {
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  for (let i = 0; i < windowSize; i++) real[i] = (samples[start + i] || 0) * window[i];
  fft(real, imag);

  const bins = (fftSize >>> 1) + 1;
  const spectrum = new Float32Array(bins);
  for (let i = 0; i < bins; i++) spectrum[i] = Math.hypot(real[i], imag[i]);
  return topPeaks(spectrum, PEAKS_PER_WINDOW, MIN_PEAK_DISTANCE)
    .map((peak) => [time, (peak * sampleRate) / fftSize]);
}

function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

function topPeaks(spectrum, limit, distance) {
  const peaks = [];
  for (let i = 1; i < spectrum.length - 1; i++) {
    if (spectrum[i] > spectrum[i - 1] && spectrum[i] >= spectrum[i + 1]) {
      peaks.push({ i, prominence: spectrum[i] - Math.max(spectrum[i - 1], spectrum[i + 1]) });
    }
  }
  peaks.sort((a, b) => b.prominence - a.prominence);

  const chosen = [];
  for (const peak of peaks) {
    if (chosen.every((i) => Math.abs(i - peak.i) >= distance)) chosen.push(peak.i);
    if (chosen.length === limit) break;
  }
  return chosen.sort((a, b) => a - b);
}

module.exports = { WINDOW_SECONDS, createConstellation, hann, windowPeaks };
