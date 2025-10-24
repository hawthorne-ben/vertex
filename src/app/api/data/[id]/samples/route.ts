import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { downsampleMultiSeries } from '@/lib/imu/lttb-downsample'

interface RouteParams {
  params: Promise<{
    id: string
  }>
}

/**
 * GET /api/data/[id]/samples
 * 
 * Progressive data loading endpoint for IMU samples.
 * Supports time range filtering and resolution control for zoom interactions.
 * 
 * Query params:
 * - start: Start timestamp (ISO 8601)
 * - end: End timestamp (ISO 8601)
 * - resolution: 'low' | 'medium' | 'high' (default: 'medium')
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    // Auth check
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse query params
    const searchParams = request.nextUrl.searchParams
    const start = searchParams.get('start')
    const end = searchParams.get('end')
    const resolution = searchParams.get('resolution') || 'medium'

    // Determine target points based on resolution
    const targetPoints = {
      low: 1000,
      medium: 2000,
      high: 5000
    }[resolution] || 2000

    // Verify file ownership
    const { data: file, error: fileError } = await supabase
      .from('imu_data_files')
      .select('id, user_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fileError || !file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Build query
    let query = supabase
      .from('imu_samples')
      .select('timestamp, accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z, mag_x, mag_y, mag_z')
      .eq('imu_file_id', id)
      .order('timestamp', { ascending: true })

    // Apply time range filter if provided
    if (start) {
      query = query.gte('timestamp', start)
    }
    if (end) {
      query = query.lte('timestamp', end)
    }

    // Fetch data (limit to reasonable max for safety)
    const maxFetch = resolution === 'high' ? 50000 : 20000
    query = query.limit(maxFetch)

    const { data: samples, error: samplesError } = await query

    if (samplesError) {
      console.error('Error fetching samples:', samplesError)
      return NextResponse.json({ error: 'Failed to fetch samples' }, { status: 500 })
    }

    if (!samples || samples.length === 0) {
      return NextResponse.json({ 
        samples: [], 
        count: 0,
        downsampled: false 
      })
    }

    // Apply LTTB downsampling if we have more points than target
    let resultSamples = samples
    let downsampled = false

    if (samples.length > targetPoints) {
      resultSamples = downsampleMultiSeries(samples, targetPoints)
      downsampled = true
    }

    return NextResponse.json({
      samples: resultSamples,
      count: resultSamples.length,
      originalCount: samples.length,
      downsampled,
      timeRange: {
        start: resultSamples[0].timestamp,
        end: resultSamples[resultSamples.length - 1].timestamp
      }
    })

  } catch (error) {
    console.error('Samples API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

