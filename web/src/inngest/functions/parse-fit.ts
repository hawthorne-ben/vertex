import { inngest } from '@/inngest/client'
import { createClient } from '@supabase/supabase-js'
import FitParser from 'fit-file-parser'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const parseFitFile = inngest.createFunction(
  { id: 'parse-fit-file' },
  { event: 'fit/parse' },
  async ({ event, step }) => {
    const { fileId, userId } = event.data

    try {
      // Step 1: Download FIT file from storage
      const fileData = await step.run('download-fit-file', async () => {
        const { data: fileRecord, error: fileError } = await supabase
          .from('recordings')
          .select('*')
          .eq('id', fileId)
          .eq('user_id', userId)
          .eq('file_type', 'fit')
          .single()

        if (fileError || !fileRecord) {
          throw new Error(`Recording not found: ${fileError?.message}`)
        }

        // Download file (either direct or chunked)
        let fileBuffer: Uint8Array

        // Check if this is a chunked upload by looking if storage_path contains chunks
        const isChunkedUpload = fileRecord.storage_path.includes('chunks/')

        if (isChunkedUpload) {
          // Chunked upload - download and combine chunks
          // List all chunks in the directory
          const { data: chunkFiles, error: listError } = await supabase.storage
            .from('uploads')
            .list(`chunks/${fileId}`)

          if (listError || !chunkFiles || chunkFiles.length === 0) {
            throw new Error(`Failed to list chunks: ${listError?.message || 'No chunks found'}`)
          }

          // Sort chunks by name to ensure correct order
          const sortedChunks = chunkFiles.sort((a, b) => a.name.localeCompare(b.name))

          const chunks = []
          for (const chunkFile of sortedChunks) {
            const chunkPath = `chunks/${fileId}/${chunkFile.name}`
            const { data: chunkData, error: chunkError } = await supabase.storage
              .from('uploads')
              .download(chunkPath)

            if (chunkError) {
              throw new Error(`Failed to download chunk ${chunkPath}: ${chunkError.message}`)
            }

            const arrayBuffer = await chunkData.arrayBuffer()
            chunks.push(new Uint8Array(arrayBuffer))
          }

          // Combine chunks into single buffer
          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
          fileBuffer = new Uint8Array(totalLength)
          let offset = 0
          for (const chunk of chunks) {
            fileBuffer.set(chunk, offset)
            offset += chunk.length
          }
        } else {
          // Direct upload - download file directly
          // Try recordings bucket first (new unified upload flow)
          const { data: recData, error: recError } = await supabase.storage
            .from('recordings')
            .download(fileRecord.storage_path)

          let fileData: Blob

          if (recError) {
            // Fallback to uploads bucket (old flow)
            const { data: uploadData, error: uploadError } = await supabase.storage
              .from('uploads')
              .download(fileRecord.storage_path)

            if (uploadError || !uploadData) {
              throw new Error(`Failed to download file ${fileRecord.storage_path}: ${uploadError?.message || 'No data returned'}`)
            }

            fileData = uploadData
          } else {
            if (!recData) {
              throw new Error(`Failed to download file ${fileRecord.storage_path}: No data returned from recordings bucket`)
            }
            fileData = recData
          }

          const arrayBuffer = await fileData.arrayBuffer()
          fileBuffer = new Uint8Array(arrayBuffer)
        }

        // Convert buffer to base64 for proper serialization between Inngest steps
        const bufferBase64 = Buffer.from(fileBuffer).toString('base64')

        return {
          buffer: bufferBase64, // Store as base64 string for serialization
          filename: fileRecord.filename,
          fileSize: fileRecord.file_size_bytes,
          bufferLength: fileBuffer.length // Store original length for validation
        }
      })

      // Step 2: Parse FIT file
      const parsedData = await step.run('parse-fit-data', async () => {
        // Convert base64 back to buffer
        let buffer: Uint8Array
        try {
          const bufferFromBase64 = Buffer.from(fileData.buffer, 'base64')
          buffer = new Uint8Array(bufferFromBase64)
        } catch (error) {
          throw new Error(`Failed to convert base64 buffer: ${error}`)
        }

        // Validate file buffer
        if (!buffer || buffer.length === 0) {
          throw new Error('File buffer is empty or invalid after base64 conversion')
        }
        
        // Check if file is too small (FIT files should be at least a few KB)
        if (buffer.length < 1024) {
          throw new Error(`File too small to be a valid FIT file: ${buffer.length} bytes (minimum ~1KB expected)`)
        }
        
        // Try parsing with different configurations
        const parseWithConfig = (config: any) => {
          return new Promise<any>((resolve, reject) => {
            const fitParser = new FitParser(config)

            fitParser.parse(buffer, (error: any, data: any) => {
              if (error) {
                console.error('FIT parser error:', error)
                reject(error)
              } else {
                resolve(data)
              }
            })
          })
        }

        // Add timeout to prevent hanging
        const parseWithTimeout = (config: any, timeoutMs: number = 30000) => {
          return Promise.race([
            parseWithConfig(config),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error(`Parsing timeout after ${timeoutMs}ms`)), timeoutMs)
            )
          ])
        }

        try {
          // First try with full configuration
          const parsedData = await parseWithTimeout({
            force: true,
            speedUnit: 'km/h',
            lengthUnit: 'km',
            temperatureUnit: 'celsius',
            pressureUnit: 'bar',
            elapsedRecordField: true,
            mode: 'cascade',
          }, 30000) // 30 second timeout

          return parsedData

        } catch (firstError) {
          try {
            // Fallback to minimal configuration
            const parsedData = await parseWithTimeout({
              force: true,
              mode: 'cascade',
            }, 15000) // 15 second timeout for fallback

            return parsedData

          } catch (secondError) {
            console.error('FIT parsing failed with all configurations:', {
              firstError,
              secondError,
              fileSize: buffer.length,
              fileName: fileData.filename
            })

            const errorMessage = (secondError as any)?.message || secondError?.toString() || 'Unknown parsing error'
            throw new Error(`FIT parsing failed with all configurations: ${errorMessage}`)
          }
        }
      })

      // Step 3: Extract metadata and data points
      const extractedData = await step.run('extract-fit-metadata', async () => {
        const { sessions, records, laps, activity } = parsedData as any
        
        // Try different ways to get session data
        let session = sessions?.[0]
        if (!session && activity?.sessions?.[0]) {
          session = activity.sessions[0]
        }
        if (!session && activity?.session) {
          session = activity.session
        }
        if (!session && laps?.[0]) {
          session = laps[0]
        }

        if (!session) {
          // Fallback: create session-like object from available data
          const records = parsedData.records || []
          const activity = parsedData.activity || {}
          
          if (records.length === 0 && !activity) {
            throw new Error('No session, records, or activity data found in FIT file')
          }
          
          // Create a minimal session object
          session = {
            startTime: activity.timestamp || records[0]?.timestamp,
            totalDistance: activity.totalDistance || 0,
            totalElapsedTime: activity.totalElapsedTime || 0,
            totalAscent: activity.totalAscent || 0,
            maxSpeed: activity.maxSpeed || 0,
            avgSpeed: activity.avgSpeed || 0,
            maxPower: activity.maxPower || 0,
            avgPower: activity.avgPower || 0,
            maxHeartRate: activity.maxHeartRate || 0,
            avgHeartRate: activity.avgHeartRate || 0,
            maxCadence: activity.maxCadence || 0,
            avgCadence: activity.avgCadence || 0,
          }
        }

        // Extract GPS and performance data from records
        const dataPoints = []
        let gpsPointsCount = 0
        let hasGpsData = false

        // Try to get records from different locations based on our investigation
        let recordsToProcess = records || []

        // Check if records are in laps (as discovered in our investigation)
        if (session?.laps && session.laps.length > 0) {
          const lapRecords: any[] = []
          session.laps.forEach((lap: any, index: number) => {
            if (lap.records && lap.records.length > 0) {
              lapRecords.push(...lap.records)
            }
          })

          if (lapRecords.length > 0) {
            recordsToProcess = lapRecords
          }
        }

        if (recordsToProcess && recordsToProcess.length > 0) {

          for (const record of recordsToProcess) {
            const dataPoint: any = {
              timestamp: record.timestamp ? new Date(record.timestamp).toISOString() : null,
              latitude: record.position_lat ? record.position_lat * (180 / Math.pow(2, 31)) : null,
              longitude: record.position_long ? record.position_long * (180 / Math.pow(2, 31)) : null,
              altitude: record.altitude || record.enhanced_altitude || null,
              speed_ms: record.speed ? record.speed / 1000 : null, // Convert mm/s to m/s
              power_watts: record.power || null,
              heart_rate: record.heart_rate || null,
              cadence: record.cadence || null,
              temperature: record.temperature || null,
              grade: record.grade || null,
            }

            // Only include points with valid timestamps
            if (dataPoint.timestamp) {
              dataPoints.push(dataPoint)
              
              if (dataPoint.latitude && dataPoint.longitude) {
                gpsPointsCount++
                hasGpsData = true
              }
            }
          }
        }

        // Calculate metadata (using imperial units)
        const startTime = session.start_time ? new Date(session.start_time).toISOString() : null
        const endTime = session.timestamp ? new Date(session.timestamp).toISOString() : null
        const durationSeconds = session.total_elapsed_time ? Math.round(session.total_elapsed_time) : null

        // Use session's already calculated distance (parser is configured for km, we need meters)
        // The parser settings show lengthUnit: 'km', so total_distance is in km
        const distanceMeters = session.total_distance ? Math.round(session.total_distance * 1000) : null
        const distanceFeet = distanceMeters ? Math.round(distanceMeters * 3.28084) : null

        // Get elevation gain from session data
        // Parser is configured with lengthUnit: 'km', so total_ascent is in kilometers
        const elevationGainKm = session.total_ascent || 0
        const elevationGainMeters = Math.round(elevationGainKm * 1000) // Convert km to meters
        const elevationGainFeet = Math.round(elevationGainMeters * 3.28084)

        // Calculate averages and maximums from data points
        const validPowerPoints = dataPoints.filter(p => p.power_watts !== null)
        const validHRPoints = dataPoints.filter(p => p.heart_rate !== null)
        const validCadencePoints = dataPoints.filter(p => p.cadence !== null)
        const validSpeedPoints = dataPoints.filter(p => p.speed_ms !== null)

        const maxPowerWatts = validPowerPoints.length > 0 ? Math.max(...validPowerPoints.map(p => p.power_watts)) : null
        const avgPowerWatts = validPowerPoints.length > 0 ? Math.round(validPowerPoints.reduce((sum, p) => sum + p.power_watts, 0) / validPowerPoints.length) : null
        const maxHeartRate = validHRPoints.length > 0 ? Math.max(...validHRPoints.map(p => p.heart_rate)) : null
        const avgHeartRate = validHRPoints.length > 0 ? Math.round(validHRPoints.reduce((sum, p) => sum + p.heart_rate, 0) / validHRPoints.length) : null
        const maxCadence = validCadencePoints.length > 0 ? Math.max(...validCadencePoints.map(p => p.cadence)) : null
        const avgCadence = validCadencePoints.length > 0 ? Math.round(validCadencePoints.reduce((sum, p) => sum + p.cadence, 0) / validCadencePoints.length) : null

        // Use session speed data (parser configured for km/h, we need mph)
        let maxSpeedKmh = session.max_speed || null
        let avgSpeedKmh = session.avg_speed || null

        // If session speeds not available, calculate from data points
        if (!maxSpeedKmh && validSpeedPoints.length > 0) {
          maxSpeedKmh = Math.max(...validSpeedPoints.map(p => p.speed_ms))
        }
        if (!avgSpeedKmh && validSpeedPoints.length > 0) {
          avgSpeedKmh = validSpeedPoints.reduce((sum, p) => sum + p.speed_ms, 0) / validSpeedPoints.length
        }

        // Convert speeds from km/h to mph and m/s for storage
        const maxSpeedMph = maxSpeedKmh ? Math.round(maxSpeedKmh * 0.621371 * 10) / 10 : null // Convert km/h to mph, round to 1 decimal
        const avgSpeedMph = avgSpeedKmh ? Math.round(avgSpeedKmh * 0.621371 * 10) / 10 : null
        const maxSpeedMs = maxSpeedKmh ? maxSpeedKmh / 3.6 : null // Convert km/h to m/s
        const avgSpeedMs = avgSpeedKmh ? avgSpeedKmh / 3.6 : null

        return {
          metadata: {
            start_time: startTime,
            end_time: endTime,
            duration_seconds: durationSeconds,
            distance_meters: distanceMeters, // Keep meters for database storage
            distance_feet: distanceFeet, // Add feet for display
            elevation_gain_meters: elevationGainMeters, // Keep meters for database storage
            elevation_gain_feet: elevationGainFeet, // Add feet for display
            max_speed_ms: maxSpeedMs, // Keep m/s for database storage
            avg_speed_ms: avgSpeedMs, // Keep m/s for database storage
            max_speed_mph: maxSpeedMph, // Add mph for display
            avg_speed_mph: avgSpeedMph, // Add mph for display
            max_power_watts: maxPowerWatts,
            avg_power_watts: avgPowerWatts,
            max_heart_rate: maxHeartRate,
            avg_heart_rate: avgHeartRate,
            max_cadence: maxCadence,
            avg_cadence: avgCadence,
            gps_points_count: gpsPointsCount,
            has_gps_data: hasGpsData,
          },
          dataPoints: dataPoints.slice(0, 10000), // Limit to 10k points for now
          ridingTimeAnalysis: null // Will be calculated in the next step
        }
      })

      // Step 3.5: Analyze riding time from data points
      const ridingTimeAnalysis = await step.run('analyze-riding-time', async () => {
        // Import the riding time filter
        const { FitRidingTimeFilter } = await import('@/lib/association/fit-riding-time-filter')

        const analysis = FitRidingTimeFilter.filterRidingTime(extractedData.dataPoints)

        return analysis
      })

      // Step 4: Update FIT recording metadata
      await step.run('update-recording-metadata', async () => {
        // Calculate duration from start/end times
        const durationMs = extractedData.metadata.start_time && extractedData.metadata.end_time
          ? new Date(extractedData.metadata.end_time).getTime() - new Date(extractedData.metadata.start_time).getTime()
          : extractedData.metadata.duration_seconds ? extractedData.metadata.duration_seconds * 1000 : 0

        const { error } = await supabase
          .from('recordings')
          .update({
            status: 'ready',
            processed_at: new Date().toISOString(),
            start_time: extractedData.metadata.start_time,
            end_time: extractedData.metadata.end_time,
            duration_ms: durationMs,
            // Store FIT-specific metadata in analysis_results JSONB field
            analysis_results: {
              distance_meters: extractedData.metadata.distance_meters,
              distance_feet: extractedData.metadata.distance_feet,
              elevation_gain_meters: extractedData.metadata.elevation_gain_meters,
              elevation_gain_feet: extractedData.metadata.elevation_gain_feet,
              max_speed_ms: extractedData.metadata.max_speed_ms,
              avg_speed_ms: extractedData.metadata.avg_speed_ms,
              max_speed_mph: extractedData.metadata.max_speed_mph,
              avg_speed_mph: extractedData.metadata.avg_speed_mph,
              max_power_watts: extractedData.metadata.max_power_watts,
              avg_power_watts: extractedData.metadata.avg_power_watts,
              max_heart_rate: extractedData.metadata.max_heart_rate,
              avg_heart_rate: extractedData.metadata.avg_heart_rate,
              max_cadence: extractedData.metadata.max_cadence,
              avg_cadence: extractedData.metadata.avg_cadence,
              gps_points_count: extractedData.metadata.gps_points_count,
              has_gps_data: extractedData.metadata.has_gps_data,
              riding_time_seconds: Math.round(ridingTimeAnalysis.ridingTimeSeconds),
              stationary_time_seconds: Math.round(ridingTimeAnalysis.stationaryTimeSeconds),
              riding_data_points_count: ridingTimeAnalysis.ridingDataPoints.length,
              stationary_periods_count: ridingTimeAnalysis.stationaryPeriods.length
            }
          })
          .eq('id', fileId)

        if (error) {
          throw new Error(`Failed to update recording metadata: ${error.message}`)
        }
      })

      // Step 5: Automatically create ride entry
      const rideId = await step.run('create-ride-entry', async () => {
        // Generate ride name from filename and date
        const { data: recording } = await supabase
          .from('recordings')
          .select('filename, start_time')
          .eq('id', fileId)
          .single()

        const rideName = recording?.filename.replace(/\.fit$/i, '') || 'Unnamed Ride'
        const rideStartTime = extractedData.metadata.start_time
        const rideEndTime = extractedData.metadata.end_time
        const rideDurationSeconds = extractedData.metadata.duration_seconds || 0
        const distanceMeters = extractedData.metadata.distance_meters || null
        const elevationGainMeters = extractedData.metadata.elevation_gain_meters || null

        // Create ride entry
        const { data: ride, error: rideError } = await supabase
          .from('rides')
          .insert({
            user_id: userId,
            name: rideName,
            start_time: rideStartTime,
            end_time: rideEndTime,
            duration_seconds: rideDurationSeconds,
            distance_meters: distanceMeters,
            elevation_gain_meters: elevationGainMeters
          })
          .select()
          .single()

        if (rideError) {
          throw new Error(`Failed to create ride entry: ${rideError.message}`)
        }

        console.log('Ride created:', ride.id)

        // Create ride_recordings association
        const { error: assocError } = await supabase
          .from('ride_recordings')
          .insert({
            ride_id: ride.id,
            recording_id: fileId
          })

        if (assocError) {
          throw new Error(`Failed to create ride_recordings association: ${assocError.message}`)
        }

        return ride.id
      })

      console.log('FIT file parsing completed successfully')
      return { success: true, rideId, recordingId: fileId }

    } catch (error) {
      console.error('FIT file parsing failed:', error)

      // Update recording status to failed
      await supabase
        .from('recordings')
        .update({
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error'
        })
        .eq('id', fileId)

      throw error
    }
  }
)

// Helper function for automatic ride creation
async function autoCreateRideForFitFile(fitFileId: string, userId: string) {
  try {
    // Fetch FIT file
    const { data: fitFile, error: fitFileError } = await supabase
      .from('fit_files')
      .select('*')
      .eq('id', fitFileId)
      .eq('user_id', userId)
      .single()

    if (fitFileError || !fitFile) {
      return { success: false, error: 'FIT file not found' }
    }

    // Check if already associated
    if (fitFile.associated_imu_file_id) {
      return { 
        success: false, 
        message: 'FIT file already associated',
        associatedWith: fitFile.associated_imu_file_id
      }
    }

    // Extract time range from FIT file with validation
    const fitStartTime = new Date(fitFile.start_time)
    const fitEndTime = new Date(fitFile.end_time)
    
    // Validate timestamps
    if (isNaN(fitStartTime.getTime()) || isNaN(fitEndTime.getTime())) {
      console.error(`❌ Invalid timestamps: start=${fitFile.start_time}, end=${fitFile.end_time}`)
      return { 
        success: false, 
        error: 'Invalid timestamps in FIT file',
        details: {
          start_time: fitFile.start_time,
          end_time: fitFile.end_time
        }
      }
    }
    
    const fitTimeRange = {
      start: fitStartTime,
      end: fitEndTime,
      duration: fitEndTime.getTime() - fitStartTime.getTime()
    }

    // Find potential IMU files with overlapping time ranges
    const bufferMinutes = 30 // 30 minute buffer for time drift
    const searchStart = new Date(fitTimeRange.start.getTime() - bufferMinutes * 60 * 1000)
    const searchEnd = new Date(fitTimeRange.end.getTime() + bufferMinutes * 60 * 1000)

    const { data: potentialImuFiles, error: imuQueryError } = await supabase
      .from('imu_data_files')
      .select('id, filename, start_time, end_time, associated_fit_file_id')
      .eq('user_id', userId)
      .is('associated_fit_file_id', null) // Only unassociated files
      .gte('end_time', searchStart.toISOString())
      .lte('start_time', searchEnd.toISOString())
      .order('start_time', { ascending: true })

    if (imuQueryError) {
      return { success: false, error: 'Failed to query IMU files' }
    }

    if (!potentialImuFiles || potentialImuFiles.length === 0) {
      return { 
        success: false, 
        message: 'No unassociated IMU files found with overlapping time ranges',
        fitTimeRange: {
          start: fitTimeRange.start.toISOString(),
          end: fitTimeRange.end.toISOString(),
          durationMinutes: fitTimeRange.duration / (1000 * 60)
        }
      }
    }

    // Test each potential IMU file for overlap
    const results = []
    for (const imuFile of potentialImuFiles) {
      try {
        // Get IMU data points for time range calculation
        const { data: imuDataPoints, error: imuDataError } = await supabase
          .from('imu_data_points')
          .select('timestamp')
          .eq('imu_file_id', imuFile.id)
          .order('timestamp', { ascending: true })
          .limit(1000) // Limit for performance

        if (imuDataError || !imuDataPoints || imuDataPoints.length === 0) {
          continue
        }

        // Calculate time range and overlap
        const imuTimestamps = imuDataPoints.map(point => new Date(point.timestamp))
        const imuStart = new Date(Math.min(...imuTimestamps.map(t => t.getTime())))
        const imuEnd = new Date(Math.max(...imuTimestamps.map(t => t.getTime())))
        const imuTimeRange = {
          start: imuStart,
          end: imuEnd,
          duration: imuEnd.getTime() - imuStart.getTime()
        }

        // Calculate overlap
        const overlapStart = new Date(Math.max(imuTimeRange.start.getTime(), fitTimeRange.start.getTime()))
        const overlapEnd = new Date(Math.min(imuTimeRange.end.getTime(), fitTimeRange.end.getTime()))
        
        if (overlapStart >= overlapEnd) {
          continue
        }

        const overlapDuration = overlapEnd.getTime() - overlapStart.getTime()
        const imuCoverage = overlapDuration / imuTimeRange.duration
        const fitCoverage = overlapDuration / fitTimeRange.duration
        const avgCoverage = (imuCoverage + fitCoverage) / 2

        // Simple confidence calculation
        const confidence = avgCoverage * 0.6 + (overlapDuration > 15 * 60 * 1000 ? 0.8 : 0.4) * 0.2 + (1.0 - Math.abs(imuCoverage - fitCoverage)) * 0.2

        results.push({
          imuFileId: imuFile.id,
          imuFilename: imuFile.filename,
          confidence,
          overlap: {
            start: overlapStart.toISOString(),
            end: overlapEnd.toISOString(),
            durationMinutes: overlapDuration / (1000 * 60),
            imuCoverage,
            fitCoverage
          }
        })
      } catch (error) {
        console.error(`Error processing IMU file ${imuFile.id}:`, error)
        continue
      }
    }

    // Sort by confidence (highest first)
    results.sort((a, b) => b.confidence - a.confidence)

    // If we have a high-confidence match, automatically create the ride
    const confidenceThreshold = 0.7
    if (results.length > 0 && results[0].confidence >= confidenceThreshold) {
      const bestMatch = results[0]
      
      // Update IMU file with association
      const { error: imuUpdateError } = await supabase
        .from('imu_data_files')
        .update({
          associated_fit_file_id: fitFileId,
          association_method: 'time',
          association_confidence: bestMatch.confidence,
          association_overlap_start: bestMatch.overlap.start,
          association_overlap_end: bestMatch.overlap.end,
          association_overlap_duration_minutes: bestMatch.overlap.durationMinutes,
          association_created_at: new Date().toISOString(),
          association_updated_at: new Date().toISOString()
        })
        .eq('id', bestMatch.imuFileId)

      if (imuUpdateError) {
        return { success: false, error: 'Failed to update IMU file association' }
      }

      // Update FIT file with association
      const { error: fitUpdateError } = await supabase
        .from('fit_files')
        .update({
          associated_imu_file_id: bestMatch.imuFileId,
          association_method: 'time',
          association_confidence: bestMatch.confidence,
          association_overlap_start: bestMatch.overlap.start,
          association_overlap_end: bestMatch.overlap.end,
          association_overlap_duration_minutes: bestMatch.overlap.durationMinutes,
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
          imu_file_id: bestMatch.imuFileId,
          fit_file_id: fitFileId,
          association_method: 'time',
          association_confidence: bestMatch.confidence,
          association_overlap_start: bestMatch.overlap.start,
          association_overlap_end: bestMatch.overlap.end,
          association_overlap_duration_minutes: bestMatch.overlap.durationMinutes,
          created_at: new Date().toISOString()
        })

      if (historyError) {
        console.error('Failed to log association history:', historyError)
      }

      return {
        success: true,
        ride: {
          imuFileId: bestMatch.imuFileId,
          fitFileId: fitFileId,
          confidence: bestMatch.confidence,
          overlap: bestMatch.overlap
        },
        autoMatched: true
      }
    }

    // Return potential matches for manual review
    return {
      success: false,
      message: 'No automatic match found, manual review required',
      potentialMatches: results,
      fitTimeRange: {
        start: fitTimeRange.start.toISOString(),
        end: fitTimeRange.end.toISOString(),
        durationMinutes: fitTimeRange.duration / (1000 * 60)
      }
    }

  } catch (error) {
    console.error('Automatic ride creation failed:', error)
    return { 
      success: false, 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}
