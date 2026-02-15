'use client'

import { memo, useCallback } from 'react'
import { FileText, CheckCircle2, AlertCircle, Loader2, Clock, Check } from 'lucide-react'
import Link from 'next/link'
import { Recording } from '@/types/recordings'
import { formatFileSize, formatTimeRange, formatDurationFromTimestamps } from '@/lib/utils/formatting'
import { ProcessingProgress } from './ProcessingProgress'
import { Tooltip } from '@/components/ui/tooltip'
import { useElapsedTime } from '@/hooks/useElapsedTime'

interface RecordingCardProps {
  recording: Recording
  isSelected: boolean
  onToggleSelection: (id: string, e: React.MouseEvent) => void
  onNavigate?: (id: string) => void
  inSelectionMode: boolean
}

/**
 * Individual recording card component
 * Extracted from data-files-list.tsx to reduce complexity
 */
export const RecordingCard = memo(function RecordingCard({
  recording,
  isSelected,
  onToggleSelection,
  onNavigate,
  inSelectionMode
}: RecordingCardProps) {
  // For small files in processing, show elapsed time
  const elapsedTime = useElapsedTime(
    recording.status === 'parsing' && recording.file_size_bytes <= 10 * 1024 * 1024
      ? recording.uploaded_at
      : null,
    { format: 'long' }
  )

  const handleToggle = useCallback((e: React.MouseEvent) => {
    onToggleSelection(recording.id, e)
  }, [recording.id, onToggleSelection])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onToggleSelection(recording.id, e as any)
    }
  }, [recording.id, onToggleSelection])

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Prevent navigation when in selection mode
    if (inSelectionMode) {
      e.preventDefault()
    } else if (onNavigate) {
      e.preventDefault()
      onNavigate(recording.id)
    }
  }, [inSelectionMode, onNavigate, recording.id])

  // Status icon
  const StatusIcon = () => {
    switch (recording.status) {
      case 'parsing':
        return (
          <Tooltip content="Parsing" side="right">
            <Loader2 className="w-6 h-6 text-info animate-spin" />
          </Tooltip>
        )
      case 'ready':
        return (
          <Tooltip content="Ready" side="right">
            <CheckCircle2 className="w-6 h-6 text-success" />
          </Tooltip>
        )
      case 'failed':
        return (
          <Tooltip content="Failed" side="right">
            <AlertCircle className="w-6 h-6 text-error" />
          </Tooltip>
        )
      case 'uploaded':
        return (
          <Tooltip content="Uploaded" side="right">
            <Clock className="w-6 h-6 text-secondary" />
          </Tooltip>
        )
    }
  }

  // Title based on status
  const getTitle = () => {
    if (recording.start_time && recording.end_time) {
      return formatTimeRange(recording.start_time, recording.end_time)
    }

    if (recording.status === 'parsing') {
      // For small files, show simple processing text
      if (recording.file_size_bytes && recording.file_size_bytes <= 10 * 1024 * 1024) {
        return <span className="text-secondary">Processing...</span>
      }
      return <span className="text-info">{elapsedTime}</span>
    }

    return <span className="text-secondary">Processing...</span>
  }

  return (
    <div className="card-interactive relative p-6 rounded-lg group">
      {/* Checkbox overlay (visible on hover or when selected) */}
      <div
        className={`absolute top-4 right-4 z-10 transition-opacity ${
          isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <button
          onClick={handleToggle}
          onKeyDown={handleKeyDown}
          className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all ${
            isSelected
              ? 'bg-primary border-primary'
              : 'bg-background border-border hover:border-primary'
          }`}
          aria-label={`Select ${recording.filename}`}
          aria-pressed={isSelected}
        >
          {isSelected && <Check className="w-4 h-4 text-primary-foreground" aria-hidden="true" />}
        </button>
      </div>

      <Link
        href={`/recordings/${recording.id}`}
        className="block"
        onClick={handleClick}
      >
        <div className="flex items-start gap-4">
          {/* Status icon */}
          <div className="flex-shrink-0 mt-1">
            <StatusIcon />
          </div>

          {/* Recording info */}
          <div className="flex-grow min-w-0">
            <div className="flex items-start justify-between mb-2 gap-3">
              <h3 className="text-lg font-medium text-primary">{getTitle()}</h3>
            </div>

            {/* Metadata grid - only show for completed files */}
            {recording.status === 'ready' && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                {recording.sample_count && (
                  <div>
                    <span className="text-secondary block">Samples</span>
                    <span className="text-primary">
                      {recording.sample_count.toLocaleString()}
                    </span>
                  </div>
                )}

                {recording.sample_rate && (
                  <div>
                    <span className="text-secondary block">Sample Rate</span>
                    <span className="text-primary">{recording.sample_rate} Hz</span>
                  </div>
                )}

                {recording.start_time && recording.end_time && (
                  <div>
                    <span className="text-secondary block">Duration</span>
                    <span className="text-primary">
                      {formatDurationFromTimestamps(recording.start_time, recording.end_time)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Source file (de-emphasized) */}
            {recording.filename && (
              <div className="mt-3 text-xs text-secondary">
                Source: {recording.filename} ({formatFileSize(recording.file_size_bytes)})
              </div>
            )}

            {/* Processing progress indicator */}
            {recording.status === 'parsing' && (
              <ProcessingProgress recording={recording} />
            )}

            {/* Error message */}
            {recording.status === 'failed' && recording.error_message && (
              <div className="mt-3 p-3 bg-error text-error border-error rounded text-sm">
                {recording.error_message}
              </div>
            )}
          </div>
        </div>
      </Link>
    </div>
  )
})
