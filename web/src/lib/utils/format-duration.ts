/**
 * Format duration in seconds to a human-readable string (e.g., "1h 23m 45s")
 * Shows hours, minutes, and seconds as appropriate
 */
export function formatDurationFromSeconds(seconds: number): string {
  const durationSecs = Math.floor(seconds)
  const durationMins = Math.floor(durationSecs / 60)
  const durationHours = Math.floor(durationMins / 60)
  const remainingMins = durationMins % 60
  const remainingSecs = durationSecs % 60

  if (durationHours > 0) {
    if (remainingMins > 0) {
      if (remainingSecs > 0) {
        return `${durationHours}h ${remainingMins}m ${remainingSecs}s`
      }
      return `${durationHours}h ${remainingMins}m`
    }
    if (remainingSecs > 0) {
      return `${durationHours}h ${remainingSecs}s`
    }
    return `${durationHours}h`
  }

  if (durationMins > 0) {
    if (remainingSecs > 0) {
      return `${durationMins}m ${remainingSecs}s`
    }
    return `${durationMins}m`
  }

  return `${durationSecs}s`
}

/**
 * Format duration from start and end timestamps to a human-readable string
 * @param startTime ISO timestamp string
 * @param endTime ISO timestamp string
 * @returns Formatted duration string (e.g., "1h 23m 45s")
 */
export function formatDurationFromTimestamps(startTime: string, endTime: string): string {
  const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime()
  const durationSeconds = durationMs / 1000
  return formatDurationFromSeconds(durationSeconds)
}

/**
 * Format duration from milliseconds to a human-readable string
 * @param ms Duration in milliseconds
 * @returns Formatted duration string (e.g., "1h 23m 45s")
 */
export function formatDurationFromMilliseconds(ms: number): string {
  const durationSeconds = ms / 1000
  return formatDurationFromSeconds(durationSeconds)
}

