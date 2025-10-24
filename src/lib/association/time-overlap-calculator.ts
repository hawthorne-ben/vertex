/**
 * Time overlap calculator for IMU-FIT file associations
 */

import { TimeRange, AssociationOverlap, ImuDataPoint, FitSessionData } from './types'

export class TimeOverlapCalculator {
  /**
   * Calculate overlapping time window between IMU and FIT data
   */
  static calculateOverlap(
    imuTimeRange: TimeRange,
    fitTimeRange: TimeRange
  ): AssociationOverlap | null {
    const overlapStart = new Date(Math.max(
      imuTimeRange.start.getTime(),
      fitTimeRange.start.getTime()
    ))
    
    const overlapEnd = new Date(Math.min(
      imuTimeRange.end.getTime(),
      fitTimeRange.end.getTime()
    ))
    
    // Check if there's any overlap
    if (overlapStart >= overlapEnd) {
      return null
    }
    
    const overlapDuration = overlapEnd.getTime() - overlapStart.getTime()
    const imuCoverage = overlapDuration / imuTimeRange.duration
    const fitCoverage = overlapDuration / fitTimeRange.duration
    
    return {
      start: overlapStart,
      end: overlapEnd,
      duration: overlapDuration,
      imuCoverage: imuCoverage,
      fitCoverage: fitCoverage
    }
  }
  
  /**
   * Extract time range from IMU data
   */
  static extractImuTimeRange(imuData: ImuDataPoint[]): TimeRange {
    if (imuData.length === 0) {
      throw new Error('IMU data is empty')
    }
    
    const timestamps = imuData.map(point => new Date(point.timestamp))
    const start = new Date(Math.min(...timestamps.map(t => t.getTime())))
    const end = new Date(Math.max(...timestamps.map(t => t.getTime())))
    
    return {
      start,
      end,
      duration: end.getTime() - start.getTime()
    }
  }
  
  /**
   * Extract time range from FIT session data
   */
  static extractFitTimeRange(fitSession: FitSessionData): TimeRange {
    if (!fitSession.start_time || !fitSession.timestamp) {
      throw new Error('FIT session missing start_time or timestamp')
    }
    
    const start = new Date(fitSession.start_time)
    const end = new Date(fitSession.timestamp)
    
    if (start >= end) {
      throw new Error('FIT session has invalid time range: start >= end')
    }
    
    return {
      start,
      end,
      duration: end.getTime() - start.getTime()
    }
  }
  
  /**
   * Extract time range from FIT data points array
   */
  static extractFitDataPointsTimeRange(fitDataPoints: any[]): TimeRange {
    if (fitDataPoints.length === 0) {
      throw new Error('FIT data points array is empty')
    }
    
    const timestamps = fitDataPoints.map(point => new Date(point.timestamp))
    const start = new Date(Math.min(...timestamps.map(t => t.getTime())))
    const end = new Date(Math.max(...timestamps.map(t => t.getTime())))
    
    return {
      start,
      end,
      duration: end.getTime() - start.getTime()
    }
  }
  
  /**
   * Calculate time drift between datasets
   */
  static calculateTimeDrift(
    imuTimeRange: TimeRange,
    fitTimeRange: TimeRange
  ): number {
    const imuCenter = imuTimeRange.start.getTime() + (imuTimeRange.duration / 2)
    const fitCenter = fitTimeRange.start.getTime() + (fitTimeRange.duration / 2)
    
    return Math.abs(imuCenter - fitCenter) / (1000 * 60) // Return drift in minutes
  }
  
  /**
   * Check if time ranges are within acceptable drift
   */
  static isWithinDriftTolerance(
    imuTimeRange: TimeRange,
    fitTimeRange: TimeRange,
    maxDriftMinutes: number
  ): boolean {
    const drift = this.calculateTimeDrift(imuTimeRange, fitTimeRange)
    return drift <= maxDriftMinutes
  }
  
  /**
   * Get overlap statistics for debugging
   */
  static getOverlapStatistics(
    imuTimeRange: TimeRange,
    fitTimeRange: TimeRange,
    overlap: AssociationOverlap
  ) {
    const driftMinutes = this.calculateTimeDrift(imuTimeRange, fitTimeRange)
    const overlapMinutes = overlap.duration / (1000 * 60)
    const imuDurationMinutes = imuTimeRange.duration / (1000 * 60)
    const fitDurationMinutes = fitTimeRange.duration / (1000 * 60)
    
    return {
      driftMinutes: Math.round(driftMinutes * 100) / 100,
      overlapMinutes: Math.round(overlapMinutes * 100) / 100,
      imuDurationMinutes: Math.round(imuDurationMinutes * 100) / 100,
      fitDurationMinutes: Math.round(fitDurationMinutes * 100) / 100,
      imuCoveragePercent: Math.round(overlap.imuCoverage * 10000) / 100,
      fitCoveragePercent: Math.round(overlap.fitCoverage * 10000) / 100
    }
  }
}
