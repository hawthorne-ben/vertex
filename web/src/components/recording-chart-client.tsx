'use client'

import { useState, useCallback } from 'react'
import { IMUSensorChart } from './charts/IMUSensorChart'
import type { IMUSample } from './charts/hooks/useIMUData'

interface RecordingChartClientProps {
  recordingId: string
  startTime: string
  endTime: string
  initialSamples: IMUSample[]
  originalCount: number
}

export function RecordingChartClient({
  recordingId,
  startTime,
  endTime,
  initialSamples,
  originalCount
}: RecordingChartClientProps) {
  const [zoomRange, setZoomRange] = useState<{ start: string; end: string } | null>(null)

  const handleZoomChange = useCallback((range: { start: string; end: string } | null) => {
    setZoomRange(range)
  }, [])

  const isZoomed = zoomRange !== null

  return (
    <div className="space-y-2">
      <IMUSensorChart
        recordings={[{
          id: recordingId,
          start_time: startTime,
          end_time: endTime
        }]}
        initialSamples={isZoomed ? undefined : initialSamples}
        originalCount={isZoomed ? undefined : originalCount}
        zoomRange={zoomRange}
        onZoomChange={handleZoomChange}
      />
      {isZoomed && (
        <button
          onClick={() => setZoomRange(null)}
          className="text-xs text-primary hover:underline"
        >
          Reset zoom
        </button>
      )}
    </div>
  )
}
