/**
 * Minimal radix-2 Cooley-Tukey FFT for spectral analysis
 *
 * Designed for 128-point transforms (75 real samples zero-padded).
 * In-place computation, no external dependencies.
 */

/**
 * Generate a Hanning window of given size
 *
 * w[n] = 0.5 * (1 - cos(2π * n / (N - 1)))
 *
 * Applied before FFT to reduce spectral leakage from windowing artifacts.
 */
export function hanningWindow(size: number): Float64Array {
  const window = new Float64Array(size)
  for (let n = 0; n < size; n++) {
    window[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (size - 1)))
  }
  return window
}

/**
 * In-place radix-2 Cooley-Tukey decimation-in-time FFT
 *
 * @param re - Real parts (length must be power of 2)
 * @param im - Imaginary parts (same length, typically zeros for real input)
 *
 * After call, re[k] and im[k] contain the complex frequency bin k.
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const N = re.length
  if (N <= 1) return

  // Bit-reversal permutation
  let j = 0
  for (let i = 0; i < N - 1; i++) {
    if (i < j) {
      // Swap re
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp
      // Swap im
      tmp = im[i]; im[i] = im[j]; im[j] = tmp
    }
    let k = N >> 1
    while (k <= j) {
      j -= k
      k >>= 1
    }
    j += k
  }

  // Butterfly stages
  for (let len = 2; len <= N; len <<= 1) {
    const halfLen = len >> 1
    const angle = -2 * Math.PI / len
    const wRe = Math.cos(angle)
    const wIm = Math.sin(angle)

    for (let i = 0; i < N; i += len) {
      let curRe = 1
      let curIm = 0

      for (let k = 0; k < halfLen; k++) {
        const evenIdx = i + k
        const oddIdx = i + k + halfLen

        // Twiddle factor * odd element
        const tRe = curRe * re[oddIdx] - curIm * im[oddIdx]
        const tIm = curRe * im[oddIdx] + curIm * re[oddIdx]

        // Butterfly
        re[oddIdx] = re[evenIdx] - tRe
        im[oddIdx] = im[evenIdx] - tIm
        re[evenIdx] += tRe
        im[evenIdx] += tIm

        // Advance twiddle factor
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

/**
 * Compute one-sided power spectrum from complex FFT output
 *
 * P[k] = re[k]² + im[k]²
 *
 * Returns N/2 + 1 bins (DC through Nyquist).
 */
export function powerSpectrum(re: Float64Array, im: Float64Array): Float64Array {
  const N = re.length
  const numBins = (N >> 1) + 1
  const power = new Float64Array(numBins)

  for (let k = 0; k < numBins; k++) {
    power[k] = re[k] * re[k] + im[k] * im[k]
  }

  return power
}

/**
 * Compute the frequency (in Hz) corresponding to FFT bin k
 */
export function binToFrequency(k: number, fftSize: number, sampleRate: number): number {
  return (k * sampleRate) / fftSize
}

/**
 * Find the FFT bin index closest to a target frequency
 */
export function frequencyToBin(freq: number, fftSize: number, sampleRate: number): number {
  return Math.round((freq * fftSize) / sampleRate)
}

/**
 * Sum power in a frequency band [lowHz, highHz]
 *
 * @param power - One-sided power spectrum from powerSpectrum()
 * @param lowHz - Lower bound frequency in Hz
 * @param highHz - Upper bound frequency in Hz
 * @param fftSize - FFT size (e.g., 128)
 * @param sampleRate - Sample rate in Hz
 * @returns Sum of power in the band
 */
export function bandEnergy(
  power: Float64Array,
  lowHz: number,
  highHz: number,
  fftSize: number,
  sampleRate: number
): number {
  const lowBin = Math.max(0, Math.ceil((lowHz * fftSize) / sampleRate))
  const highBin = Math.min(power.length - 1, Math.floor((highHz * fftSize) / sampleRate))

  let energy = 0
  for (let k = lowBin; k <= highBin; k++) {
    energy += power[k]
  }
  return energy
}
