'use client'

import { useState, useMemo } from 'react'
import { TimeSlider } from './time-slider'
import { RideMapClient } from './ride-map-client'
import { RideChartsClient } from './ride-charts-client'
import { RideDataTabs } from './charts/RideDataTabs'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'
import { MapErrorBoundary } from './map-error-boundary'
import { getVtxTimeRanges } from '@/lib/sync/fit-vtx-sync'

interface VTXRecordingWithSamples {
  id: string
  filename: string
  start_time: string
  end_time: string
  duration_ms: number
  file_size_bytes: number
  status: string
  samples: any[] | null
  originalCount: number
}

interface RideVisualizationsClientProps {
  rideId: string
  rideStartTime: string
  rideEndTime: string
  fitRecordingId: string | null
  hasGpsData: boolean
  vtxRecordings: VTXRecordingWithSamples[]
}

export function RideVisualizationsClient({
  rideId,
  rideStartTime,
  rideEndTime,
  fitRecordingId,
  hasGpsData,
  vtxRecordings
}: RideVisualizationsClientProps) {
  const [selectedTime, setSelectedTime] = useState<number | null>(null)

  // Calculate IMU time ranges for GPS color coding (using shared sync library)
  const imuTimeRanges = useMemo(() => {
    return getVtxTimeRanges(vtxRecordings)
  }, [vtxRecordings])

  // Check if we have VTX data to display
  const hasVtxData = vtxRecordings.length > 0

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
            vtxRecordings={vtxRecordings.map(vtx => ({
              id: vtx.id,
              start_time: vtx.start_time,
              end_time: vtx.end_time
            }))}
            rideId={rideId}
            fitRecordingId={fitRecordingId}
            highlightTime={selectedTime}
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
          />
        </div>
      )}
    </>
  )
}
