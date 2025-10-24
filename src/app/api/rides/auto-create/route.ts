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
    const { fitFileId } = body

    if (!fitFileId) {
      return NextResponse.json({ error: 'Missing fitFileId' }, { status: 400 })
    }

    // Fetch FIT file
    const { data: fitFile, error: fitFileError } = await supabase
      .from('fit_files')
      .select('*')
      .eq('id', fitFileId)
      .eq('user_id', user.id)
      .single()

    if (fitFileError || !fitFile) {
      return NextResponse.json({ error: 'FIT file not found' }, { status: 404 })
    }

    // Check if already associated
    if (fitFile.associated_imu_file_id) {
      return NextResponse.json({ 
        message: 'FIT file already associated',
        associatedWith: fitFile.associated_imu_file_id
      })
    }

    // Find potential IMU files with overlapping time ranges
    const fitTimeRange = TimeOverlapCalculator.extractFitTimeRange({
      start_time: fitFile.start_time,
      timestamp: fitFile.end_time, // Map end_time to timestamp for the function
      total_elapsed_time: fitFile.total_elapsed_time,
      total_distance: fitFile.total_distance,
      total_ascent: fitFile.total_ascent
    })

    // Query IMU files that might overlap (with some buffer)
    const bufferMinutes = 30 // 30 minute buffer for time drift
    const searchStart = new Date(fitTimeRange.start.getTime() - bufferMinutes * 60 * 1000)
    const searchEnd = new Date(fitTimeRange.end.getTime() + bufferMinutes * 60 * 1000)

    const { data: potentialImuFiles, error: imuQueryError } = await supabase
      .from('imu_data_files')
      .select('id, filename, start_time, end_time, associated_fit_file_id')
      .eq('user_id', user.id)
      .is('associated_fit_file_id', null) // Only unassociated files
      .gte('end_time', searchStart.toISOString())
      .lte('start_time', searchEnd.toISOString())
      .order('start_time', { ascending: true })

    if (imuQueryError) {
      return NextResponse.json({ error: 'Failed to query IMU files' }, { status: 500 })
    }

    if (!potentialImuFiles || potentialImuFiles.length === 0) {
      return NextResponse.json({ 
        message: 'No unassociated IMU files found with overlapping time ranges',
        fitTimeRange: {
          start: fitTimeRange.start.toISOString(),
          end: fitTimeRange.end.toISOString(),
          durationMinutes: fitTimeRange.duration / (1000 * 60)
        }
      })
    }

    // Default configuration for automatic association
    const autoConfig: AssociationConfig = {
      minOverlapMinutes: 2,
      maxTimeDriftMinutes: 15, // More lenient for automatic association
      confidenceThreshold: 0.7, // Higher threshold for automatic association
      enableGPSValidation: false,
      enablePatternMatching: false
    }

    const results = []

    // Test each potential IMU file
    for (const imuFile of potentialImuFiles) {
      try {
        // Get IMU data points for time range calculation
        // Get total count first
        const { count: totalCount } = await supabase
          .from('imu_samples')
          .select('*', { count: 'exact', head: true })
          .eq('imu_file_id', imuFile.id)

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
              .eq('imu_file_id', imuFile.id)
              .order('timestamp', { ascending: true })
              .range(from, to)
            
            if (error) {
              console.error('IMU data points query error:', error)
              continue // Skip this IMU file and try the next one
            }
            
            if (data) imuDataPoints.push(...data)
          }
        }

        if (!imuDataPoints || imuDataPoints.length === 0) {
          continue
        }

        // Calculate time range and overlap
        // Convert timestamp to Date objects for the time range calculator
        const imuDataWithTimestamps = imuDataPoints.map(point => ({
          timestamp: new Date(point.timestamp)
        }))
        const imuTimeRange = TimeOverlapCalculator.extractImuTimeRange(imuDataWithTimestamps)
        const overlap = TimeOverlapCalculator.calculateOverlap(imuTimeRange, fitTimeRange)

        if (!overlap) {
          continue
        }

        // Calculate confidence
        const confidence = ConfidenceScorer.calculateConfidence(overlap, autoConfig)
        const validation = ConfidenceScorer.validateAssociation(overlap, autoConfig)

        results.push({
          imuFileId: imuFile.id,
          imuFilename: imuFile.filename,
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
        })
      } catch (error) {
        console.error(`Error processing IMU file ${imuFile.id}:`, error)
        continue
      }
    }

    // Sort by confidence (highest first)
    results.sort((a, b) => b.confidence - a.confidence)

    // If we have a high-confidence match, automatically create the ride
    if (results.length > 0 && results[0].confidence >= autoConfig.confidenceThreshold) {
      const bestMatch = results[0]
      
      // Create the ride using the same logic as the manual endpoint
      const rideData = {
        imuFileId: bestMatch.imuFileId,
        fitFileId: fitFileId,
        config: autoConfig
      }

      // Call the ride creation logic (we'll extract this into a shared function)
      const rideCreationResponse = await createRide(supabase, user.id, rideData)
      
      if (rideCreationResponse.success) {
        return NextResponse.json({
          success: true,
          message: 'Ride created automatically',
          ride: rideCreationResponse.ride,
          autoMatched: true
        })
      }
    }

    // Return potential matches for manual review
    return NextResponse.json({
      success: false,
      message: 'No automatic match found, manual review required',
      potentialMatches: results,
      fitTimeRange: {
        start: fitTimeRange.start.toISOString(),
        end: fitTimeRange.end.toISOString(),
        durationMinutes: fitTimeRange.duration / (1000 * 60)
      }
    })

  } catch (error) {
    console.error('Automatic ride creation failed:', error)
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

// Shared ride creation logic
async function createRide(supabase: any, userId: string, rideData: any) {
  const { imuFileId, fitFileId, config } = rideData

  // Update IMU file with association
  const { error: imuUpdateError } = await supabase
    .from('imu_data_files')
    .update({
      associated_fit_file_id: fitFileId,
      association_method: 'time',
      association_confidence: rideData.confidence,
      association_overlap_start: rideData.overlap.start,
      association_overlap_end: rideData.overlap.end,
      association_overlap_duration_minutes: rideData.overlap.durationMinutes,
      association_created_at: new Date().toISOString(),
      association_updated_at: new Date().toISOString()
    })
    .eq('id', imuFileId)

  if (imuUpdateError) {
    return { success: false, error: 'Failed to update IMU file association' }
  }

  // Update FIT file with association
  const { error: fitUpdateError } = await supabase
    .from('fit_files')
    .update({
      associated_imu_file_id: imuFileId,
      association_method: 'time',
      association_confidence: rideData.confidence,
      association_overlap_start: rideData.overlap.start,
      association_overlap_end: rideData.overlap.end,
      association_overlap_duration_minutes: rideData.overlap.durationMinutes,
      association_created_at: new Date().toISOString(),
      association_updated_at: new Date().toISOString()
    })
    .eq('id', fitFileId)

  if (fitUpdateError) {
    return { success: false, error: 'Failed to update FIT file association' }
  }

  // Log association in history
  const { error: historyError } = await supabase
    .from('association_history')
    .insert({
      imu_file_id: imuFileId,
      fit_file_id: fitFileId,
      association_method: 'time',
      association_confidence: rideData.confidence,
      association_overlap_start: rideData.overlap.start,
      association_overlap_end: rideData.overlap.end,
      association_overlap_duration_minutes: rideData.overlap.durationMinutes,
      created_at: new Date().toISOString()
    })

  if (historyError) {
    console.error('Failed to log association history:', historyError)
  }

  return { success: true, ride: rideData }
}
