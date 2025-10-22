import Papa from 'papaparse'
import { IMUSample } from './types'

export interface StreamingParseOptions {
  batchSize: number
  onBatch: (samples: IMUSample[], batchNumber: number) => Promise<void>
  onProgress?: (processedCount: number, totalEstimate?: number) => void
  onError?: (error: Error, rowNumber: number) => void
  onComplete?: (totalProcessed: number) => void
}

export interface StreamingParseResult {
  totalProcessed: number
  success: boolean
  errors: Array<{ row: number; error: string }>
}

/**
 * Streaming CSV parser that processes data row-by-row without loading entire file into memory
 */
export async function parseIMUCSVStreaming(
  csvText: string,
  options: StreamingParseOptions
): Promise<StreamingParseResult> {
  return new Promise((resolve, reject) => {
    let batchBuffer: IMUSample[] = []
    let batchNumber = 0
    let totalProcessed = 0
    let errors: Array<{ row: number; error: string }> = []
    let isComplete = false

    const processBatch = async (): Promise<void> => {
      if (batchBuffer.length === 0) return

      const currentBatch = batchBuffer
      batchBuffer = []
      batchNumber++

      try {
        await options.onBatch(currentBatch, batchNumber)
        totalProcessed += currentBatch.length
        
        if (options.onProgress) {
          options.onProgress(totalProcessed)
        }
      } catch (error) {
        console.error(`Batch ${batchNumber} processing failed:`, error)
        throw error
      }
    }

    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      
      step: (result, parser) => {
        try {
          // Parse the row into an IMU sample
          const sample = parseRow(result.data, result.meta.cursor)
          
          // Add to batch buffer
          batchBuffer.push(sample)
          
          // Process batch when it reaches the desired size
          if (batchBuffer.length >= options.batchSize) {
            // Pause parsing while we process the batch
            parser.pause()
            
            processBatch()
              .then(() => {
                // Resume parsing after batch is processed
                parser.resume()
              })
              .catch((error) => {
                console.error('Batch processing error:', error)
                parser.abort()
                reject(error)
              })
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          errors.push({ row: result.meta.cursor, error: errorMessage })
          
          if (options.onError) {
            options.onError(error as Error, result.meta.cursor)
          }
          
          // Continue parsing despite errors
          console.warn(`Row ${result.meta.cursor} parsing error:`, errorMessage)
        }
      },
      
      complete: async () => {
        try {
          // Process any remaining samples in the buffer
          if (batchBuffer.length > 0) {
            await processBatch()
          }
          
          isComplete = true
          
          if (options.onComplete) {
            await options.onComplete(totalProcessed)
          }
          
          resolve({
            totalProcessed,
            success: true,
            errors
          })
        } catch (error) {
          reject(error)
        }
      },
      
      error: (error: Error) => {
        reject(new Error(`CSV parsing error: ${error.message}`))
      }
    })
  })
}

/**
 * Parse a single CSV row into an IMUSample
 * This is the same logic as in the original parser but extracted for streaming
 */
function parseRow(row: any, rowNumber: number): IMUSample {
  // Validate required columns
  const requiredColumns = [
    'timestamp_ms', 'accel_x', 'accel_y', 'accel_z',
    'gyro_x', 'gyro_y', 'gyro_z'
  ]
  
  const missingColumns = requiredColumns.filter(col => !(col in row))
  if (missingColumns.length > 0) {
    throw new Error(`Missing required columns: ${missingColumns.join(', ')}`)
  }

  // Parse timestamp
  const timestampMs = parseFloat(row.timestamp_ms)
  if (isNaN(timestampMs)) {
    throw new Error(`Invalid timestamp: ${row.timestamp_ms}`)
  }
  const timestamp = new Date(timestampMs)

  // Parse accelerometer data
  const accel_x = parseFloat(row.accel_x)
  const accel_y = parseFloat(row.accel_y)
  const accel_z = parseFloat(row.accel_z)
  
  if (isNaN(accel_x) || isNaN(accel_y) || isNaN(accel_z)) {
    throw new Error(`Invalid accelerometer data: ${row.accel_x}, ${row.accel_y}, ${row.accel_z}`)
  }

  // Parse gyroscope data
  const gyro_x = parseFloat(row.gyro_x)
  const gyro_y = parseFloat(row.gyro_y)
  const gyro_z = parseFloat(row.gyro_z)
  
  if (isNaN(gyro_x) || isNaN(gyro_y) || isNaN(gyro_z)) {
    throw new Error(`Invalid gyroscope data: ${row.gyro_x}, ${row.gyro_y}, ${row.gyro_z}`)
  }

  // Parse optional magnetometer data
  const mag_x = row.mag_x ? parseFloat(row.mag_x) : null
  const mag_y = row.mag_y ? parseFloat(row.mag_y) : null
  const mag_z = row.mag_z ? parseFloat(row.mag_z) : null

  // Parse optional quaternion data
  const quat_w = row.quat_w ? parseFloat(row.quat_w) : null
  const quat_x = row.quat_x ? parseFloat(row.quat_x) : null
  const quat_y = row.quat_y ? parseFloat(row.quat_y) : null
  const quat_z = row.quat_z ? parseFloat(row.quat_z) : null

  return {
    timestamp,
    accel_x,
    accel_y,
    accel_z,
    gyro_x,
    gyro_y,
    gyro_z,
    mag_x: mag_x ?? undefined,
    mag_y: mag_y ?? undefined,
    mag_z: mag_z ?? undefined,
    quat_w: quat_w ?? undefined,
    quat_x: quat_x ?? undefined,
    quat_y: quat_y ?? undefined,
    quat_z: quat_z ?? undefined
  }
}
