'use client'

import { useMemo, useRef, useState, useCallback } from 'react'

interface RidingPositionSample {
  timestamp: string
  position: 'standing' | 'seated' | null
  rockingMagnitude: number
  cadence: number | null
}

interface RidingPositionChartProps {
  samples: RidingPositionSample[]
  highlightTime?: number | null
  zoomRange?: { start: string; end: string } | null
  onZoom?: (start: string, end: string) => void
}

/**
 * Bar chart visualization for riding position (standing vs. seated)
 * Renders horizontal bars over time instead of scatter plot
 * Supports click-and-drag zoom that persists via shared zoom state
 */
export function RidingPositionChart({
  samples,
  highlightTime,
  zoomRange,
  onZoom
}: RidingPositionChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const [dragStart, setDragStart] = useState<number | null>(null)
  const [dragCurrent, setDragCurrent] = useState<number | null>(null)

  // Group samples into continuous position segments for bar rendering
  const segments = useMemo(() => {
    if (samples.length === 0) return []

    const result: Array<{
      start: number
      end: number
      position: 'standing' | 'seated'
    }> = []

    let currentPosition: 'standing' | 'seated' | null = null
    let segmentStart: number | null = null

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i]
      const timestamp = new Date(sample.timestamp).getTime()

      if (sample.position === null) {
        // End current segment if pedaling stopped
        if (currentPosition !== null && segmentStart !== null) {
          result.push({
            start: segmentStart,
            end: timestamp,
            position: currentPosition
          })
          currentPosition = null
          segmentStart = null
        }
      } else if (sample.position !== currentPosition) {
        // Position changed - end current segment and start new one
        if (currentPosition !== null && segmentStart !== null) {
          result.push({
            start: segmentStart,
            end: timestamp,
            position: currentPosition
          })
        }
        currentPosition = sample.position
        segmentStart = timestamp
      }
    }

    // Close final segment
    if (currentPosition !== null && segmentStart !== null) {
      const lastTimestamp = new Date(samples[samples.length - 1].timestamp).getTime()
      result.push({
        start: segmentStart,
        end: lastTimestamp,
        position: currentPosition
      })
    }

    return result
  }, [samples])

  // Compute the visible time range (zoom or full)
  const timeRange = useMemo(() => {
    if (samples.length === 0) return null

    const fullStart = new Date(samples[0].timestamp).getTime()
    const fullEnd = new Date(samples[samples.length - 1].timestamp).getTime()

    if (zoomRange) {
      const zoomStart = new Date(zoomRange.start).getTime()
      const zoomEnd = new Date(zoomRange.end).getTime()
      return { start: zoomStart, end: zoomEnd }
    }

    return { start: fullStart, end: fullEnd }
  }, [samples, zoomRange])

  // Clip segments to the visible time range
  const visibleSegments = useMemo(() => {
    if (!timeRange) return []
    const { start, end } = timeRange

    return segments
      .map(seg => ({
        ...seg,
        start: Math.max(seg.start, start),
        end: Math.min(seg.end, end),
        position: seg.position,
      }))
      .filter(seg => seg.start < seg.end && seg.end > start && seg.start < end)
  }, [segments, timeRange])

  // Compute highlight position as a clamped percentage within visible range
  const highlightPercent = useMemo(() => {
    if (highlightTime === null || highlightTime === undefined || !timeRange) return null

    const totalDuration = timeRange.end - timeRange.start
    if (totalDuration <= 0) return null

    const pct = ((highlightTime * 1000 - timeRange.start) / totalDuration) * 100
    if (pct < 0 || pct > 100) return null
    return pct
  }, [highlightTime, timeRange])

  // Convert pixel X position to timestamp within the visible range
  const pxToTime = useCallback((clientX: number): number | null => {
    if (!chartRef.current || !timeRange) return null
    const rect = chartRef.current.getBoundingClientRect()
    const pct = (clientX - rect.left) / rect.width
    if (pct < 0 || pct > 1) return null
    return timeRange.start + pct * (timeRange.end - timeRange.start)
  }, [timeRange])

  // Drag-to-zoom handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onZoom) return
    const time = pxToTime(e.clientX)
    if (time !== null) {
      setDragStart(time)
      setDragCurrent(time)
    }
  }, [onZoom, pxToTime])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragStart === null) return
    const time = pxToTime(e.clientX)
    if (time !== null) {
      setDragCurrent(time)
    }
  }, [dragStart, pxToTime])

  const handleMouseUp = useCallback(() => {
    if (dragStart === null || dragCurrent === null || !onZoom || !timeRange) {
      setDragStart(null)
      setDragCurrent(null)
      return
    }

    const selStart = Math.min(dragStart, dragCurrent)
    const selEnd = Math.max(dragStart, dragCurrent)
    const totalDuration = timeRange.end - timeRange.start

    // Only zoom if selection is at least 1% of visible range
    if ((selEnd - selStart) / totalDuration > 0.01) {
      onZoom(new Date(selStart).toISOString(), new Date(selEnd).toISOString())
    }

    setDragStart(null)
    setDragCurrent(null)
  }, [dragStart, dragCurrent, onZoom, timeRange])

  const handleMouseLeave = useCallback(() => {
    setDragStart(null)
    setDragCurrent(null)
  }, [])

  // Compute drag selection overlay position
  const selectionStyle = useMemo(() => {
    if (dragStart === null || dragCurrent === null || !timeRange) return null
    const totalDuration = timeRange.end - timeRange.start
    if (totalDuration <= 0) return null

    const left = ((Math.min(dragStart, dragCurrent) - timeRange.start) / totalDuration) * 100
    const width = (Math.abs(dragCurrent - dragStart) / totalDuration) * 100

    return {
      left: `${Math.max(0, left)}%`,
      width: `${Math.min(width, 100 - Math.max(0, left))}%`,
    }
  }, [dragStart, dragCurrent, timeRange])

  return (
    <div className="space-y-4">
      {/* Bar chart visualization */}
      <div className="border border-border rounded-lg p-6 bg-card">
        <div
          ref={chartRef}
          className="relative overflow-hidden select-none"
          style={{ height: '200px', cursor: onZoom ? 'crosshair' : 'default' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          {visibleSegments.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              No position data available (not pedaling)
            </div>
          ) : (
            <div className="relative w-full h-full">
              {/* Timeline background */}
              <div className="absolute inset-0 flex items-center">
                <div className="w-full h-16 bg-muted/30 rounded"></div>
              </div>

              {/* Position bars */}
              {visibleSegments.map((segment, idx) => {
                if (!timeRange) return null
                const totalDuration = timeRange.end - timeRange.start

                const leftPercent = ((segment.start - timeRange.start) / totalDuration) * 100
                const widthPercent = ((segment.end - segment.start) / totalDuration) * 100

                const positionLabel = segment.position
                  ? segment.position.charAt(0).toUpperCase() + segment.position.slice(1)
                  : 'Unknown'

                return (
                  <div
                    key={idx}
                    className="absolute top-1/2 -translate-y-1/2 h-16 rounded transition-opacity hover:opacity-80"
                    style={{
                      left: `${leftPercent}%`,
                      width: `${widthPercent}%`,
                      backgroundColor: segment.position === 'standing'
                        ? 'hsl(0, 84%, 60%)'
                        : 'hsl(145, 70%, 50%)',
                    }}
                    title={`${positionLabel}: ${new Date(segment.start).toLocaleTimeString()} - ${new Date(segment.end).toLocaleTimeString()}`}
                  />
                )
              })}

              {/* Drag selection overlay */}
              {selectionStyle && (
                <div
                  className="absolute top-0 bottom-0 z-20 pointer-events-none bg-blue-500/20 border-l border-r border-blue-500/50"
                  style={selectionStyle}
                />
              )}

              {/* Highlight indicator — dashed blue, bounded */}
              {highlightPercent !== null && (
                <div
                  className="absolute top-0 bottom-0 z-10 pointer-events-none"
                  style={{
                    left: `${highlightPercent}%`,
                    width: '2px',
                    backgroundImage: 'repeating-linear-gradient(to bottom, rgba(59,130,246,0.6) 0px, rgba(59,130,246,0.6) 5px, transparent 5px, transparent 10px)',
                  }}
                />
              )}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 mt-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: 'hsl(145, 70%, 50%)' }}></div>
            <span className="text-muted-foreground">Seated</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: 'hsl(0, 84%, 60%)' }}></div>
            <span className="text-muted-foreground">Standing</span>
          </div>
        </div>
      </div>

      {/* Time axis labels */}
      {timeRange && (
        <div className="flex justify-between text-xs text-muted-foreground px-6">
          <span>{new Date(timeRange.start).toLocaleTimeString()}</span>
          <span>{new Date(timeRange.end).toLocaleTimeString()}</span>
        </div>
      )}
    </div>
  )
}
