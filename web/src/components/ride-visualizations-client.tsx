'use client'

import { useState } from 'react'
import { TimeSlider } from './time-slider'
import { RideMapClient } from './ride-map-client'
import { RideChartsClient } from './ride-charts-client'
import { IMUUPlotCharts } from './imu-uplot-charts'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'

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

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <>
      {/* Time Slider */}
      <TimeSlider
        startTime={rideStartTime}
        endTime={rideEndTime}
        selectedTime={selectedTime}
        onTimeChange={setSelectedTime}
      />

      {/* GPS Map */}
      {fitRecordingId && hasGpsData && (
        <div className="mb-8">
          <RideMapClient
            rideId={rideId}
            fitRecordingId={fitRecordingId}
            highlightTime={selectedTime}
          />
        </div>
      )}

      {/* IMU Charts */}
      {vtxRecordings.length > 0 && (
        <div className="space-y-6 mb-8">
          {vtxRecordings.map((vtx) => (
            <Card key={vtx.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>IMU Data: {vtx.filename}</CardTitle>
                  <a
                    href={`/recordings/${vtx.id}`}
                    className="px-3 py-1 text-sm bg-muted border border-border rounded hover:bg-muted/80 text-foreground"
                  >
                    View Full Detail
                  </a>
                </div>
                <div className="text-sm text-muted-foreground mt-2">
                  {new Date(vtx.start_time).toLocaleString()} • {formatFileSize(vtx.file_size_bytes)} • {vtx.originalCount.toLocaleString()} samples
                </div>
              </CardHeader>
              <CardContent>
                {vtx.samples && vtx.samples.length > 0 ? (
                  <IMUUPlotCharts
                    fileId={vtx.id}
                    initialSamples={vtx.samples}
                    originalCount={vtx.originalCount}
                    highlightTime={selectedTime}
                  />
                ) : (
                  <div className="text-muted-foreground text-center py-8">
                    <div>No sample data loaded</div>
                    <div className="text-xs mt-2">
                      Status: {vtx.status || 'unknown'} • Samples: {vtx.samples?.length || 0} • Original: {vtx.originalCount || 0}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
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
