'use client'

import { useElapsedTime } from '@/hooks/useElapsedTime'
import { Recording } from '@/types/recordings'
import { useRef } from 'react'

interface ProcessingProgressProps {
  recording: Recording
}

/**
 * Displays processing progress for a recording
 * Handles all states: queued, downloading, processing with progress bar
 */
export function ProcessingProgress({ recording }: ProcessingProgressProps) {
  const timeEstimatesRef = useRef<Record<string, number[]>>({})

  const elapsed = useElapsedTime(recording.processing_started_at, {
    format: 'long',
    updateInterval: 1000
  })

  // Real progress tracking available (batch processing has started)
  if (recording.samples_processed != null && recording.samples_processed > 0 && recording.sample_count && recording.sample_count > 0) {
    const percentage = Math.min(100, Math.round((recording.samples_processed / recording.sample_count) * 100))

    // Calculate time remaining
    let timeRemaining = 'Computing time remaining...'
    if (recording.processing_started_at) {
      try {
        const startTime = new Date(recording.processing_started_at).getTime()
        const now = Date.now()
        const elapsedSeconds = (now - startTime) / 1000

        // Calculate actual processing rate (samples per second)
        const samplesPerSecond = recording.samples_processed / elapsedSeconds

        // Calculate remaining based on actual samples left
        const remainingSamples = recording.sample_count - recording.samples_processed
        const estimatedSecondsRemaining = remainingSamples / samplesPerSecond

        // Buffer estimates for smoothing using ref (no state update during render)
        const currentEstimates = timeEstimatesRef.current[recording.id] || []
        const updatedEstimates = [...currentEstimates, estimatedSecondsRemaining].slice(-4) // Keep last 4 estimates
        timeEstimatesRef.current[recording.id] = updatedEstimates

        // Wait for at least 3 updates before showing estimate
        if (updatedEstimates.length >= 3) {
          // Use average of buffered estimates for smoothing
          const avgEstimate = updatedEstimates.reduce((a, b) => a + b, 0) / updatedEstimates.length

          if (avgEstimate < 60) {
            timeRemaining = `~${Math.round(avgEstimate)}s remaining`
          } else {
            const minutes = Math.round(avgEstimate / 60)
            timeRemaining = `~${minutes}m remaining`
          }
        }
      } catch (error) {
        timeRemaining = 'Calculating...'
      }
    }

    return (
      <div className="mt-4" role="status" aria-live="polite" aria-atomic="true">
        <div className="flex justify-between items-center text-sm mb-2">
          <span className="text-secondary">Processing samples...</span>
          <span className="text-primary font-mono font-semibold" aria-label={`${percentage} percent complete`}>
            {percentage}%
          </span>
        </div>
        <div className="w-full bg-muted rounded-full h-2.5 mb-2" role="progressbar" aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
          <div
            className="bg-info h-2.5 rounded-full transition-all duration-500"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-secondary">
          <span>
            {recording.samples_processed.toLocaleString()} / {recording.sample_count.toLocaleString()} samples
          </span>
          <span className="font-mono">{timeRemaining}</span>
        </div>
      </div>
    )
  }

  // Processing has started but no batch progress yet (downloading/parsing CSV)
  if (recording.processing_started_at) {
    return (
      <div className="mt-4" role="status" aria-live="polite">
        <div className="text-sm text-secondary mb-2">
          <strong className="text-info">Processing started...</strong>
        </div>
        <div className="w-full bg-muted rounded-full h-2.5 mb-2 overflow-hidden" role="progressbar" aria-valuetext="Processing">
          <div
            className="bg-info h-2.5 rounded-full transition-all duration-1000 animate-pulse"
            style={{ width: '100%' }}
          />
        </div>
        <div className="text-xs text-secondary">{elapsed}</div>
      </div>
    )
  }

  // Queued but not started yet
  return (
    <div className="mt-4 text-sm text-secondary" role="status" aria-live="polite">
      <div className="mb-2">
        <strong className="text-info">Queued for processing...</strong>
      </div>
      <div className="text-xs text-secondary">Job will start momentarily</div>
    </div>
  )
}
