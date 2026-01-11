import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import FitParser from 'fit-file-parser'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface FitSample {
  timestamp: string
  latitude: number | null
  longitude: number | null
  altitude: number | null
  speed_ms: number | null
  power_watts: number | null
  heart_rate: number | null
  cadence: number | null
  temperature: number | null
  grade: number | null
}

/**
 * Get samples from a FIT file (GPS + power + HR + cadence time series)
 * Parses FIT file on-demand from storage (no DB storage of samples)
 *
 * Query parameters:
 * - start: ISO timestamp to filter from (optional)
 * - end: ISO timestamp to filter to (optional)
 * - fields: Comma-separated list of fields to include (optional, default: all)
 *
 * Response:
 * - samples: Array of FIT data points
 * - metadata: Ride summary info
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rideId } = await params
    const searchParams = request.nextUrl.searchParams

    // Parse query parameters
    const startTime = searchParams.get('start') || undefined
    const endTime = searchParams.get('end') || undefined
    const fieldsParam = searchParams.get('fields')
    const requestedFields = fieldsParam ? fieldsParam.split(',') : null

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

    // Get ride and its FIT recording
    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select(`
        *,
        ride_recordings (
          recording_id,
          recordings (
            id,
            filename,
            file_type,
            storage_path,
            file_size_bytes
          )
        )
      `)
      .eq('id', rideId)
      .eq('user_id', user.id)
      .single()

    if (rideError || !ride) {
      return NextResponse.json(
        { error: 'Ride not found' },
        { status: 404 }
      )
    }

    // Find FIT recording
    const fitRecording = ride.ride_recordings?.find(
      (rr: any) => rr.recordings?.file_type === 'fit'
    )?.recordings

    if (!fitRecording) {
      return NextResponse.json(
        { error: 'No FIT file associated with this ride' },
        { status: 404 }
      )
    }

    // Download FIT file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('recordings')
      .download(fitRecording.storage_path)

    if (downloadError || !fileData) {
      console.error('Error downloading FIT file:', downloadError)
      return NextResponse.json(
        { error: 'Failed to download FIT file' },
        { status: 500 }
      )
    }

    // Parse FIT file
    const arrayBuffer = await fileData.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)

    const fitData = await new Promise<any>((resolve, reject) => {
      const parser = new FitParser({
        force: true,
        speedUnit: 'm/s',
        lengthUnit: 'm',
        temperatureUnit: 'celsius',
        pressureUnit: 'bar',
        elapsedRecordField: true, // Include all record fields (power, cadence, etc.)
        mode: 'cascade',
      })

      parser.parse(buffer, (error: any, data: any) => {
        if (error) {
          reject(error)
        } else {
          resolve(data)
        }
      })
    })

    // Extract records from parsed data (matching Inngest logic exactly)
    let records = fitData.records || []

    // Get session for lap-based records
    let session = fitData.sessions?.[0] || fitData.activity?.sessions?.[0] || fitData.activity?.session

    // Check if records are in session laps (Coros structure)
    if (session?.laps && session.laps.length > 0) {
      const lapRecords: any[] = []
      session.laps.forEach((lap: any) => {
        if (lap.records && lap.records.length > 0) {
          lapRecords.push(...lap.records)
        }
      })

      if (lapRecords.length > 0) {
        records = lapRecords
      }
    }

    // Fallback: check activity.sessions[0].laps
    if (records.length === 0 && fitData.activity?.sessions?.[0]?.laps) {
      const laps = fitData.activity.sessions[0].laps
      records = laps.flatMap((lap: any) => lap.records || [])
    }

    if (records.length === 0) {
      return NextResponse.json(
        { error: 'No data records found in FIT file' },
        { status: 404 }
      )
    }

    // Convert records to standardized format
    const samples: FitSample[] = records.map((record: any, index: number, allRecords: any[]) => {
      // Speed from FIT file (if available) - already in m/s from fit-file-parser
      let speedMs = record.speed || record.enhanced_speed || null

      // If no speed in FIT, calculate from GPS position changes
      if (speedMs === null && record.position_lat && record.position_long && index > 0) {
        const prevRecord = allRecords[index - 1]
        if (prevRecord.position_lat && prevRecord.position_long && prevRecord.timestamp && record.timestamp) {
          const lat1 = prevRecord.position_lat * Math.PI / 180
          const lat2 = record.position_lat * Math.PI / 180
          const lon1 = prevRecord.position_long * Math.PI / 180
          const lon2 = record.position_long * Math.PI / 180

          // Haversine formula for distance between GPS points
          const dLat = lat2 - lat1
          const dLon = lon2 - lon1
          const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                   Math.cos(lat1) * Math.cos(lat2) *
                   Math.sin(dLon/2) * Math.sin(dLon/2)
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
          const distanceMeters = 6371000 * c // Earth radius in meters

          // Time difference in seconds
          const timeDiff = (new Date(record.timestamp).getTime() - new Date(prevRecord.timestamp).getTime()) / 1000

          if (timeDiff > 0 && distanceMeters < 1000) { // Sanity check: ignore if >1km/sample
            speedMs = distanceMeters / timeDiff
          }
        }
      }

      return {
        timestamp: record.timestamp ? new Date(record.timestamp).toISOString() : null,
        latitude: record.position_lat || null,
        longitude: record.position_long || null,
        // Prefer enhanced_altitude (barometric) over altitude (GPS)
        altitude: record.enhanced_altitude ?? record.altitude ?? null,
        speed_ms: speedMs,
        power_watts: record.power || null,
        heart_rate: record.heart_rate || null,
        cadence: record.cadence || null,
        temperature: record.temperature || null,
        grade: record.grade || null,
      }
    }).filter((s: FitSample) => s.timestamp !== null)

    // Apply time filters if provided
    let filteredSamples = samples
    if (startTime) {
      const startDate = new Date(startTime)
      filteredSamples = filteredSamples.filter(s => new Date(s.timestamp!) >= startDate)
    }
    if (endTime) {
      const endDate = new Date(endTime)
      filteredSamples = filteredSamples.filter(s => new Date(s.timestamp!) <= endDate)
    }

    // Filter fields if requested
    if (requestedFields) {
      filteredSamples = filteredSamples.map(sample => {
        const filtered: any = { timestamp: sample.timestamp }
        requestedFields.forEach(field => {
          if (field in sample) {
            filtered[field] = sample[field as keyof FitSample]
          }
        })
        return filtered
      })
    }

    // Calculate metadata
    const gpsCount = samples.filter(s => s.latitude !== null && s.longitude !== null).length
    const metadata = {
      totalSamples: filteredSamples.length,
      originalSamples: samples.length,
      gpsPointsCount: gpsCount,
      hasGps: gpsCount > 0,
      hasPower: samples.some(s => s.power_watts !== null),
      hasHeartRate: samples.some(s => s.heart_rate !== null),
      hasCadence: samples.some(s => s.cadence !== null),
      startTime: filteredSamples[0]?.timestamp,
      endTime: filteredSamples[filteredSamples.length - 1]?.timestamp,
    }

    return NextResponse.json({
      samples: filteredSamples,
      metadata,
    })

  } catch (error: any) {
    console.error('Error fetching FIT samples:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
