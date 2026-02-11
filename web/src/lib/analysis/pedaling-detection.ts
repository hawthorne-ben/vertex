/**
 * FFT-Based Pedaling Detection
 *
 * Analyzes acceleration frequency spectrum to detect pedaling and estimate cadence.
 * Uses multi-method approach to handle different riding conditions:
 * - Method 1: Strong periodic signal (road cycling, smooth trails)
 * - Method 2: Moderate signal (mountain biking)
 * - Method 3: High variance with weak periodicity (very rough terrain)
 */

import * as CONSTANTS from './pedaling-efficiency-constants'

export interface PedalingDetectionResult {
  confidence: number      // 0-1, confidence that we're actually pedaling
  cadence: number | null  // Detected cadence in RPM, null if not detected
}

export interface PedalingSample {
  filteredAccel: number  // High-pass filtered acceleration (m/s²)
}

/**
 * Detect pedaling using FFT on high-pass filtered acceleration
 *
 * Returns confidence (0-1) and detected cadence in RPM.
 * Uses relaxed thresholds optimized for mountain biking.
 *
 * @param samples - Array of samples with high-pass filtered acceleration
 * @param sampleRate - Sample rate in Hz
 * @param minCadence - Minimum reasonable cadence in RPM
 * @param maxCadence - Maximum reasonable cadence in RPM
 * @returns Confidence and detected cadence
 */
export function detectPedalingWithFFT(
  samples: PedalingSample[],
  sampleRate: number,
  minCadence: number = CONSTANTS.MIN_CADENCE_RPM,
  maxCadence: number = CONSTANTS.MAX_CADENCE_RPM
): PedalingDetectionResult {
  // Need minimum samples for reliable FFT
  if (samples.length < CONSTANTS.MIN_FFT_SAMPLES) {
    return { confidence: 0, cadence: null }
  }

  // Extract high-pass filtered accelerations (gravity already removed by HPF)
  const signal = samples.map(s => s.filteredAccel)

  // Check for sufficient variance - stationary bike has very low variance
  const variance = signal.reduce((sum, v) => sum + v * v, 0) / signal.length
  const stdDev = Math.sqrt(variance)

  // TUNING FIX: Raised threshold from 0.05 to 0.15
  // Prevents false positives when stationary
  if (stdDev < CONSTANTS.STATIONARY_THRESHOLD) {
    return { confidence: 0, cadence: null }
  }

  // Perform FFT to find dominant frequency in cadence range
  const spectrum = computeFrequencySpectrum(signal, sampleRate, minCadence, maxCadence)

  if (spectrum.length === 0) {
    return { confidence: 0, cadence: null }
  }

  // Find peak frequency and calculate power statistics
  const { peakIdx, peakPower, medianPower, avgPower } = analyzeSpectrum(spectrum)

  // Calculate confidence based on signal characteristics
  const peakToMedian = medianPower > 0 ? peakPower / medianPower : 0
  const cadence = spectrum[peakIdx] ? spectrum[peakIdx].freq * 60 : null

  const confidence = calculateConfidence(peakToMedian, stdDev, cadence)

  return { confidence, cadence }
}

/**
 * Compute frequency spectrum for cadence range using DFT
 *
 * Only computes frequencies in the cadence range to save computation.
 * Returns array of {freq, power} for frequencies corresponding to 40-130 RPM.
 *
 * @param signal - Time-domain signal (filtered acceleration)
 * @param sampleRate - Sample rate in Hz
 * @param minCadence - Minimum cadence in RPM
 * @param maxCadence - Maximum cadence in RPM
 * @returns Frequency spectrum in cadence range
 */
function computeFrequencySpectrum(
  signal: number[],
  sampleRate: number,
  minCadence: number,
  maxCadence: number
): Array<{ freq: number; power: number }> {
  const N = signal.length
  const spectrum: Array<{ freq: number; power: number }> = []

  // Convert cadence range from RPM to Hz
  const minFreq = minCadence / 60
  const maxFreq = maxCadence / 60

  // Compute DFT for frequencies in cadence range
  for (let k = 0; k < N / 2; k++) {
    const freq = k * sampleRate / N

    // Skip DC component and frequencies outside cadence range
    if (freq < CONSTANTS.MIN_FFT_FREQUENCY_HZ || freq < minFreq || freq > maxFreq) {
      continue
    }

    let real = 0
    let imag = 0

    // DFT formula: X[k] = Σ(x[n] * e^(-j*2π*k*n/N))
    for (let n = 0; n < N; n++) {
      const angle = -2 * Math.PI * k * n / N
      real += signal[n] * Math.cos(angle)
      imag += signal[n] * Math.sin(angle)
    }

    // Power spectrum magnitude (normalized by N)
    const power = Math.sqrt(real * real + imag * imag) / N
    spectrum.push({ freq, power })
  }

  return spectrum
}

/**
 * Analyze frequency spectrum to find peak and statistics
 *
 * @param spectrum - Frequency spectrum
 * @returns Peak index, peak power, median power, average power
 */
function analyzeSpectrum(spectrum: Array<{ freq: number; power: number }>): {
  peakIdx: number
  peakPower: number
  medianPower: number
  avgPower: number
} {
  let peakIdx = 0
  let peakPower = 0

  // Find peak
  for (let i = 0; i < spectrum.length; i++) {
    if (spectrum[i].power > peakPower) {
      peakPower = spectrum[i].power
      peakIdx = i
    }
  }

  // Calculate statistics
  const powers = spectrum.map(s => s.power)
  const totalPower = powers.reduce((sum, v) => sum + v, 0)
  const avgPower = totalPower / powers.length

  // Median is more robust to outliers than mean
  const sortedPowers = [...powers].sort((a, b) => a - b)
  const medianPower = sortedPowers[Math.floor(sortedPowers.length / 2)]

  return { peakIdx, peakPower, medianPower, avgPower }
}

/**
 * Calculate confidence based on signal characteristics
 *
 * Uses three-method approach to handle different riding conditions:
 * - Method 1: Strong periodic signal (road cycling)
 * - Method 2: Moderate signal (mountain biking)
 * - Method 3: High variance with weak periodicity (rough terrain)
 *
 * TUNING FIX: Method 3 now requires peakToMedian > 2.0 (was 1.2)
 * to reduce false positives during descents without pedaling.
 *
 * @param peakToMedian - Ratio of peak power to median power
 * @param stdDev - Standard deviation of signal (m/s²)
 * @param cadence - Detected cadence in RPM (null if none)
 * @returns Confidence score 0-1
 */
function calculateConfidence(
  peakToMedian: number,
  stdDev: number,
  cadence: number | null
): number {
  // Method 1: Strong periodic signal (road cycling, smooth trail)
  if (peakToMedian > CONSTANTS.METHOD_1_PEAK_TO_MEDIAN && stdDev > CONSTANTS.METHOD_1_MIN_STDDEV) {
    let confidence = Math.min(1.0, (peakToMedian - CONSTANTS.METHOD_1_PEAK_TO_MEDIAN) / 3.0)

    // Bonus for very strong peaks
    if (peakToMedian > CONSTANTS.METHOD_1_STRONG_PEAK_THRESHOLD) {
      confidence = Math.min(1.0, confidence + CONSTANTS.METHOD_1_STRONG_PEAK_BONUS)
    }

    return confidence
  }

  // Method 2: Moderate signal but reasonable cadence detected (mountain biking)
  if (
    peakToMedian > CONSTANTS.METHOD_2_PEAK_TO_MEDIAN &&
    stdDev > CONSTANTS.METHOD_2_MIN_STDDEV &&
    cadence !== null &&
    cadence >= CONSTANTS.METHOD_2_MIN_CADENCE &&
    cadence <= CONSTANTS.METHOD_2_MAX_CADENCE
  ) {
    return Math.min(
      CONSTANTS.METHOD_2_MAX_CONFIDENCE,
      (peakToMedian - CONSTANTS.METHOD_2_PEAK_TO_MEDIAN) / 2.0
    )
  }

  // Method 3: Sufficient variance with any reasonable peak (very rough terrain)
  // TUNING FIX: Increased peak requirement from 1.2 to 2.0
  if (
    stdDev > CONSTANTS.METHOD_3_MIN_STDDEV &&
    peakToMedian > CONSTANTS.METHOD_3_PEAK_TO_MEDIAN &&
    cadence !== null &&
    cadence >= CONSTANTS.METHOD_3_MIN_CADENCE &&
    cadence <= CONSTANTS.METHOD_3_MAX_CADENCE
  ) {
    return Math.min(
      CONSTANTS.METHOD_3_MAX_CONFIDENCE,
      (peakToMedian - CONSTANTS.METHOD_3_PEAK_TO_MEDIAN) / 2.0
    )
  }

  // No method matched - not confidently pedaling
  return 0
}
