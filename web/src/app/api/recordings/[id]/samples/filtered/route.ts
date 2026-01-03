import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { VTXDecoder } from '@vertex-pkg/vtx-parser'
import { BicycleIMUFilter, type IMUReading, type GPSReading } from '@/lib/imu/bicycle-filter'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface QueryParams {
  start?: string // ISO timestamp
  end?: string // ISO timestamp
}

/**
 * Get filtered orientation samples from a VTX recording
 *
 * Applies bicycle-aware complementary filter to improve upon BNO055's built-in fusion
 *
 * Query parameters:
 * - start: ISO timestamp to filter from (optional)
 * - end: ISO timestamp to filter to (optional)
 *
 * Response includes:
 * - samples: Array of filtered orientation samples
 * - metadata: Information about the filter and data
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: recordingId } = await params
    const searchParams = request.nextUrl.searchParams

    // Parse query parameters
    const startTime = searchParams.get('start') || undefined
    const endTime = searchParams.get('end') || undefined

    // Get user from auth header
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized - No auth token' },
        { status: 401 }
      )
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized - Invalid token' },
        { status: 401 }
      )
    }

    // Get recording metadata
    const { data: recording, error: recordingError } = await supabase
      .from('recordings')
      .select('*')
      .eq('id', recordingId)
      .eq('user_id', user.id)
      .single()

    if (recordingError || !recording) {
      return NextResponse.json(
        { error: 'Recording not found' },
        { status: 404 }
      )
    }

    // Check recording status
    if (recording.status !== 'ready') {
      return NextResponse.json(
        {
          error: 'Recording not ready',
          status: recording.status,
          message: recording.error_message
        },
        { status: 400 }
      )
    }

    // Only VTX files are supported
    if (recording.file_type !== 'vtx') {
      return NextResponse.json(
        { error: 'Only VTX recordings are currently supported' },
        { status: 400 }
      )
    }

    // Download VTX file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('recordings')
      .download(recording.storage_path)

    if (downloadError || !fileData) {
      console.error('Error downloading recording:', downloadError)
      return NextResponse.json(
        { error: 'Failed to download recording file' },
        { status: 500 }
      )
    }

    // Parse VTX file
    const fileBuffer = Buffer.from(await fileData.arrayBuffer())
    const arrayBuffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength
    ) as ArrayBuffer

    const decoder = new VTXDecoder(arrayBuffer)
    const header = decoder.getHeader()
    const recordCount = Number(header.recordCount)

    // Convert time filter to timestamp offsets if provided
    let startOffset = 0
    let endOffset = Number(header.endTimestamp - header.startTimestamp)

    if (startTime) {
      const startMs = new Date(startTime).getTime()
      const recordingStartMs = Number(header.startTimestamp)
      startOffset = Math.max(0, startMs - recordingStartMs)
    }

    if (endTime) {
      const endMs = new Date(endTime).getTime()
      const recordingStartMs = Number(header.startTimestamp)
      endOffset = Math.min(endOffset, endMs - recordingStartMs)
    }

    // Read IMU records and GPS records within time range
    const imuReadings: IMUReading[] = []
    const gpsReadings: GPSReading[] = []
    const recordingStartMs = Number(header.startTimestamp)

    // Read IMU records
    for (let i = 0; i < recordCount; i++) {
      const record = decoder.readRecord(i)

      // Calculate offset from absolute timestamp
      const recordOffset = record.timestamp - recordingStartMs

      // Check if record is within time range
      if (recordOffset < startOffset || recordOffset > endOffset) {
        continue
      }

      imuReadings.push({
        accelX: record.accelX,
        accelY: record.accelY,
        accelZ: record.accelZ,
        gyroX: record.gyroX,
        gyroY: record.gyroY,
        gyroZ: record.gyroZ,
        timestamp: record.timestamp
      })
    }

    // Read GPS records if available (v1.1+)
    if (header.gpsRecordCount && Number(header.gpsRecordCount) > 0) {
      const gpsCount = Number(header.gpsRecordCount)
      for (let i = 0; i < gpsCount; i++) {
        const gps = decoder.readGPSRecord(i)

        // Calculate offset from absolute timestamp
        const gpsOffset = gps.timestamp - recordingStartMs

        // Check if GPS record is within time range
        if (gpsOffset < startOffset || gpsOffset > endOffset) {
          continue
        }

        // Only include if we have valid speed and bearing
        if (!isNaN(gps.speed) && !isNaN(gps.bearing)) {
          gpsReadings.push({
            speed: gps.speed,
            heading: (gps.bearing * Math.PI) / 180, // Convert to radians
            timestamp: gps.timestamp
          })
        }
      }
    }

    // Calculate sample rate from data (more accurate than metadata)
    let sampleRate = 50.0 // Default fallback
    if (imuReadings.length > 1) {
      const timeDiffs: number[] = []
      for (let i = 1; i < Math.min(100, imuReadings.length); i++) {
        timeDiffs.push(imuReadings[i].timestamp - imuReadings[i - 1].timestamp)
      }
      const avgDt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length
      sampleRate = 1000.0 / avgDt // Convert ms to Hz
      console.log(`[Filtered] Calculated sample rate: ${sampleRate.toFixed(1)} Hz`)
    }

    // Apply bicycle filter with preprocessing and debug enabled
    const filter = new BicycleIMUFilter({ sampleRate, debug: true })
    const filteredSamples: any[] = []
    const debugSamples: any[] = [] // Track samples with debug info for logging

    // Create GPS lookup map by timestamp
    const gpsMap = new Map<number, GPSReading>()
    gpsReadings.forEach((gps) => gpsMap.set(gps.timestamp, gps))

    // Track extreme values for diagnostic logging
    let maxRoll = -Infinity
    let minRoll = Infinity
    let maxPitch = -Infinity
    let minPitch = Infinity
    let maxRollIdx = -1
    let minRollIdx = -1
    let maxPitchIdx = -1
    let minPitchIdx = -1

    for (let i = 0; i < imuReadings.length; i++) {
      const imu = imuReadings[i]

      // Find closest GPS reading (within 1 second)
      let closestGPS: GPSReading | undefined
      let minDiff = 1000 // 1 second threshold

      for (const [timestamp, gps] of gpsMap) {
        const diff = Math.abs(timestamp - imu.timestamp)
        if (diff < minDiff) {
          minDiff = diff
          closestGPS = gps
        }
      }

      const result = filter.update(imu, closestGPS)

      // Track extremes
      const rollDeg = (result.roll * 180) / Math.PI
      const pitchDeg = (result.pitch * 180) / Math.PI

      if (rollDeg > maxRoll) {
        maxRoll = rollDeg
        maxRollIdx = i
      }
      if (rollDeg < minRoll) {
        minRoll = rollDeg
        minRollIdx = i
      }
      if (pitchDeg > maxPitch) {
        maxPitch = pitchDeg
        maxPitchIdx = i
      }
      if (pitchDeg < minPitch) {
        minPitch = pitchDeg
        minPitchIdx = i
      }

      // Store debug info for selected samples
      if (i === 0 || i === Math.floor(imuReadings.length / 2) || i === imuReadings.length - 1) {
        debugSamples.push({
          index: i,
          timestamp: imu.timestamp,
          result,
          rollDeg,
          pitchDeg
        })
      }

      // Normalize yaw to [-π, π] for display (don't normalize during filtering to avoid discontinuities)
      let yawNormalized = result.yaw
      while (yawNormalized > Math.PI) yawNormalized -= 2 * Math.PI
      while (yawNormalized < -Math.PI) yawNormalized += 2 * Math.PI

      // Convert radians to degrees for output
      filteredSamples.push({
        timestamp: imu.timestamp,
        roll: rollDeg,
        pitch: pitchDeg,
        yaw: (yawNormalized * 180) / Math.PI,
        accel_trust: result.accelTrust
      })
    }

    // Log diagnostics
    console.log('\n[Filtered Orientation Diagnostics]')
    console.log(`Sample rate: ${sampleRate.toFixed(1)} Hz`)
    console.log(`Total samples: ${imuReadings.length}`)
    console.log(`Roll range: [${minRoll.toFixed(1)}°, ${maxRoll.toFixed(1)}°]`)
    console.log(`Pitch range: [${minPitch.toFixed(1)}°, ${maxPitch.toFixed(1)}°]`)

    console.log('\n--- Selected Samples ---')
    debugSamples.forEach(({ index, timestamp, result, rollDeg, pitchDeg }) => {
      if (result.debug) {
        const d = result.debug
        console.log(`\nSample ${index} (t=${timestamp}):`)
        console.log(`  Output: roll=${rollDeg.toFixed(1)}° pitch=${pitchDeg.toFixed(1)}°`)
        console.log(`  Accel trust: ${result.accelTrust.toFixed(3)} (dynamics factor: ${d.dynamicsFactor.toFixed(3)})`)
        console.log(`  Accel mag: ${d.accelMag.toFixed(2)} m/s² (filtered: [${d.accelFiltered.x.toFixed(2)}, ${d.accelFiltered.y.toFixed(2)}, ${d.accelFiltered.z.toFixed(2)}])`)
        console.log(`  Gyro (rad/s): [${d.gyroFiltered.x.toFixed(3)}, ${d.gyroFiltered.y.toFixed(3)}, ${d.gyroFiltered.z.toFixed(3)}]`)
        console.log(`  Roll: accel=${(d.rollAccel * 180 / Math.PI).toFixed(1)}° gyro=${(d.rollGyro * 180 / Math.PI).toFixed(1)}° → fused=${rollDeg.toFixed(1)}°`)
        console.log(`  Pitch: accel=${(d.pitchAccel * 180 / Math.PI).toFixed(1)}° gyro=${(d.pitchGyro * 180 / Math.PI).toFixed(1)}° → fused=${pitchDeg.toFixed(1)}°`)
        console.log(`  Gains: kAccel=${d.kAccelAdaptive.toFixed(4)} kGyro=${d.kGyroAdaptive.toFixed(4)}`)
      }
    })

    // Also log extreme samples
    console.log('\n--- Extreme Values ---')
    if (maxRollIdx >= 0) {
      console.log(`Max roll: ${maxRoll.toFixed(1)}° at sample ${maxRollIdx} (timestamp ${imuReadings[maxRollIdx].timestamp})`)
    }
    if (minRollIdx >= 0) {
      console.log(`Min roll: ${minRoll.toFixed(1)}° at sample ${minRollIdx} (timestamp ${imuReadings[minRollIdx].timestamp})`)
    }
    if (maxPitchIdx >= 0) {
      console.log(`Max pitch: ${maxPitch.toFixed(1)}° at sample ${maxPitchIdx} (timestamp ${imuReadings[maxPitchIdx].timestamp})`)
    }
    if (minPitchIdx >= 0) {
      console.log(`Min pitch: ${minPitch.toFixed(1)}° at sample ${minPitchIdx} (timestamp ${imuReadings[minPitchIdx].timestamp})`)
    }

    return NextResponse.json({
      samples: filteredSamples,
      metadata: {
        total_samples: filteredSamples.length,
        filter_type: 'bicycle-aware-complementary',
        gps_available: gpsReadings.length > 0,
        gps_samples: gpsReadings.length,
        time_range: {
          start: filteredSamples.length > 0 ? filteredSamples[0].timestamp : recordingStartMs + startOffset,
          end: filteredSamples.length > 0 ? filteredSamples[filteredSamples.length - 1].timestamp : recordingStartMs + endOffset
        },
        sample_rate: recording.sample_rate,
        recording_duration_ms: recording.duration_ms
      }
    })

  } catch (error) {
    console.error('Filtered sample fetch error:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
