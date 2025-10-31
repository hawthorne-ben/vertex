/**
 * LTTB (Largest-Triangle-Three-Buckets) downsampling
 * Preserves visual features while reducing data points
 */

import lttb from 'downsample-lttb'

interface Sample {
  timestamp: number
  accel: { x: number; y: number; z: number }
  gyro: { x: number; y: number; z: number }
  mag?: { x: number; y: number; z: number }
  quat?: { w: number; x: number; y: number; z: number }
}

/**
 * Downsample IMU samples using LTTB algorithm
 * Applies LTTB independently to each sensor axis
 *
 * @param samples - Array of IMU samples
 * @param targetSize - Target number of samples after downsampling
 * @returns Downsampled array of samples
 */
export function downsampleLTTB(samples: Sample[], targetSize: number): Sample[] {
  if (samples.length <= targetSize) {
    return samples
  }

  // Convert to format expected by lttb library: [x, y] pairs
  const timestamps = samples.map((s, i) => i) // Use indices for x-axis
  const accelX = samples.map((s, i) => [i, s.accel.x])
  const accelY = samples.map((s, i) => [i, s.accel.y])
  const accelZ = samples.map((s, i) => [i, s.accel.z])
  const gyroX = samples.map((s, i) => [i, s.gyro.x])
  const gyroY = samples.map((s, i) => [i, s.gyro.y])
  const gyroZ = samples.map((s, i) => [i, s.gyro.z])

  // Downsample each axis
  const downsampledAccelX = lttb(accelX, targetSize)
  const downsampledAccelY = lttb(accelY, targetSize)
  const downsampledAccelZ = lttb(accelZ, targetSize)
  const downsampledGyroX = lttb(gyroX, targetSize)
  const downsampledGyroY = lttb(gyroY, targetSize)
  const downsampledGyroZ = lttb(gyroZ, targetSize)

  // Merge indices from all axes (each axis may select different points)
  const indexSet = new Set<number>()
  downsampledAccelX.forEach(([idx]) => indexSet.add(Math.round(idx)))
  downsampledAccelY.forEach(([idx]) => indexSet.add(Math.round(idx)))
  downsampledAccelZ.forEach(([idx]) => indexSet.add(Math.round(idx)))
  downsampledGyroX.forEach(([idx]) => indexSet.add(Math.round(idx)))
  downsampledGyroY.forEach(([idx]) => indexSet.add(Math.round(idx)))
  downsampledGyroZ.forEach(([idx]) => indexSet.add(Math.round(idx)))

  // Convert to sorted array and extract samples
  const selectedIndices = Array.from(indexSet).sort((a, b) => a - b)

  // If we have more than target, do a final LTTB pass on the merged indices
  let finalIndices = selectedIndices
  if (selectedIndices.length > targetSize) {
    const mergedData = selectedIndices.map(idx => [idx, samples[idx].accel.x])
    const finalDownsampled = lttb(mergedData, targetSize)
    finalIndices = finalDownsampled.map(([idx]) => Math.round(idx))
  }

  return finalIndices.map(idx => samples[idx])
}

/**
 * Downsample a single axis of data using LTTB
 * Useful for downsampling a single time series
 */
export function downsampleAxis(data: number[], timestamps: number[], targetSize: number): { data: number[]; timestamps: number[] } {
  if (data.length <= targetSize) {
    return { data, timestamps }
  }

  const points = data.map((value, i) => [timestamps[i], value])
  const downsampled = lttb(points, targetSize)

  return {
    data: downsampled.map(([, value]) => value),
    timestamps: downsampled.map(([timestamp]) => timestamp)
  }
}
