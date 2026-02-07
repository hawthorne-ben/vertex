import { useState, useEffect } from 'react'
import { formatElapsedTime } from '@/lib/utils/formatting'

export interface UseElapsedTimeOptions {
  format?: 'short' | 'long' | 'seconds'
  updateInterval?: number
}

/**
 * Hook to track and format elapsed time since a start timestamp
 * Replaces duplicate ProcessingTimeDisplay, ProgressTimeDisplay, ElapsedTimeDisplay components
 * Auto-updates on specified interval
 *
 * @param startTime - ISO 8601 timestamp to measure from (null returns default text)
 * @param options - Configuration options
 * @param options.format - Output format: 'long' (default), 'short', or 'seconds'
 * @param options.updateInterval - Update frequency in ms (default: 1000)
 * @returns Formatted elapsed time string
 *
 * @example
 * // Show processing time that updates every second
 * const elapsed = useElapsedTime(recording.processing_started_at)
 * // "Processing... (2m 15s)"
 *
 * @example
 * // Compact format
 * const elapsed = useElapsedTime(recording.uploaded_at, { format: 'short' })
 * // "2m 15s"
 */
export function useElapsedTime(
  startTime: string | null,
  options: UseElapsedTimeOptions = {}
): string {
  const { format = 'long', updateInterval = 1000 } = options
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startTime) {
      setElapsed(0)
      return
    }

    const update = () => {
      try {
        const start = new Date(startTime).getTime()
        const now = Date.now()
        setElapsed(now - start)
      } catch (error) {
        setElapsed(0)
      }
    }

    // Update immediately
    update()

    // Then update on interval
    const interval = setInterval(update, updateInterval)

    return () => clearInterval(interval)
  }, [startTime, updateInterval])

  if (elapsed === 0 || !startTime) {
    return format === 'long' ? 'Processing...' : '0s'
  }

  return formatElapsedTime(elapsed, format)
}
