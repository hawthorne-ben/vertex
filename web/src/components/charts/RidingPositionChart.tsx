'use client'

import { useMemo } from 'react'

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
 */
export function RidingPositionChart({
  samples,
  highlightTime,
  zoomRange,
  onZoom
}: RidingPositionChartProps) {

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

  // Compute highlight position as a clamped percentage (only when we have data)
  const highlightPercent = useMemo(() => {
    if (highlightTime === null || highlightTime === undefined || samples.length === 0) return null

    const startMs = new Date(samples[0].timestamp).getTime()
    const endMs = new Date(samples[samples.length - 1].timestamp).getTime()
    const totalDuration = endMs - startMs
    if (totalDuration <= 0) return null

    const pct = ((highlightTime * 1000 - startMs) / totalDuration) * 100
    // Clamp to chart bounds
    if (pct < 0 || pct > 100) return null
    return pct
  }, [highlightTime, samples])

  return (
    <div className="space-y-4">
      {/* Bar chart visualization */}
      <div className="border border-border rounded-lg p-6 bg-card">
        <div className="relative overflow-hidden" style={{ height: '200px' }}>
          {segments.length === 0 ? (
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
              {segments.map((segment, idx) => {
                const startTime = new Date(samples[0].timestamp).getTime()
                const endTime = new Date(samples[samples.length - 1].timestamp).getTime()
                const totalDuration = endTime - startTime

                const leftPercent = ((segment.start - startTime) / totalDuration) * 100
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
                        ? 'hsl(25, 90%, 55%)'
                        : 'hsl(145, 70%, 50%)',
                    }}
                    title={`${positionLabel}: ${new Date(segment.start).toLocaleTimeString()} - ${new Date(segment.end).toLocaleTimeString()}`}
                  />
                )
              })}

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
            <div className="w-4 h-4 rounded" style={{ backgroundColor: 'hsl(25, 90%, 55%)' }}></div>
            <span className="text-muted-foreground">Standing</span>
          </div>
        </div>
      </div>

      {/* Time axis labels */}
      {samples.length > 0 && (
        <div className="flex justify-between text-xs text-muted-foreground px-6">
          <span>{new Date(samples[0].timestamp).toLocaleTimeString()}</span>
          <span>{new Date(samples[samples.length - 1].timestamp).toLocaleTimeString()}</span>
        </div>
      )}
    </div>
  )
}
