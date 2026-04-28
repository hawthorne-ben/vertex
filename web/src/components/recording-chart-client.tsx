'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { IMUSensorChart } from './charts/IMUSensorChart'
import { FilterWorkbench } from './charts/FilterWorkbench'
import { useFilteredStreams } from './charts/hooks/useFilteredStreams'
import { useAuthFetch } from '@/hooks/useAuthFetch'
import type { IMUSample, IMUDataType } from './charts/hooks/useIMUData'
import type { FilterDefinition } from './charts/hooks/useFilteredStreams'

interface RecordingChartClientProps {
  recordingId: string
  startTime: string
  endTime: string
  initialSamples: IMUSample[]
  originalCount: number
}

const MAX_FILTER_DURATION_S = 600 // 10 minutes

export function RecordingChartClient({
  recordingId,
  startTime,
  endTime,
  initialSamples,
  originalCount
}: RecordingChartClientProps) {
  const [zoomRange, setZoomRange] = useState<{ start: string; end: string } | null>(null)
  const [dataType, setDataType] = useState<IMUDataType>('accel')
  const [filters, setFilters] = useState<FilterDefinition[]>([])
  const [fullResSamples, setFullResSamples] = useState<IMUSample[] | null>(null)
  const [fullResLoading, setFullResLoading] = useState(false)
  const [fullResError, setFullResError] = useState<string | null>(null)
  const { authFetch } = useAuthFetch()

  const handleZoomChange = useCallback((range: { start: string; end: string } | null) => {
    setZoomRange(range)
    // Invalidate full-res cache when zoom changes — new range needs new fetch
    setFullResSamples(null)
  }, [])

  const isZoomed = zoomRange !== null

  // Visible duration in seconds (for workbench gating)
  const visibleDurationSeconds = useMemo(() => {
    const s = zoomRange?.start ?? startTime
    const e = zoomRange?.end ?? endTime
    return (new Date(e).getTime() - new Date(s).getTime()) / 1000
  }, [zoomRange, startTime, endTime])

  // Fetch full-resolution data when filters are active and duration is within limit.
  // This runs independently of the IMUSensorChart's own data fetching.
  useEffect(() => {
    if (filters.length === 0 || visibleDurationSeconds > MAX_FILTER_DURATION_S) {
      setFullResSamples(null)
      return
    }

    // Already have data for this range
    if (fullResSamples) return

    let cancelled = false
    setFullResError(null)

    const fetchFullRes = async () => {
      setFullResLoading(true)
      try {
        const params = new URLSearchParams({ downsample: 'none' })
        const rangeStart = zoomRange?.start ?? startTime
        const rangeEnd = zoomRange?.end ?? endTime
        params.set('start', rangeStart)
        params.set('end', rangeEnd)
        params.set('fields', 'accel,gyro')

        const res = await authFetch(
          `/api/recordings/${recordingId}/samples?${params.toString()}`
        )
        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`)
        }
        const data = await res.json()

        if (!cancelled && data.samples) {
          const samples: IMUSample[] = data.samples.map((s: any) => ({
            timestamp: s.timestamp,
            accel_x: s.accel?.x ?? 0,
            accel_y: s.accel?.y ?? 0,
            accel_z: s.accel?.z ?? 0,
            gyro_x: s.gyro?.x ?? 0,
            gyro_y: s.gyro?.y ?? 0,
            gyro_z: s.gyro?.z ?? 0,
          }))
          setFullResSamples(samples)
        }
      } catch (err: any) {
        console.error('Failed to fetch full-res samples for filtering:', err)
        if (!cancelled) {
          setFullResError(err.message || 'Failed to load full-resolution data')
        }
      } finally {
        if (!cancelled) setFullResLoading(false)
      }
    }

    fetchFullRes()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.length, visibleDurationSeconds, zoomRange, recordingId, authFetch])

  // Detect sample rate from full-res data
  const sampleRate = useMemo(() => {
    if (!fullResSamples || fullResSamples.length < 2) return 104
    const first = new Date(fullResSamples[0].timestamp).getTime()
    const last = new Date(fullResSamples[fullResSamples.length - 1].timestamp).getTime()
    const durationS = (last - first) / 1000
    return durationS > 0 ? (fullResSamples.length - 1) / durationS : 104
  }, [fullResSamples])

  // Apply filters to full-res data
  const filteredStreams = useFilteredStreams(
    fullResSamples ?? [],
    filters,
    sampleRate,
  )

  // When filters are active and full-res data is loaded, pass full-res data to
  // the chart as initialSamples (overriding its normal LTTB-downsampled fetch).
  // When no filters, fall back to the server-provided downsampled initialSamples.
  const hasActiveFilters = filters.length > 0 && fullResSamples !== null
  const chartSamples = hasActiveFilters ? fullResSamples : (isZoomed ? undefined : initialSamples)
  const chartOriginalCount = hasActiveFilters
    ? fullResSamples.length
    : (isZoomed ? undefined : originalCount)

  return (
    <div className="space-y-2">
      <IMUSensorChart
        recordings={[{
          id: recordingId,
          start_time: startTime,
          end_time: endTime
        }]}
        dataType={dataType}
        initialSamples={chartSamples}
        originalCount={chartOriginalCount}
        parentLoading={fullResLoading}
        zoomRange={zoomRange}
        onZoomChange={handleZoomChange}
        filteredStreams={hasActiveFilters ? filteredStreams : undefined}
        onDataTypeChange={setDataType}
      />

      <FilterWorkbench
        dataType={dataType}
        visibleDurationSeconds={visibleDurationSeconds}
        activeFilters={filters}
        onFiltersChange={setFilters}
        loading={fullResLoading}
        error={fullResError}
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
