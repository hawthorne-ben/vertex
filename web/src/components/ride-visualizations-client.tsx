'use client'

import { useState, useMemo } from 'react'
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

  // Merge all VTX samples into single unified timeline
  const mergedImuData = useMemo(() => {
    if (vtxRecordings.length === 0) return null

    // Collect all samples from all recordings
    const allSamples: any[] = []
    let totalOriginalCount = 0

    vtxRecordings.forEach((vtx) => {
      if (vtx.samples && vtx.samples.length > 0) {
        allSamples.push(...vtx.samples)
        totalOriginalCount += vtx.originalCount
      }
    })

    if (allSamples.length === 0) return null

    // Sort by timestamp (handles non-overlapping recordings)
    allSamples.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime()
      const timeB = new Date(b.timestamp).getTime()
      return timeA - timeB
    })

    return {
      samples: allSamples,
      originalCount: totalOriginalCount,
      fileCount: vtxRecordings.length,
      filenames: vtxRecordings.map(v => v.filename).join(', ')
    }
  }, [vtxRecordings])

  return (
    <>
      {/* GPS Map */}
      <div className="mb-8">
        {fitRecordingId && hasGpsData ? (
          <RideMapClient
            rideId={rideId}
            fitRecordingId={fitRecordingId}
            highlightTime={selectedTime}
          />
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

      {/* Unified IMU Chart */}
      {mergedImuData && (
        <div className="mb-8">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>
                  IMU Data
                  {mergedImuData.fileCount > 1 && (
                    <span className="text-sm font-normal text-muted-foreground ml-2">
                      ({mergedImuData.fileCount} recordings merged)
                    </span>
                  )}
                </CardTitle>
                {vtxRecordings.length === 1 && (
                  <a
                    href={`/recordings/${vtxRecordings[0].id}`}
                    className="px-3 py-1 text-sm bg-muted border border-border rounded hover:bg-muted/80 text-foreground"
                  >
                    View Full Detail
                  </a>
                )}
              </div>
              <div className="text-sm text-muted-foreground mt-2">
                {mergedImuData.originalCount.toLocaleString()} samples total
                {mergedImuData.fileCount > 1 && (
                  <span className="ml-2">• Files: {mergedImuData.filenames}</span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <IMUUPlotCharts
                fileId="merged"
                initialSamples={mergedImuData.samples}
                originalCount={mergedImuData.originalCount}
                highlightTime={selectedTime}
                recordings={vtxRecordings.map(vtx => ({
                  id: vtx.id,
                  start_time: vtx.start_time,
                  end_time: vtx.end_time
                }))}
              />
            </CardContent>
          </Card>
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
