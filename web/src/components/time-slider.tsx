'use client'

import { useState, useEffect, useRef } from 'react'
import { Clock } from 'lucide-react'

interface TimeSliderProps {
  startTime: string // ISO timestamp
  endTime: string // ISO timestamp
  selectedTime: number | null // Unix timestamp in seconds, or null
  onTimeChange: (timestamp: number | null) => void
}

export function TimeSlider({ startTime, endTime, selectedTime, onTimeChange }: TimeSliderProps) {
  const startMs = new Date(startTime).getTime()
  const endMs = new Date(endTime).getTime()
  const durationMs = endMs - startMs

  const [isDragging, setIsDragging] = useState(false)

  // Calculate slider position (0-100%)
  const getPositionPercent = (timestamp: number | null): number => {
    if (timestamp === null) return 0
    const timestampMs = timestamp * 1000
    const offset = timestampMs - startMs
    return Math.max(0, Math.min(100, (offset / durationMs) * 100))
  }

  // Calculate timestamp from position (0-100%)
  const getTimestampFromPercent = (percent: number): number => {
    const offsetMs = (percent / 100) * durationMs
    const timestampMs = startMs + offsetMs
    return timestampMs / 1000 // Convert to seconds
  }

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const percent = parseFloat(e.target.value)
    const timestamp = getTimestampFromPercent(percent)
    onTimeChange(timestamp)
  }

  const handleClear = () => {
    onTimeChange(null)
  }

  const formatTime = (timestamp: number | null) => {
    if (timestamp === null) return 'Not selected'
    const date = new Date(timestamp * 1000)
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    })
  }

  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const position = getPositionPercent(selectedTime)

  return (
    <div className="sticky top-0 z-10 bg-background border-b border-border shadow-sm">
      <div className="container mx-auto p-4 md:p-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 min-w-fit">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div className="text-sm font-medium text-foreground">
              {selectedTime !== null ? formatTime(selectedTime) : 'Scrub timeline'}
            </div>
          </div>

          <div className="flex-1 flex items-center gap-3">
            {/* Start time label */}
            <div className="text-xs text-muted-foreground hidden md:block">
              {new Date(startMs).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
              })}
            </div>

            {/* Slider */}
            <div className="flex-1 relative">
              <input
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={position}
                onChange={handleSliderChange}
                onMouseDown={() => setIsDragging(true)}
                onMouseUp={() => setIsDragging(false)}
                onTouchStart={() => setIsDragging(true)}
                onTouchEnd={() => setIsDragging(false)}
                className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none
                  [&::-webkit-slider-thumb]:w-4
                  [&::-webkit-slider-thumb]:h-4
                  [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-primary
                  [&::-webkit-slider-thumb]:cursor-grab
                  [&::-webkit-slider-thumb]:active:cursor-grabbing
                  [&::-webkit-slider-thumb]:hover:scale-110
                  [&::-webkit-slider-thumb]:transition-transform
                  [&::-moz-range-thumb]:w-4
                  [&::-moz-range-thumb]:h-4
                  [&::-moz-range-thumb]:rounded-full
                  [&::-moz-range-thumb]:bg-primary
                  [&::-moz-range-thumb]:border-0
                  [&::-moz-range-thumb]:cursor-grab
                  [&::-moz-range-thumb]:active:cursor-grabbing
                  [&::-moz-range-thumb]:hover:scale-110
                  [&::-moz-range-thumb]:transition-transform"
              />

              {/* Progress bar fill */}
              <div
                className="absolute top-1/2 left-0 h-2 bg-primary/30 rounded-lg pointer-events-none -translate-y-1/2"
                style={{ width: `${position}%` }}
              />
            </div>

            {/* End time label */}
            <div className="text-xs text-muted-foreground hidden md:block">
              {new Date(endMs).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
              })}
            </div>
          </div>

          {/* Duration and clear button */}
          <div className="flex items-center gap-3 min-w-fit">
            <div className="text-xs text-muted-foreground hidden sm:block">
              {formatDuration(durationMs)}
            </div>
            {selectedTime !== null && (
              <button
                onClick={handleClear}
                className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80 text-muted-foreground"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Offset from start (helpful for debugging sync) */}
        {selectedTime !== null && (
          <div className="text-xs text-muted-foreground mt-2">
            +{formatDuration((selectedTime * 1000) - startMs)} from start
          </div>
        )}
      </div>
    </div>
  )
}
