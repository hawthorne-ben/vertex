'use client'

import { useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'

interface FitSample {
  timestamp: string
  speed_ms?: number | null
  power_watts?: number | null
  heart_rate?: number | null
  cadence?: number | null
  altitude?: number | null
  latitude?: number | null
  longitude?: number | null
}

interface IMUSample {
  timestamp: string
  accel_x: number
  accel_y: number
  accel_z: number
  gyro_x: number
  gyro_y: number
  gyro_z: number
  roll?: number | null
  pitch?: number | null
  yaw?: number | null
}

interface CurrentValuesCardProps {
  selectedTime: number | null // Unix timestamp in seconds
  fitSamples: FitSample[]
  imuSamples: IMUSample[]
}

export function CurrentValuesCard({ selectedTime, fitSamples, imuSamples }: CurrentValuesCardProps) {
  // Binary search to find closest FIT sample (O(log n))
  const currentFitSample = useMemo(() => {
    if (selectedTime === null || selectedTime === undefined || fitSamples.length === 0) {
      return null
    }

    let left = 0
    let right = fitSamples.length - 1
    let closestIdx = 0
    let minDiff = Infinity

    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      const sampleTime = new Date(fitSamples[mid].timestamp).getTime() / 1000
      const diff = Math.abs(sampleTime - selectedTime)

      if (diff < minDiff) {
        minDiff = diff
        closestIdx = mid
      }

      if (sampleTime < selectedTime) {
        left = mid + 1
      } else if (sampleTime > selectedTime) {
        right = mid - 1
      } else {
        return fitSamples[mid] // Exact match
      }
    }

    return fitSamples[closestIdx]
  }, [selectedTime, fitSamples])

  // Binary search to find closest IMU sample (O(log n))
  const currentImuSample = useMemo(() => {
    if (selectedTime === null || selectedTime === undefined || imuSamples.length === 0) {
      return null
    }

    // Check if selectedTime is within IMU data range
    const firstTime = new Date(imuSamples[0].timestamp).getTime() / 1000
    const lastTime = new Date(imuSamples[imuSamples.length - 1].timestamp).getTime() / 1000

    // If selectedTime is outside IMU range, don't show IMU data
    if (selectedTime < firstTime || selectedTime > lastTime) {
      return null
    }

    let left = 0
    let right = imuSamples.length - 1
    let closestIdx = 0
    let minDiff = Infinity

    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      const sampleTime = new Date(imuSamples[mid].timestamp).getTime() / 1000
      const diff = Math.abs(sampleTime - selectedTime)

      if (diff < minDiff) {
        minDiff = diff
        closestIdx = mid
      }

      if (sampleTime < selectedTime) {
        left = mid + 1
      } else if (sampleTime > selectedTime) {
        right = mid - 1
      } else {
        return imuSamples[mid] // Exact match
      }
    }

    return imuSamples[closestIdx]
  }, [selectedTime, imuSamples])

  const formatTime = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    })
  }

  if (selectedTime === null || selectedTime === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current Values</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Scrub timeline to see values</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="h-[400px] flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Current Values</CardTitle>
        <p className="text-xs text-muted-foreground">{formatTime(selectedTime)}</p>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto">
        {/* Fixed grid layout - all rows always present to prevent jank */}
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {/* Performance Section */}
          <div className="col-span-2 text-xs font-semibold text-foreground mb-1">Performance</div>

          <span className="text-muted-foreground">Speed:</span>
          <span className="font-medium text-foreground">
            {currentFitSample?.speed_ms !== null && currentFitSample?.speed_ms !== undefined
              ? `${(currentFitSample.speed_ms * 2.23694).toFixed(1)} mph`
              : '—'}
          </span>

          <span className="text-muted-foreground">Heart Rate:</span>
          <span className="font-medium text-foreground">
            {currentFitSample?.heart_rate !== null && currentFitSample?.heart_rate !== undefined
              ? `${currentFitSample.heart_rate} bpm`
              : '—'}
          </span>

          <span className="text-muted-foreground">Power:</span>
          <span className="font-medium text-foreground">
            {currentFitSample?.power_watts !== null && currentFitSample?.power_watts !== undefined
              ? `${currentFitSample.power_watts} W`
              : '—'}
          </span>

          <span className="text-muted-foreground">Cadence:</span>
          <span className="font-medium text-foreground">
            {currentFitSample?.cadence !== null && currentFitSample?.cadence !== undefined
              ? `${currentFitSample.cadence} rpm`
              : '—'}
          </span>

          <span className="text-muted-foreground">Elevation:</span>
          <span className="font-medium text-foreground">
            {currentFitSample?.altitude !== null && currentFitSample?.altitude !== undefined
              ? `${(currentFitSample.altitude * 3.28084).toFixed(0)} ft`
              : '—'}
          </span>

          {/* IMU Section */}
          {currentImuSample && (
            <>
              <div className="col-span-2 text-xs font-semibold text-foreground mt-3 mb-1 pt-3 border-t border-border">IMU Sensors</div>

              <span className="text-muted-foreground">Roll:</span>
              <span className="font-medium text-foreground">
                {currentImuSample.roll !== null && currentImuSample.roll !== undefined
                  ? `${currentImuSample.roll.toFixed(1)}°`
                  : '—'}
              </span>

              <span className="text-muted-foreground">Pitch:</span>
              <span className="font-medium text-foreground">
                {currentImuSample.pitch !== null && currentImuSample.pitch !== undefined
                  ? `${currentImuSample.pitch.toFixed(1)}°`
                  : '—'}
              </span>

              <span className="text-muted-foreground">Yaw:</span>
              <span className="font-medium text-foreground">
                {currentImuSample.yaw !== null && currentImuSample.yaw !== undefined
                  ? `${currentImuSample.yaw.toFixed(1)}°`
                  : '—'}
              </span>

              <span className="text-muted-foreground">Accel X:</span>
              <span className="font-medium text-foreground">{currentImuSample.accel_x.toFixed(2)} m/s²</span>

              <span className="text-muted-foreground">Accel Y:</span>
              <span className="font-medium text-foreground">{currentImuSample.accel_y.toFixed(2)} m/s²</span>

              <span className="text-muted-foreground">Accel Z:</span>
              <span className="font-medium text-foreground">{currentImuSample.accel_z.toFixed(2)} m/s²</span>

              <span className="text-muted-foreground">Gyro X:</span>
              <span className="font-medium text-foreground">{currentImuSample.gyro_x.toFixed(1)} deg/s</span>

              <span className="text-muted-foreground">Gyro Y:</span>
              <span className="font-medium text-foreground">{currentImuSample.gyro_y.toFixed(1)} deg/s</span>

              <span className="text-muted-foreground">Gyro Z:</span>
              <span className="font-medium text-foreground">{currentImuSample.gyro_z.toFixed(1)} deg/s</span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
