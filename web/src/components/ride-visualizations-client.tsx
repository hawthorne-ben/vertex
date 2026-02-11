'use client'

import { useState, useMemo } from 'react'
import { TimeSlider } from './time-slider'
import { RideMapClient } from './ride-map-client'
import { RideChartsClient } from './ride-charts-client'
import { RideDataTabs } from './charts/RideDataTabs'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'
import { MapErrorBoundary } from './map-error-boundary'
import { getVtxTimeRanges } from '@/lib/sync/fit-vtx-sync'
import { useRideSamples } from './hooks/useRideSamples'
import { useDerivedMetric } from './charts/hooks/useDerivedMetric'

interface VTXRecordingWithSamples {
  id: string
  filename: string
  start_time: string
  end_time: string
  duration_ms: number
  file_size_bytes: number
  status: string
  samples: Array<{
    id: string
    timestamp: string
    [key: string]: unknown
  }> | null
  originalCount: number
}

interface RideVisualizationsClientProps {
  rideId: string
  rideName?: string
  rideStartTime: string
  rideEndTime: string
  fitRecordingId: string | null
  hasGpsData: boolean
  vtxRecordings: VTXRecordingWithSamples[]
}

export function RideVisualizationsClient({
  rideId,
  rideName,
  rideStartTime,
  rideEndTime,
  fitRecordingId,
  hasGpsData,
  vtxRecordings
}: RideVisualizationsClientProps) {
  const [selectedTime, setSelectedTime] = useState<number | null>(null)
  const [imuCoverageRanges, setImuCoverageRanges] = useState<Array<{ start: number; end: number }>>([])
  const [sharedZoomRange, setSharedZoomRange] = useState<{ start: string; end: string } | null>(null)
  const [activeDataTab, setActiveDataTab] = useState<'imu' | 'analytics'>('imu')

  // Fetch ride samples once - shared between map and charts
  const { samples, loading, error } = useRideSamples(rideId, fitRecordingId)

  // Fetch pedaling efficiency data for map overlay (1 Hz to match GPS frequency)
  const {
    samples: efficiencySamples,
    loading: efficiencyLoading
  } = useDerivedMetric({
    rideId,
    metric: 'pedalingEfficiency',
    timeRange: null, // Always fetch full ride for map
    fitRecordingId,
    resolution: 1 // 1 sample per second (matches GPS frequency)
  })

  // Calculate IMU time ranges for GPS color coding
  // Use coverage ranges from VTX data if available, otherwise fall back to full recording ranges
  const imuTimeRanges = useMemo(() => {
    if (imuCoverageRanges.length > 0) {
      return imuCoverageRanges
    }
    return getVtxTimeRanges(vtxRecordings)
  }, [imuCoverageRanges, vtxRecordings])

  // Check if we have VTX data to display
  const hasVtxData = vtxRecordings.length > 0

  // Memoize the mapped vtx recordings to avoid recreating on every render
  const vtxRecordingsForChart = useMemo(() => {
    return vtxRecordings.map(vtx => ({
      id: vtx.id,
      start_time: vtx.start_time,
      end_time: vtx.end_time
    }))
  }, [vtxRecordings])

  return (
    <>
      {/* GPS Map */}
      <div className="mb-8">
        {fitRecordingId && hasGpsData ? (
          <MapErrorBoundary>
            <RideMapClient
              rideId={rideId}
              fitRecordingId={fitRecordingId}
              highlightTime={selectedTime}
              imuTimeRanges={imuTimeRanges}
              samples={samples}
              loading={loading}
              error={error}
              mapMode={activeDataTab === 'analytics' ? 'efficiency' : 'vtx'}
              efficiencySamples={efficiencySamples}
              efficiencyLoading={efficiencyLoading}
            />
          </MapErrorBoundary>
        ) : (
          <Card>
            <CardContent className="h-[400px] flex items-center justify-center">
              <p className="text-muted-foreground">No GPS data available</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Time Slider */}
      <div className="mb-8">
        <TimeSlider
          startTime={rideStartTime}
          endTime={rideEndTime}
          selectedTime={selectedTime}
          onTimeChange={setSelectedTime}
        />
      </div>

      {/* Unified IMU Chart & Analytics */}
      {hasVtxData && (
        <div className="mb-8">
          <RideDataTabs
            vtxRecordings={vtxRecordingsForChart}
            rideId={rideId}
            rideName={rideName}
            fitRecordingId={fitRecordingId}
            highlightTime={selectedTime}
            onCoverageUpdate={setImuCoverageRanges}
            zoomRange={sharedZoomRange}
            onZoomChange={setSharedZoomRange}
            onTabChange={setActiveDataTab}
          />
        </div>
      )}

      {/* FIT Performance Charts */}
      {fitRecordingId && (
        <div className="mb-8">
          <RideChartsClient
            rideId={rideId}
            fitRecordingId={fitRecordingId}
            highlightTime={selectedTime}
            samples={samples}
            loading={loading}
            error={error}
            zoomRange={sharedZoomRange}
            onZoomChange={setSharedZoomRange}
          />
        </div>
      )}
    </>
  )
}
