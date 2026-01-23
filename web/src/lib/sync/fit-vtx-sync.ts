/**
 * Time Series Synchronization Utilities
 *
 * Provides utilities for syncing FIT GPS data with VTX IMU data by timestamp.
 * Used across multiple features: map overlays, pedaling efficiency, etc.
 */

export interface SyncedDataPoint<F, V> {
  timestamp: number  // Unix timestamp in milliseconds
  fit: F | null      // FIT sample (if exists at this time)
  vtx: V | null      // VTX sample (if exists at this time)
}

export interface TimeRange {
  start: number  // Unix timestamp in milliseconds
  end: number    // Unix timestamp in milliseconds
}

/**
 * Merge FIT and VTX samples into a unified timeline
 * Creates a synchronized array where each timestamp has both FIT and VTX data (if available)
 */
export function syncFitVtxData<
  F extends { timestamp: string },
  V extends { timestamp: string }
>(
  fitSamples: F[],
  vtxSamples: V[],
  options: {
    tolerance?: number  // Max time difference in ms to consider "synced" (default: 100ms)
    interpolate?: boolean  // Future: interpolate missing values (not implemented)
  } = {}
): SyncedDataPoint<F, V>[] {
  const tolerance = options.tolerance ?? 100 // Default: 100ms tolerance

  // Convert all timestamps to Unix ms and sort
  const fitTimes = fitSamples.map(s => ({
    time: new Date(s.timestamp).getTime(),
    sample: s
  })).sort((a, b) => a.time - b.time)

  const vtxTimes = vtxSamples.map(s => ({
    time: new Date(s.timestamp).getTime(),
    sample: s
  })).sort((a, b) => a.time - b.time)

  const synced: SyncedDataPoint<F, V>[] = []
  let vtxIdx = 0

  // For each FIT sample, find closest VTX sample within tolerance
  for (const fit of fitTimes) {
    // Advance VTX index to closest match
    while (vtxIdx < vtxTimes.length - 1 &&
           Math.abs(vtxTimes[vtxIdx + 1].time - fit.time) < Math.abs(vtxTimes[vtxIdx].time - fit.time)) {
      vtxIdx++
    }

    // Check if VTX sample is within tolerance
    const vtxMatch = vtxIdx < vtxTimes.length &&
                     Math.abs(vtxTimes[vtxIdx].time - fit.time) <= tolerance
                     ? vtxTimes[vtxIdx].sample
                     : null

    synced.push({
      timestamp: fit.time,
      fit: fit.sample,
      vtx: vtxMatch
    })
  }

  // Add VTX samples that didn't match any FIT sample
  vtxIdx = 0
  for (const vtx of vtxTimes) {
    // Find if this VTX timestamp already exists in synced array
    const existingIdx = synced.findIndex(s => Math.abs(s.timestamp - vtx.time) <= tolerance)

    if (existingIdx === -1) {
      // No matching FIT sample, add VTX-only point
      synced.push({
        timestamp: vtx.time,
        fit: null,
        vtx: vtx.sample
      })
    }
  }

  // Final sort by timestamp
  return synced.sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * Extract time ranges from VTX recordings
 * Used for map overlay color coding (green sections with IMU data)
 */
export function getVtxTimeRanges(
  vtxRecordings: Array<{
    start_time: string
    end_time: string
    status?: string
  }>
): TimeRange[] {
  return vtxRecordings
    .filter(vtx => {
      // Only include ready recordings with valid timestamps
      if (vtx.status && vtx.status !== 'ready') return false
      if (!vtx.start_time || !vtx.end_time) return false
      return true
    })
    .map(vtx => ({
      start: new Date(vtx.start_time).getTime(),
      end: new Date(vtx.end_time).getTime(),
    }))
}

/**
 * Find the closest sample to a target timestamp
 * Used for hover sync between map/charts
 */
export function findClosestByTime<T extends { timestamp: string }>(
  samples: T[],
  targetTime: number  // Unix timestamp in seconds
): { sample: T; index: number } | null {
  if (samples.length === 0) return null

  const targetMs = targetTime * 1000

  // Binary search for closest sample
  let left = 0
  let right = samples.length - 1
  let closestIdx = 0
  let minDiff = Infinity

  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const sampleTime = new Date(samples[mid].timestamp).getTime()
    const diff = Math.abs(sampleTime - targetMs)

    if (diff < minDiff) {
      minDiff = diff
      closestIdx = mid
    }

    if (sampleTime < targetMs) {
      left = mid + 1
    } else if (sampleTime > targetMs) {
      right = mid - 1
    } else {
      return { sample: samples[mid], index: mid } // Exact match
    }
  }

  return { sample: samples[closestIdx], index: closestIdx }
}

/**
 * Calculate sample rate from first N samples
 * Returns Hz (samples per second)
 */
export function calculateSampleRate<T extends { timestamp: string }>(
  samples: T[],
  numSamples: number = 10
): number | null {
  if (samples.length < 2) return null

  const samplesToUse = Math.min(numSamples, samples.length)
  const intervals: number[] = []

  for (let i = 1; i < samplesToUse; i++) {
    const t1 = new Date(samples[i - 1].timestamp).getTime()
    const t2 = new Date(samples[i].timestamp).getTime()
    const intervalMs = t2 - t1

    if (intervalMs > 0) {
      intervals.push(intervalMs)
    }
  }

  if (intervals.length === 0) return null

  // Calculate median interval (more robust than mean)
  intervals.sort((a, b) => a - b)
  const medianInterval = intervals[Math.floor(intervals.length / 2)]

  // Convert to Hz
  return 1000 / medianInterval
}

/**
 * Check if a timestamp falls within any of the given time ranges
 */
export function isInTimeRange(
  timestamp: number,  // Unix ms
  ranges: TimeRange[]
): boolean {
  return ranges.some(range => timestamp >= range.start && timestamp <= range.end)
}
