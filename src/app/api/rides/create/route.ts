import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { TimeOverlapCalculator } from '@/lib/association/time-overlap-calculator'
import { ConfidenceScorer } from '@/lib/association/confidence-scorer'
import { AssociationConfig } from '@/lib/association/types'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { imuFileId, fitFileId, config } = body

    if (!imuFileId || !fitFileId) {
      return NextResponse.json({ error: 'Missing imuFileId or fitFileId' }, { status: 400 })
    }

    // Default configuration
    const defaultConfig: AssociationConfig = {
      minOverlapMinutes: 2,
      maxTimeDriftMinutes: 10,
      confidenceThreshold: 0.6,
      enableGPSValidation: false,
      enablePatternMatching: false
    }

    const associationConfig = { ...defaultConfig, ...config }

    // Fetch IMU file and data points
    const { data: imuFile, error: imuFileError } = await supabase
      .from('imu_data_files')
      .select('*')
      .eq('id', imuFileId)
      .eq('user_id', user.id)
      .single()

    if (imuFileError || !imuFile) {
      return NextResponse.json({ error: 'IMU file not found' }, { status: 404 })
    }

    // Get total count first
    const { count: totalCount } = await supabase
      .from('imu_samples')
      .select('*', { count: 'exact', head: true })
      .eq('imu_file_id', imuFileId)

    // Fetch all IMU data points using pagination to handle Supabase 1k limit
    let imuDataPoints: any[] = []
    const PAGE_SIZE = 1000
    
    if (totalCount) {
      const numPages = Math.ceil(totalCount / PAGE_SIZE)
      
      for (let page = 0; page < numPages; page++) {
        const from = page * PAGE_SIZE
        const to = from + PAGE_SIZE - 1
        
        const { data, error } = await supabase
          .from('imu_samples')
          .select('timestamp')
          .eq('imu_file_id', imuFileId)
          .order('timestamp', { ascending: true })
          .range(from, to)
        
        if (error) {
          console.error('IMU data points query error:', error)
          return NextResponse.json({ 
            error: 'Failed to query IMU data points',
            details: error.message 
          }, { status: 500 })
        }
        
        if (data) imuDataPoints.push(...data)
      }
    }

    if (!imuDataPoints || imuDataPoints.length === 0) {
      return NextResponse.json({ error: 'No IMU data points found' }, { status: 404 })
    }

    // Fetch FIT file and session data
    const { data: fitFile, error: fitFileError } = await supabase
      .from('fit_files')
      .select('*')
      .eq('id', fitFileId)
      .eq('user_id', user.id)
      .single()

    if (fitFileError || !fitFile) {
      return NextResponse.json({ error: 'FIT file not found' }, { status: 404 })
    }

    // Extract time ranges
    // Convert timestamp to Date objects for the time range calculator
    const imuDataWithTimestamps = imuDataPoints.map(point => ({
      timestamp: new Date(point.timestamp)
    }))
    const imuTimeRange = TimeOverlapCalculator.extractImuTimeRange(imuDataWithTimestamps)
    const fitTimeRange = TimeOverlapCalculator.extractFitTimeRange({
      start_time: fitFile.start_time,
      timestamp: fitFile.end_time, // Map end_time to timestamp for the function
      total_elapsed_time: fitFile.total_elapsed_time,
      total_distance: fitFile.total_distance,
      total_ascent: fitFile.total_ascent
    })

    // Calculate overlap
    const overlap = TimeOverlapCalculator.calculateOverlap(imuTimeRange, fitTimeRange)
    
    if (!overlap) {
      return NextResponse.json({ 
        error: 'No time overlap found between IMU and FIT data',
        details: {
          imuTimeRange: {
            start: imuTimeRange.start.toISOString(),
            end: imuTimeRange.end.toISOString(),
            durationMinutes: imuTimeRange.duration / (1000 * 60)
          },
          fitTimeRange: {
            start: fitTimeRange.start.toISOString(),
            end: fitTimeRange.end.toISOString(),
            durationMinutes: fitTimeRange.duration / (1000 * 60)
          }
        }
      }, { status: 400 })
    }

    // Calculate confidence
    const confidence = ConfidenceScorer.calculateConfidence(overlap, associationConfig)
    const validation = ConfidenceScorer.validateAssociation(overlap, associationConfig)

    // Check if confidence meets threshold
    if (confidence < associationConfig.confidenceThreshold) {
      return NextResponse.json({
        error: 'Low confidence association',
        confidence,
        threshold: associationConfig.confidenceThreshold,
        validation,
        overlap: {
          start: overlap.start.toISOString(),
          end: overlap.end.toISOString(),
          durationMinutes: overlap.duration / (1000 * 60),
          imuCoverage: overlap.imuCoverage,
          fitCoverage: overlap.fitCoverage
        }
      }, { status: 400 })
    }

    // Create the ride (association)
    const rideData = {
      imu_file_id: imuFileId,
      fit_file_id: fitFileId,
      association_method: 'time',
      association_confidence: confidence,
      association_overlap_start: overlap.start.toISOString(),
      association_overlap_end: overlap.end.toISOString(),
      association_overlap_duration_minutes: Math.round(overlap.duration / (1000 * 60)),
      association_created_at: new Date().toISOString(),
      association_updated_at: new Date().toISOString()
    }

    // Update IMU file with association
    const { error: imuUpdateError } = await supabase
      .from('imu_data_files')
      .update({
        associated_fit_file_id: fitFileId,
        association_method: 'time',
        association_confidence: confidence,
        association_overlap_start: overlap.start.toISOString(),
        association_overlap_end: overlap.end.toISOString(),
        association_overlap_duration_minutes: Math.round(overlap.duration / (1000 * 60)),
        association_created_at: new Date().toISOString(),
        association_updated_at: new Date().toISOString()
      })
      .eq('id', imuFileId)

    if (imuUpdateError) {
      return NextResponse.json({ error: 'Failed to update IMU file association' }, { status: 500 })
    }

    // Update FIT file with association
    const { error: fitUpdateError } = await supabase
      .from('fit_files')
      .update({
        associated_imu_file_id: imuFileId,
        association_method: 'time',
        association_confidence: confidence,
        association_overlap_start: overlap.start.toISOString(),
        association_overlap_end: overlap.end.toISOString(),
        association_overlap_duration_minutes: Math.round(overlap.duration / (1000 * 60)),
        association_created_at: new Date().toISOString(),
        association_updated_at: new Date().toISOString()
      })
      .eq('id', fitFileId)

    if (fitUpdateError) {
      return NextResponse.json({ error: 'Failed to update FIT file association' }, { status: 500 })
    }

    // Log association in history
    const { error: historyError } = await supabase
      .from('association_history')
      .insert({
        imu_file_id: imuFileId,
        fit_file_id: fitFileId,
        association_method: 'time',
        association_confidence: confidence,
        overlap_start: overlap.start.toISOString(),
        overlap_end: overlap.end.toISOString(),
        overlap_duration_minutes: Math.round(overlap.duration / (1000 * 60)),
        created_at: new Date().toISOString(),
        created_by: user.id
      })

    if (historyError) {
      console.error('Failed to log association history:', historyError)
      // Don't fail the request for history logging errors
    }

    // Return success response
    return NextResponse.json({
      success: true,
      ride: {
        imuFileId,
        fitFileId,
        confidence,
        level: ConfidenceScorer.getConfidenceLevel(confidence),
        color: ConfidenceScorer.getConfidenceColor(confidence),
        overlap: {
          start: overlap.start.toISOString(),
          end: overlap.end.toISOString(),
          durationMinutes: overlap.duration / (1000 * 60),
          imuCoverage: overlap.imuCoverage,
          fitCoverage: overlap.fitCoverage
        },
        validation,
        statistics: TimeOverlapCalculator.getOverlapStatistics(imuTimeRange, fitTimeRange, overlap)
      }
    })

  } catch (error) {
    console.error('Ride creation failed:', error)
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
