"use strict";

function nextPow2(n) {
  return 1 << Math.ceil(Math.log2(Math.max(1, n)));
}

function reverseBits(x, bits) {
  let y = 0;
  for (let i = 0; i < bits; i++) y = (y << 1) | ((x >>> i) & 1);
  return y;
}

function fft(real, imag) {
  const n = real.length;
  if (n !== imag.length || (n & (n - 1))) throw new Error("FFT length must be a power of two");

  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    const j = reverseBits(i, bits);
    if (j > i) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >>> 1;
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const angle = step * k;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const even = start + k;
        const odd = even + half;
        const tr = wr * real[odd] - wi * imag[odd];
        const ti = wr * imag[odd] + wi * real[odd];
        real[odd] = real[even] - tr;
        imag[odd] = imag[even] - ti;
        real[even] += tr;
        imag[even] += ti;
      }
    }
  }
  return { real, imag };
}

module.exports = { fft, nextPow2 };
