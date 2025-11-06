/**
 * Riding time filter for FIT file data analysis
 * Separates riding periods from stationary periods based on speed thresholds
 */

import { formatDurationFromSeconds } from '@/lib/utils/format-duration'

export interface FitDataPoint {
  timestamp: string
  speed_ms?: number | null
  latitude?: number | null
  longitude?: number | null
  altitude?: number | null
}

export interface StationaryPeriod {
  start: Date
  end: Date
  duration: number // in milliseconds
}

export interface RidingTimeAnalysis {
  ridingDataPoints: FitDataPoint[]
  stationaryPeriods: StationaryPeriod[]
  ridingTimeSeconds: number
  stationaryTimeSeconds: number
  totalTimeSeconds: number
  ridingPercentage: number
  stationaryPercentage: number
}

export interface RidingTimeRange {
  start: Date | null
  end: Date | null
  duration: number // in milliseconds
  ridingTimeSeconds: number
  stationaryTimeSeconds: number
}

export class FitRidingTimeFilter {
  private static readonly DEFAULT_STATIONARY_THRESHOLD_MS = 0.5 // 0.5 m/s = ~1.8 km/h
  private static readonly DEFAULT_MIN_RIDING_SEGMENT_SECONDS = 10 // Minimum 10 seconds of movement

  /**
   * Filter out stationary periods from FIT data points
   */
  static filterRidingTime(
    fitDataPoints: FitDataPoint[],
    stationaryThresholdMs: number = this.DEFAULT_STATIONARY_THRESHOLD_MS,
    minRidingSegmentSeconds: number = this.DEFAULT_MIN_RIDING_SEGMENT_SECONDS
  ): RidingTimeAnalysis {
    if (!fitDataPoints || fitDataPoints.length === 0) {
      return {
        ridingDataPoints: [],
        stationaryPeriods: [],
        ridingTimeSeconds: 0,
        stationaryTimeSeconds: 0,
        totalTimeSeconds: 0,
        ridingPercentage: 0,
        stationaryPercentage: 0
      }
    }

    const ridingDataPoints: FitDataPoint[] = []
    const stationaryPeriods: StationaryPeriod[] = []
    let currentStationaryStart: Date | null = null
    let totalRidingTime = 0
    let totalStationaryTime = 0

    // Sort data points by timestamp to ensure chronological order
    const sortedDataPoints = [...fitDataPoints].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )

    for (let i = 0; i < sortedDataPoints.length; i++) {
      const point = sortedDataPoints[i]
      const speed = point.speed_ms || 0
      const timestamp = new Date(point.timestamp)
      const isStationary = speed < stationaryThresholdMs

      if (isStationary) {
        // Start or continue stationary period
        if (currentStationaryStart === null) {
          currentStationaryStart = timestamp
        }
      } else {
        // End stationary period if we were in one
        if (currentStationaryStart !== null) {
          const stationaryDuration = timestamp.getTime() - currentStationaryStart.getTime()
          if (stationaryDuration >= minRidingSegmentSeconds * 1000) {
            stationaryPeriods.push({
              start: currentStationaryStart,
              end: timestamp,
              duration: stationaryDuration
            })
            totalStationaryTime += stationaryDuration
          }
          currentStationaryStart = null
        }
        
        // Add to riding data points
        ridingDataPoints.push(point)
      }
    }

    // Handle case where file ends while stationary
    if (currentStationaryStart !== null && sortedDataPoints.length > 0) {
      const lastPoint = sortedDataPoints[sortedDataPoints.length - 1]
      const lastTimestamp = new Date(lastPoint.timestamp)
      const stationaryDuration = lastTimestamp.getTime() - currentStationaryStart.getTime()
      if (stationaryDuration >= minRidingSegmentSeconds * 1000) {
        stationaryPeriods.push({
          start: currentStationaryStart,
          end: lastTimestamp,
          duration: stationaryDuration
        })
        totalStationaryTime += stationaryDuration
      }
    }

    // Calculate total riding time from riding data points
    if (ridingDataPoints.length > 1) {
      const firstRidingPoint = new Date(ridingDataPoints[0].timestamp)
      const lastRidingPoint = new Date(ridingDataPoints[ridingDataPoints.length - 1].timestamp)
      totalRidingTime = lastRidingPoint.getTime() - firstRidingPoint.getTime()
    }

    // Calculate total time from first to last data point
    const firstPoint = new Date(sortedDataPoints[0].timestamp)
    const lastPoint = new Date(sortedDataPoints[sortedDataPoints.length - 1].timestamp)
    const totalTime = lastPoint.getTime() - firstPoint.getTime()

    const totalTimeSeconds = totalTime / 1000
    const ridingTimeSeconds = totalRidingTime / 1000
    const stationaryTimeSeconds = totalStationaryTime / 1000

    return {
      ridingDataPoints,
      stationaryPeriods,
      ridingTimeSeconds,
      stationaryTimeSeconds,
      totalTimeSeconds,
      ridingPercentage: totalTimeSeconds > 0 ? (ridingTimeSeconds / totalTimeSeconds) * 100 : 0,
      stationaryPercentage: totalTimeSeconds > 0 ? (stationaryTimeSeconds / totalTimeSeconds) * 100 : 0
    }
  }

  /**
   * Calculate riding time range from filtered data
   */
  static getRidingTimeRange(fitDataPoints: FitDataPoint[]): RidingTimeRange {
    const filtered = this.filterRidingTime(fitDataPoints)
    
    if (filtered.ridingDataPoints.length === 0) {
      return { 
        start: null, 
        end: null, 
        duration: 0,
        ridingTimeSeconds: 0,
        stationaryTimeSeconds: 0
      }
    }

    const start = new Date(filtered.ridingDataPoints[0].timestamp)
    const end = new Date(filtered.ridingDataPoints[filtered.ridingDataPoints.length - 1].timestamp)
    
    return {
      start,
      end,
      duration: end.getTime() - start.getTime(),
      ridingTimeSeconds: filtered.ridingTimeSeconds,
      stationaryTimeSeconds: filtered.stationaryTimeSeconds
    }
  }

  /**
   * Analyze stationary periods and categorize them
   */
  static analyzeStationaryPeriods(
    stationaryPeriods: StationaryPeriod[]
  ): {
    shortStops: StationaryPeriod[] // < 30 seconds
    mediumStops: StationaryPeriod[] // 30 seconds - 5 minutes
    longStops: StationaryPeriod[] // > 5 minutes
  } {
    const shortStops: StationaryPeriod[] = []
    const mediumStops: StationaryPeriod[] = []
    const longStops: StationaryPeriod[] = []

    stationaryPeriods.forEach(period => {
      const durationSeconds = period.duration / 1000
      if (durationSeconds < 30) {
        shortStops.push(period)
      } else if (durationSeconds <= 300) { // 5 minutes
        mediumStops.push(period)
      } else {
        longStops.push(period)
      }
    })

    return { shortStops, mediumStops, longStops }
  }

  /**
   * Get riding time statistics
   */
  static getRidingTimeStatistics(analysis: RidingTimeAnalysis): {
    totalRidingTimeFormatted: string
    totalStationaryTimeFormatted: string
    ridingPercentageFormatted: string
    stationaryPercentageFormatted: string
    averageRidingSpeed?: number
    maxRidingSpeed?: number
  } {
    const formatDuration = formatDurationFromSeconds

    // Calculate average and max riding speeds
    let averageRidingSpeed: number | undefined
    let maxRidingSpeed: number | undefined

    if (analysis.ridingDataPoints.length > 0) {
      const speeds = analysis.ridingDataPoints
        .map(point => point.speed_ms || 0)
        .filter(speed => speed > 0)
      
      if (speeds.length > 0) {
        averageRidingSpeed = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length
        maxRidingSpeed = Math.max(...speeds)
      }
    }

    return {
      totalRidingTimeFormatted: formatDuration(analysis.ridingTimeSeconds),
      totalStationaryTimeFormatted: formatDuration(analysis.stationaryTimeSeconds),
      ridingPercentageFormatted: `${analysis.ridingPercentage.toFixed(1)}%`,
      stationaryPercentageFormatted: `${analysis.stationaryPercentage.toFixed(1)}%`,
      averageRidingSpeed,
      maxRidingSpeed
    }
  }
}
