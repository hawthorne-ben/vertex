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

    if (imuFileError) {
      console.error('IMU file query error:', imuFileError)
      return NextResponse.json({ 
        error: 'Failed to query IMU file',
        details: imuFileError.message 
      }, { status: 500 })
    }

    if (!imuFile) {
      return NextResponse.json({ 
        error: 'IMU file not found',
        details: {
          imuFileId,
          suggestion: 'The IMU file may not exist or you may not have permission to access it'
        }
      }, { status: 404 })
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
      return NextResponse.json({ 
        error: 'No IMU data points found for this file',
        details: {
          imuFileId,
          imuFilename: imuFile.filename,
          suggestion: 'The IMU file may not have been processed yet or may contain no data points'
        }
      }, { status: 404 })
    }

    // Fetch FIT file
    const { data: fitFile, error: fitFileError } = await supabase
      .from('fit_files')
      .select('*')
      .eq('id', fitFileId)
      .eq('user_id', user.id)
      .single()

    if (fitFileError) {
      console.error('FIT file query error:', fitFileError)
      return NextResponse.json({ 
        error: 'Failed to query FIT file',
        details: fitFileError.message 
      }, { status: 500 })
    }

    if (!fitFile) {
      return NextResponse.json({ 
        error: 'FIT file not found',
        details: {
          fitFileId,
          suggestion: 'The FIT file may not exist or you may not have permission to access it'
        }
      }, { status: 404 })
    }

    // Extract time ranges
    // Convert timestamp to Date objects for the time range calculator
    const imuDataWithTimestamps = imuDataPoints.map(point => ({
      timestamp: new Date(point.timestamp)
    }))
    
    console.log('🔍 Debug: IMU data points count:', imuDataPoints.length)
    console.log('🔍 Debug: First IMU timestamp:', imuDataPoints[0]?.timestamp)
    console.log('🔍 Debug: Last IMU timestamp:', imuDataPoints[imuDataPoints.length - 1]?.timestamp)
    
    const imuTimeRange = TimeOverlapCalculator.extractImuTimeRange(imuDataWithTimestamps)
    
    console.log('🔍 Debug: IMU time range:', {
      start: imuTimeRange.start.toISOString(),
      end: imuTimeRange.end.toISOString(),
      duration: imuTimeRange.duration / (1000 * 60) // minutes
    })
    const fitTimeRange = TimeOverlapCalculator.extractFitTimeRange({
      start_time: fitFile.start_time,
      timestamp: fitFile.end_time, // Map end_time to timestamp for the function
      total_elapsed_time: fitFile.total_elapsed_time,
      total_distance: fitFile.total_distance,
      total_ascent: fitFile.total_ascent
    })
    
    console.log('🔍 Debug: FIT time range:', {
      start: fitTimeRange.start.toISOString(),
      end: fitTimeRange.end.toISOString(),
      duration: fitTimeRange.duration / (1000 * 60) // minutes
    })

    // Calculate overlap
    const overlap = TimeOverlapCalculator.calculateOverlap(imuTimeRange, fitTimeRange)
    
    console.log('🔍 Debug: Overlap result:', overlap ? {
      start: overlap.start.toISOString(),
      end: overlap.end.toISOString(),
      duration: overlap.duration / (1000 * 60), // minutes
      imuCoverage: overlap.imuCoverage,
      fitCoverage: overlap.fitCoverage
    } : 'No overlap')
    
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
    const breakdown = ConfidenceScorer.getConfidenceBreakdown(overlap)
    const statistics = TimeOverlapCalculator.getOverlapStatistics(imuTimeRange, fitTimeRange, overlap)
    
    // Debug confidence calculation
    console.log('🔍 Debug: Confidence calculation:', {
      totalConfidence: confidence,
      coverageScore: breakdown.coverage.score,
      durationScore: breakdown.duration.score,
      balanceScore: breakdown.balance.score,
      overlapDurationMs: overlap.duration,
      overlapDurationMinutes: overlap.duration / (1000 * 60)
    })

    // Return preview data
    return NextResponse.json({
      success: true,
      preview: {
        imuFileId,
        fitFileId,
        imuFilename: imuFile.filename,
        fitFilename: fitFile.filename,
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
        breakdown,
        statistics,
        config: associationConfig
      }
    })

  } catch (error) {
    console.error('Ride preview failed:', error)
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
