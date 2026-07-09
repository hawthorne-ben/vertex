/**
 * Shared formatting utilities
 * Consolidates duplicate formatting logic from across the app
 */

/**
 * Format a date string to a localized readable format
 *
 * @param dateString - ISO 8601 date string to format
 * @param format - Output format: 'short' (default) or 'long'
 * @returns Formatted date string
 *
 * @example
 * formatDate('2024-01-15T10:30:00Z') // "Jan 15, 2024, 10:30 AM"
 * formatDate('2024-01-15T10:30:00Z', 'long') // "Monday, January 15, 2024, 10:30 AM"
 */
export function formatDate(dateString: string, format: 'short' | 'long' = 'short'): string {
  const date = new Date(dateString)

  if (format === 'short') {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }

  return date.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * Format file size in bytes to human-readable format
 *
 * @param bytes - File size in bytes
 * @returns Formatted file size string (B, KB, or MB)
 *
 * @example
 * formatFileSize(500) // "500 B"
 * formatFileSize(2048) // "2.0 KB"
 * formatFileSize(5242880) // "5.0 MB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Format duration from milliseconds to human-readable format
 * Shows hours and minutes for long durations, minutes and seconds for short
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 *
 * @example
 * formatDurationMs(45000) // "45s"
 * formatDurationMs(135000) // "2m 15s"
 * formatDurationMs(7200000) // "2h 0m"
 */
export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  } else {
    return `${seconds}s`
  }
}

/**
 * Format duration from seconds (detailed version showing all units)
 * Displays hours, minutes, and seconds as appropriate, omitting zero values
 *
 * @param seconds - Duration in seconds
 * @returns Formatted duration string with all non-zero units
 *
 * @example
 * formatDurationFromSeconds(45) // "45s"
 * formatDurationFromSeconds(135) // "2m 15s"
 * formatDurationFromSeconds(7200) // "2h"
 * formatDurationFromSeconds(7335) // "2h 2m 15s"
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
 * Format duration from seconds (compact version, omits seconds if hours present)
 * Used for displaying ride durations in cards and summaries
 *
 * @param seconds - Duration in seconds
 * @returns Compact formatted duration string
 *
 * @example
 * formatDurationSeconds(45) // "45s"
 * formatDurationSeconds(135) // "2m 15s"
 * formatDurationSeconds(7335) // "2h 2m" (seconds omitted)
 */
export function formatDurationSeconds(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`
  } else {
    return `${secs}s`
  }
}

/**
 * Format duration from milliseconds (alias using detailed formatting)
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string with all non-zero units
 *
 * @example
 * formatDurationFromMilliseconds(45000) // "45s"
 * formatDurationFromMilliseconds(135000) // "2m 15s"
 */
export function formatDurationFromMilliseconds(ms: number): string {
  const durationSeconds = ms / 1000
  return formatDurationFromSeconds(durationSeconds)
}

/**
 * Resolve how to present a ride's duration, preferring computed *riding time*
 * (moving time, stops excluded — from FIT `analysis_results.riding_time_seconds`)
 * as the headline, with *elapsed* time as a secondary value.
 *
 * Falls back to elapsed-only when riding time is unavailable (e.g. old rides
 * not re-parsed, or VTX-only rides with no FIT), so callers never render an
 * empty state. Elapsed is only shown as a secondary line when it meaningfully
 * differs from riding time (stops present).
 *
 * @param elapsedSeconds - Wall-clock elapsed duration (rides.duration_seconds)
 * @param ridingTimeSeconds - Computed moving time, or null/undefined if absent
 */
export function resolveRideDuration(
  elapsedSeconds: number | null | undefined,
  ridingTimeSeconds: number | null | undefined,
): { label: string; primary: string; secondary: string | null } {
  const elapsed = elapsedSeconds ?? 0
  const hasRiding = ridingTimeSeconds != null && ridingTimeSeconds > 0

  if (!hasRiding) {
    return { label: 'Duration', primary: formatDurationFromSeconds(elapsed), secondary: null }
  }

  const riding = ridingTimeSeconds as number
  // Only surface elapsed separately when stops make it meaningfully longer
  // (>60s difference), so a stop-free ride doesn't show a redundant subtitle.
  const showElapsed = elapsed - riding > 60
  return {
    label: 'Riding time',
    primary: formatDurationFromSeconds(riding),
    secondary: showElapsed ? `${formatDurationFromSeconds(elapsed)} elapsed` : null,
  }
}

/**
 * Format duration from two timestamps
 * Calculates the difference between timestamps and formats as duration
 *
 * @param startTime - ISO 8601 start timestamp
 * @param endTime - ISO 8601 end timestamp
 * @returns Formatted duration string
 *
 * @example
 * formatDurationFromTimestamps('2024-01-15T10:00:00Z', '2024-01-15T10:02:15Z') // "2m 15s"
 */
export function formatDurationFromTimestamps(startTime: string, endTime: string): string {
  const start = new Date(startTime).getTime()
  const end = new Date(endTime).getTime()
  const durationMs = end - start
  return formatDurationMs(durationMs)
}

/**
 * Format distance from meters to specified unit
 *
 * @param meters - Distance in meters (null returns 'N/A')
 * @param unit - Output unit: 'mi' (default) or 'km'
 * @returns Formatted distance string with unit
 *
 * @example
 * formatDistance(1609.34) // "1.00 mi"
 * formatDistance(1000, 'km') // "1.00 km"
 * formatDistance(null) // "N/A"
 */
export function formatDistance(meters: number | null, unit: 'mi' | 'km' = 'mi'): string {
  if (meters === null || meters === undefined) return 'N/A'

  if (unit === 'mi') {
    const miles = meters * 0.000621371
    return `${miles.toFixed(2)} mi`
  } else {
    const km = meters / 1000
    return `${km.toFixed(2)} km`
  }
}

/**
 * Format elevation from meters to specified unit
 *
 * @param meters - Elevation in meters (null returns 'N/A')
 * @param unit - Output unit: 'ft' (default) or 'm'
 * @returns Formatted elevation string with unit
 *
 * @example
 * formatElevation(100) // "328 ft"
 * formatElevation(100, 'm') // "100 m"
 * formatElevation(null) // "N/A"
 */
export function formatElevation(meters: number | null, unit: 'ft' | 'm' = 'ft'): string {
  if (meters === null || meters === undefined) return 'N/A'

  if (unit === 'ft') {
    const feet = meters * 3.28084
    return `${feet.toFixed(0)} ft`
  } else {
    return `${meters.toFixed(0)} m`
  }
}

/**
 * Format elapsed time for displaying processing duration
 * Used by useElapsedTime hook to show "Processing... (5m 23s)" strings
 *
 * @param elapsedMs - Elapsed time in milliseconds
 * @param format - Output format: 'long' (default), 'short', or 'seconds'
 * @returns Formatted elapsed time string
 *
 * @example
 * formatElapsedTime(323000) // "Processing... (5m 23s)"
 * formatElapsedTime(323000, 'short') // "5m 23s"
 * formatElapsedTime(323000, 'seconds') // "323s"
 */
export function formatElapsedTime(elapsedMs: number, format: 'short' | 'long' | 'seconds' = 'long'): string {
  const totalSeconds = Math.floor(elapsedMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (format === 'seconds') {
    return `${totalSeconds}s`
  } else if (format === 'short') {
    return `${minutes}m ${seconds}s`
  } else {
    return `Processing... (${minutes}m ${seconds}s)`
  }
}

/**
 * Format a time range display for recording cards
 * Shows date and time span in a compact format
 *
 * @param startTime - ISO 8601 start timestamp
 * @param endTime - ISO 8601 end timestamp
 * @returns Formatted time range string
 *
 * @example
 * formatTimeRange('2024-10-24T19:02:00Z', '2024-10-24T19:06:00Z')
 * // "Oct 24, 7:02 PM → 7:06 PM"
 */
/**
 * Translate a 0–100 stability percentage into plain-language language
 * for the consumer-facing dashboard. Higher is steadier.
 */
export function describeStability(percent: number | null | undefined): string {
  if (percent == null) return 'No data'
  if (percent >= 80) return 'Very steady'
  if (percent >= 65) return 'Steady'
  if (percent >= 50) return 'Somewhat unsteady'
  return 'Unsteady'
}

/**
 * Translate a raw roughness value (0–1, HPF accel_z RMS normalized) into
 * plain-language road-surface language. Lower is smoother.
 */
export function describeRoughness(value: number | null | undefined): string {
  if (value == null) return 'No data'
  if (value < 0.3) return 'Smooth roads'
  if (value < 0.55) return 'Mixed surface'
  if (value < 0.8) return 'Rough roads'
  return 'Very rough'
}

export function formatTimeRange(startTime: string, endTime: string): string {
  try {
    const startDate = new Date(startTime)
    const endDate = new Date(endTime)

    const dateStr = startDate.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    })

    const startTimeStr = startDate.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })

    const endTimeStr = endDate.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })

    return `${dateStr}, ${startTimeStr} → ${endTimeStr}`
  } catch (error) {
    return 'Invalid Date'
  }
}
