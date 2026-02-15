/**
 * Efficiency Calculation
 *
 * Converts pedaling smoothness metrics to efficiency scores.
 * Uses exponential decay function with rescaling for motivational output.
 */

import * as CONSTANTS from './pedaling-efficiency-constants'

/**
 * Calculate efficiency from standard deviation of filtered acceleration
 *
 * Uses exponential decay formula: efficiency = exp(-k * stdDev)
 * where k is tuned so that typical good pedaling shows 70-85% efficiency.
 *
 * @param stdDev - Standard deviation of high-pass filtered acceleration (m/s²)
 * @returns Efficiency score 0-1
 */
export function calculateEfficiency(stdDev: number): number {
  // Apply exponential decay formula
  const efficiency = Math.exp(-CONSTANTS.EFFICIENCY_DECAY_CONSTANT * stdDev)

  // Apply floor to prevent extremely low scores
  return Math.max(CONSTANTS.EFFICIENCY_FLOOR, efficiency)
}

/**
 * Calculate standard deviation of a dataset
 *
 * @param values - Array of numeric values
 * @returns Standard deviation
 */
export function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2))
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length

  return Math.sqrt(variance)
}

/**
 * Smooth grade data with moving average
 *
 * Handles both direct grade field and altitude-derived grade.
 * Grade data is noisy from GPS, so we apply generous smoothing.
 *
 * @param grades - Array of grade percentages (may contain nulls)
 * @param fitSamples - Original FIT samples with altitude data
 * @param windowSeconds - Smoothing window size in seconds
 * @returns Smoothed grade array
 */
export function smoothGrades(
  grades: (number | null)[],
  fitSamples: Array<{ altitude?: number | null }>,
  windowSeconds: number = CONSTANTS.GRADE_SMOOTH_WINDOW_SECONDS
): (number | null)[] {
  // If we have direct grade values, smooth them
  const hasDirectGrade = grades.some(g => g !== null && g !== undefined)

  if (hasDirectGrade) {
    return movingAverage(grades, windowSeconds * 2)  // Rough estimate: 2 samples/sec for FIT
  }

  // Otherwise, calculate from altitude
  const altitudes = fitSamples.map(s => s.altitude ?? null)
  const calculatedGrades: (number | null)[] = [null]  // First point has no grade

  for (let i = 1; i < altitudes.length; i++) {
    const alt1 = altitudes[i - 1]
    const alt2 = altitudes[i]

    if (alt1 === null || alt2 === null) {
      calculatedGrades.push(null)
      continue
    }

    // Simple elevation difference / distance (assumes 1 sample/sec for FIT)
    // This is rough - ideally we'd use actual distance between GPS points
    const dAlt = alt2 - alt1
    const dDist = 1  // Approximate 1m per sample (at 1 sample/sec, ~1 m/s speed)
    const grade = (dAlt / dDist) * 100

    // Clamp to reasonable range
    calculatedGrades.push(
      Math.max(-CONSTANTS.MAX_GRADE_PERCENT, Math.min(CONSTANTS.MAX_GRADE_PERCENT, grade))
    )
  }

  return movingAverage(calculatedGrades, windowSeconds * 2)
}

/**
 * Moving average filter for smoothing noisy data
 *
 * Applies centered window average, handling null values gracefully.
 *
 * @param data - Input data (may contain nulls)
 * @param windowSize - Window size in samples
 * @returns Smoothed data
 */
function movingAverage(
  data: (number | null)[],
  windowSize: number
): (number | null)[] {
  const result: (number | null)[] = []

  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2))
    const end = Math.min(data.length, i + Math.ceil(windowSize / 2))
    const window = data.slice(start, end).filter(v => v !== null) as number[]

    if (window.length === 0) {
      result.push(null)
    } else {
      const avg = window.reduce((sum, v) => sum + v, 0) / window.length
      result.push(avg)
    }
  }

  return result
}
