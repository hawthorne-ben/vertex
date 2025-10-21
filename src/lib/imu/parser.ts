/**
 * CSV parser for IMU sensor data
 * Validates format and converts to typed samples
 */

import Papa from 'papaparse'
import { IMUSample, ParsedIMUData } from './types'

interface CSVRow {
  timestamp_ms: string
  accel_x: string
  accel_y: string
  accel_z: string
  gyro_x: string
  gyro_y: string
  gyro_z: string
  mag_x?: string
  mag_y?: string
  mag_z?: string
  quat_w?: string
  quat_x?: string
  quat_y?: string
  quat_z?: string
}

const REQUIRED_COLUMNS = [
  'timestamp_ms',
  'accel_x', 'accel_y', 'accel_z',
  'gyro_x', 'gyro_y', 'gyro_z'
]

const OPTIONAL_COLUMNS = [
  'mag_x', 'mag_y', 'mag_z',
  'quat_w', 'quat_x', 'quat_y', 'quat_z'
]

export class IMUParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IMUParseError'
  }
}

/**
 * Parse IMU CSV data into typed samples
 */
export async function parseIMUCSV(csvText: string): Promise<ParsedIMUData> {
  return new Promise((resolve, reject) => {
    Papa.parse<CSVRow>(csvText, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false, // We'll handle type conversion manually
      complete: (results) => {
        try {
          // Validate we have data
          if (!results.data || results.data.length === 0) {
            throw new IMUParseError('CSV file is empty')
          }

          // Validate columns
          const columns = results.meta.fields || []
          const missingColumns = REQUIRED_COLUMNS.filter(col => !columns.includes(col))
          
          if (missingColumns.length > 0) {
            throw new IMUParseError(
              `Missing required columns: ${missingColumns.join(', ')}`
            )
          }

          // Parse rows into samples
          const samples: IMUSample[] = []
          const errors: string[] = []

          for (let i = 0; i < results.data.length; i++) {
            const row = results.data[i]
            
            try {
              const sample = parseRow(row, i)
              samples.push(sample)
            } catch (err: unknown) {
              errors.push(`Row ${i + 2}: ${err instanceof Error ? err.message : 'Unknown error'}`)
              // Continue parsing, collect all errors
            }
          }

          // If we have no valid samples, fail
          if (samples.length === 0) {
            throw new IMUParseError(
              `No valid samples found. Errors:\n${errors.slice(0, 10).join('\n')}`
            )
          }

          // Warn if we had some errors but continue
          if (errors.length > 0) {
            console.warn(`Parsed ${samples.length} samples with ${errors.length} errors`)
          }

          // Sort by timestamp (should already be sorted, but just in case)
          samples.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

          // Calculate metadata
          const startTime = samples[0].timestamp
          const endTime = samples[samples.length - 1].timestamp
          const duration = (endTime.getTime() - startTime.getTime()) / 1000 // seconds
          const sampleRate = samples.length / duration

          resolve({
            samples,
            startTime,
            endTime,
            sampleCount: samples.length,
            sampleRate,
            duration
          })
        } catch (err) {
          reject(err)
        }
      },
      error: (err: unknown) => {
        reject(new IMUParseError(`CSV parsing failed: ${err instanceof Error ? err.message : 'Unknown error'}`))
      }
    })
  })
}

/**
 * Parse a single CSV row into an IMUSample
 */
function parseRow(row: CSVRow, rowIndex: number): IMUSample {
  // Parse required fields
  const timestamp_ms = parseFloat(row.timestamp_ms)
  if (isNaN(timestamp_ms)) {
    throw new Error(`Invalid timestamp: ${row.timestamp_ms}`)
  }

  const accel_x = parseFloat(row.accel_x)
  const accel_y = parseFloat(row.accel_y)
  const accel_z = parseFloat(row.accel_z)
  const gyro_x = parseFloat(row.gyro_x)
  const gyro_y = parseFloat(row.gyro_y)
  const gyro_z = parseFloat(row.gyro_z)

  // Validate required fields
  if ([accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z].some(isNaN)) {
    throw new Error('Invalid sensor data (accel or gyro)')
  }

  // Parse optional fields
  const mag_x = row.mag_x ? parseFloat(row.mag_x) : undefined
  const mag_y = row.mag_y ? parseFloat(row.mag_y) : undefined
  const mag_z = row.mag_z ? parseFloat(row.mag_z) : undefined
  const quat_w = row.quat_w ? parseFloat(row.quat_w) : undefined
  const quat_x = row.quat_x ? parseFloat(row.quat_x) : undefined
  const quat_y = row.quat_y ? parseFloat(row.quat_y) : undefined
  const quat_z = row.quat_z ? parseFloat(row.quat_z) : undefined

  return {
    timestamp: new Date(timestamp_ms),
    accel_x,
    accel_y,
    accel_z,
    gyro_x,
    gyro_y,
    gyro_z,
    mag_x,
    mag_y,
    mag_z,
    quat_w,
    quat_x,
    quat_y,
    quat_z
  }
}

/**
 * Validate that timestamps are monotonically increasing
 */
export function validateTimestamps(samples: IMUSample[]): boolean {
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].timestamp.getTime() <= samples[i - 1].timestamp.getTime()) {
      console.warn(`Timestamp out of order at sample ${i}`)
      return false
    }
  }
  return true
}

/**
 * Calculate basic statistics for validation
 */
export function calculateStats(samples: IMUSample[]) {
  const accel_x_values = samples.map(s => s.accel_x)
  const accel_y_values = samples.map(s => s.accel_y)
  const accel_z_values = samples.map(s => s.accel_z)

  return {
    accel_x: {
      min: Math.min(...accel_x_values),
      max: Math.max(...accel_x_values),
      mean: accel_x_values.reduce((a, b) => a + b, 0) / accel_x_values.length
    },
    accel_y: {
      min: Math.min(...accel_y_values),
      max: Math.max(...accel_y_values),
      mean: accel_y_values.reduce((a, b) => a + b, 0) / accel_y_values.length
    },
    accel_z: {
      min: Math.min(...accel_z_values),
      max: Math.max(...accel_z_values),
      mean: accel_z_values.reduce((a, b) => a + b, 0) / accel_z_values.length
    }
  }
}

