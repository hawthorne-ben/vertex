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

    console.log(`🚴‍♂️ Starting FIT file parsing for file ${fileId}`)

    try {
      // Step 1: Download FIT file from storage
      const fileData = await step.run('download-fit-file', async () => {
        console.log(`📥 Downloading FIT file ${fileId} from storage`)
        
        const { data: fileRecord, error: fileError } = await supabase
          .from('fit_files')
          .select('*')
          .eq('id', fileId)
          .eq('user_id', userId)
          .single()

        if (fileError || !fileRecord) {
          throw new Error(`File not found: ${fileError?.message}`)
        }

        // Download file (either direct or chunked)
        let fileBuffer: Uint8Array
        
        // Check if this is a chunked upload by looking for chunk_count or if storage_path contains chunks
        const isChunkedUpload = fileRecord.chunk_count && fileRecord.chunk_count > 1 || fileRecord.storage_path.includes('chunks/')
        
        if (isChunkedUpload) {
          // Chunked upload - download and combine chunks
          console.log(`📦 Downloading chunked FIT file: ${fileRecord.filename}`)
          
          const chunkPaths = []
          for (let i = 0; i < (fileRecord.chunk_count || 1); i++) {
            const chunkFileName = `${fileId}_chunk_${i.toString().padStart(3, '0')}`
            chunkPaths.push(`chunks/${fileId}/${chunkFileName}`)
          }

          const chunks = []
          for (const chunkPath of chunkPaths) {
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
          console.log(`📁 Downloading direct FIT file: ${fileRecord.filename}`)
          console.log(`📁 Storage path: ${fileRecord.storage_path}`)
          
          const { data: fileData, error: fileError } = await supabase.storage
            .from('uploads')
            .download(fileRecord.storage_path)

          if (fileError) {
            throw new Error(`Failed to download file ${fileRecord.storage_path}: ${fileError.message}`)
          }

          console.log(`📁 Downloaded file type: ${fileData.constructor.name}`)
          console.log(`📁 Downloaded file size: ${fileData.size} bytes`)
          
          const arrayBuffer = await fileData.arrayBuffer()
          console.log(`📁 ArrayBuffer size: ${arrayBuffer.byteLength} bytes`)
          
          fileBuffer = new Uint8Array(arrayBuffer)
          console.log(`📁 Uint8Array size: ${fileBuffer.length} bytes`)
        }

        // Convert buffer to base64 for proper serialization between Inngest steps
        const bufferBase64 = Buffer.from(fileBuffer).toString('base64')
        
        console.log(`📁 Returning file data: ${fileRecord.filename}, ${fileBuffer.length} bytes, base64 length: ${bufferBase64.length}`)
        
        return {
          buffer: bufferBase64, // Store as base64 string for serialization
          filename: fileRecord.filename,
          fileSize: fileRecord.file_size_bytes,
          bufferLength: fileBuffer.length // Store original length for validation
        }
      })

      // Step 2: Parse FIT file
      const parsedData = await step.run('parse-fit-data', async () => {
        console.log(`🔍 Parsing FIT file: ${fileData.filename}`)
        console.log(`📊 File buffer size: ${fileData.bufferLength} bytes`)
        
        // Convert base64 back to buffer
        let buffer: Uint8Array
        try {
          const bufferFromBase64 = Buffer.from(fileData.buffer, 'base64')
          buffer = new Uint8Array(bufferFromBase64)
          console.log(`📊 Converted buffer length: ${buffer.length} bytes`)
        } catch (error) {
          throw new Error(`Failed to convert base64 buffer: ${error}`)
        }
        
        // Validate file buffer
        if (!buffer || buffer.length === 0) {
          throw new Error('File buffer is empty or invalid after base64 conversion')
        }
        
        // Check if buffer length matches expected
        if (buffer.length !== fileData.bufferLength) {
          console.warn(`⚠️ Converted buffer size (${buffer.length}) doesn't match expected size (${fileData.bufferLength})`)
        }
        
        console.log(`📊 Buffer type: ${buffer.constructor.name}`)
        console.log(`📊 Expected file size: ${fileData.fileSize} bytes`)
        
        // Check if file size matches
        if (buffer.length !== fileData.fileSize) {
          console.warn(`⚠️ Buffer size (${buffer.length}) doesn't match expected size (${fileData.fileSize})`)
        }
        
        // Check if file is too small (FIT files should be at least a few KB)
        if (buffer.length < 1024) {
          throw new Error(`File too small to be a valid FIT file: ${buffer.length} bytes (minimum ~1KB expected)`)
        }
        
        // Check if it looks like a FIT file (basic validation)
        const firstBytes = buffer.slice(0, 4)
        console.log(`📊 First 4 bytes: ${Array.from(firstBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`)
        
        // Check for common FIT file signatures
        const firstByte = firstBytes[0]
        if (firstByte === 0x0E) {
          console.log('✅ File starts with FIT header byte (0x0E)')
        } else {
          console.warn(`⚠️ File doesn't start with expected FIT header byte (0x0E), got: 0x${firstByte.toString(16)}`)
        }
        
        // Try parsing with different configurations
        const parseWithConfig = (config: any) => {
          return new Promise<any>((resolve, reject) => {
            console.log(`🔍 Creating FIT parser with config:`, config)
            const fitParser = new FitParser(config)
            
            console.log(`🔍 Starting FIT parser.parse() for ${buffer.length} bytes`)
            const startTime = Date.now()
            
            fitParser.parse(buffer, (error: any, data: any) => {
              const parseTime = Date.now() - startTime
              console.log(`🔍 FIT parser completed in ${parseTime}ms`)
              
              if (error) {
                console.error(`❌ FIT parser error after ${parseTime}ms:`, error)
                reject(error)
              } else {
                console.log(`✅ FIT parser success after ${parseTime}ms`)
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
          console.log('🔍 Attempting FIT parsing with full configuration...')
          
          const parsedData = await parseWithTimeout({
            force: true,
            speedUnit: 'km/h',
            lengthUnit: 'km',
            temperatureUnit: 'celsius',
            pressureUnit: 'bar',
            elapsedRecordField: true,
            mode: 'cascade',
          }, 30000) // 30 second timeout
          
          console.log('✅ FIT file parsed successfully with full configuration')
          console.log('Parsed data keys:', Object.keys(parsedData || {}))
          return parsedData
          
        } catch (firstError) {
          console.warn('⚠️ Full configuration failed, trying minimal configuration...')
          console.warn('First error:', firstError)
          
          try {
            // Fallback to minimal configuration
            console.log('🔍 Attempting FIT parsing with minimal configuration...')
            const parsedData = await parseWithTimeout({
              force: true,
              mode: 'cascade',
            }, 15000) // 15 second timeout for fallback
            
            console.log('✅ FIT file parsed successfully with minimal configuration')
            console.log('Parsed data keys:', Object.keys(parsedData || {}))
            return parsedData
            
          } catch (secondError) {
            console.error('❌ Both parsing configurations failed')
            console.error('First error:', firstError)
            console.error('Second error:', secondError)
            console.error('File size:', buffer.length)
            console.error('File name:', fileData.filename)
            
            // Provide detailed error information
            const errorMessage = (secondError as any)?.message || secondError?.toString() || 'Unknown parsing error'
            throw new Error(`FIT parsing failed with all configurations: ${errorMessage}`)
          }
        }
      })

      // Step 3: Extract metadata and data points
      const extractedData = await step.run('extract-fit-metadata', async () => {
        console.log(`📊 Extracting metadata from parsed FIT data`)
        console.log(`📊 Available data keys: ${Object.keys(parsedData).join(', ')}`)
        
        const { sessions, records, laps, activity } = parsedData as any
        
        // Try different ways to get session data
        let session = sessions?.[0]
        if (!session && activity?.sessions?.[0]) {
          session = activity.sessions[0]
          console.log('📊 Using session from activity.sessions')
        }
        if (!session && activity?.session) {
          session = activity.session
          console.log('📊 Using session from activity.session')
        }
        if (!session && laps?.[0]) {
          session = laps[0]
          console.log('📊 Using lap data as session')
        }
        
        if (!session) {
          console.warn('⚠️ No session data found, trying to extract from activity and records')
          
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
          
          console.log('📊 Created fallback session from activity/records data')
        } else {
          console.log('📊 Using session data from FIT file')
        }

        // Extract GPS and performance data from records
        const dataPoints = []
        let gpsPointsCount = 0
        let hasGpsData = false

        // Try to get records from different locations based on our investigation
        let recordsToProcess = records || []
        
        // Check if records are in laps (as discovered in our investigation)
        if (session?.laps && session.laps.length > 0) {
          console.log(`📊 Found ${session.laps.length} laps, checking for records in laps`)
          const lapRecords: any[] = []
          session.laps.forEach((lap: any, index: number) => {
            if (lap.records && lap.records.length > 0) {
              console.log(`📊 Lap ${index + 1} has ${lap.records.length} records`)
              lapRecords.push(...lap.records)
            }
          })
          
          if (lapRecords.length > 0) {
            console.log(`📊 Using ${lapRecords.length} records from laps`)
            recordsToProcess = lapRecords
          }
        }

        if (recordsToProcess && recordsToProcess.length > 0) {
          console.log(`📊 Processing ${recordsToProcess.length} data records`)
          
          for (const record of recordsToProcess) {
            const dataPoint: any = {
              timestamp: record.timestamp ? new Date(record.timestamp).toISOString() : null,
              latitude: record.position_lat ? record.position_lat * (180 / Math.pow(2, 31)) : null,
              longitude: record.position_long ? record.position_long * (180 / Math.pow(2, 31)) : null,
              altitude: record.altitude || null,
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
        } else {
          console.log('⚠️ No records found in FIT file')
          console.log(`📊 Available data structure:`, Object.keys(parsedData))
          console.log(`📊 Session structure:`, session ? Object.keys(session) : 'No session')
          if (session?.laps) {
            console.log(`📊 Laps structure:`, session.laps.map((lap: any, i: number) => ({
              lapIndex: i,
              keys: Object.keys(lap),
              hasRecords: !!(lap.records && lap.records.length > 0)
            })))
          }
        }

        // Calculate metadata (using imperial units)
        const startTime = session.start_time ? new Date(session.start_time).toISOString() : null
        const endTime = session.timestamp ? new Date(session.timestamp).toISOString() : null
        const durationSeconds = session.total_elapsed_time ? Math.round(session.total_elapsed_time) : null
        
        // Convert distance from km to meters, then to feet
        const distanceMeters = session.total_distance ? Math.round(session.total_distance * 1000) : null
        const distanceFeet = distanceMeters ? Math.round(distanceMeters * 3.28084) : null
        
        // Debug elevation data - show ALL available fields
        console.log('📊 Complete FIT data structure debug:')
        console.log('📊 Session keys:', Object.keys(session))
        console.log('📊 Session elevation fields:', {
          total_ascent: session.total_ascent,
          total_descent: session.total_descent,
          elevation_gain: session.elevation_gain,
          ascent: session.ascent,
          total_elevation_gain: session.total_elevation_gain,
          elevation_ascent: session.elevation_ascent,
          gain_elevation: session.gain_elevation,
          climb_elevation: session.climb_elevation,
          // Check for any field containing 'elevation' or 'ascent'
          ...Object.keys(session).filter(key => 
            key.toLowerCase().includes('elevation') || 
            key.toLowerCase().includes('ascent') ||
            key.toLowerCase().includes('climb') ||
            key.toLowerCase().includes('gain')
          ).reduce((acc, key) => ({ ...acc, [key]: session[key] }), {})
        })
        
        // Also check activity level elevation data
        if (activity) {
          console.log('📊 Activity elevation fields:', {
            ...Object.keys(activity).filter(key => 
              key.toLowerCase().includes('elevation') || 
              key.toLowerCase().includes('ascent') ||
              key.toLowerCase().includes('climb') ||
              key.toLowerCase().includes('gain')
            ).reduce((acc, key) => ({ ...acc, [key]: activity[key] }), {})
          })
        }
        
        // Check if elevation data is in records
        if (recordsToProcess && recordsToProcess.length > 0) {
          const sampleRecord = recordsToProcess[0]
          console.log('📊 Sample record elevation fields:', {
            ...Object.keys(sampleRecord).filter(key => 
              key.toLowerCase().includes('elevation') || 
              key.toLowerCase().includes('ascent') ||
              key.toLowerCase().includes('climb') ||
              key.toLowerCase().includes('gain') ||
              key.toLowerCase().includes('altitude')
            ).reduce((acc, key) => ({ ...acc, [key]: sampleRecord[key] }), {})
          })
        }
        
        // Use total ascent (represents work done climbing hills)
        let elevationGainMeters = session.total_ascent || session.elevation_gain || session.ascent || 0
        let elevationGainFeet = Math.round(elevationGainMeters * 3.28084)
        
        // If session elevation seems too low, try calculating from altitude data
        if (elevationGainMeters < 10 && recordsToProcess && recordsToProcess.length > 0) {
          console.log('⚠️ Session elevation seems low, calculating from altitude data...')
          
          const altitudePoints = recordsToProcess
            .map((r: any) => r.altitude)
            .filter((alt: any) => alt !== null && alt !== undefined && alt > 0)
          
          if (altitudePoints.length > 10) {
            // Calculate elevation gain by summing positive altitude changes
            let calculatedGain = 0
            for (let i = 1; i < altitudePoints.length; i++) {
              const change = altitudePoints[i] - altitudePoints[i-1]
              if (change > 0) {
                calculatedGain += change
              }
            }
            
            if (calculatedGain > elevationGainMeters) {
              console.log(`📊 Calculated elevation gain from altitude: ${calculatedGain.toFixed(2)}m (was ${elevationGainMeters}m)`)
              elevationGainMeters = calculatedGain
              elevationGainFeet = Math.round(elevationGainMeters * 3.28084)
            }
          }
        }

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
        const maxSpeedMs = validSpeedPoints.length > 0 ? Math.max(...validSpeedPoints.map(p => p.speed_ms)) : null
        const avgSpeedMs = validSpeedPoints.length > 0 ? validSpeedPoints.reduce((sum, p) => sum + p.speed_ms, 0) / validSpeedPoints.length : null
        
        // Convert speeds from m/s to mph for imperial units
        const maxSpeedMph = maxSpeedMs ? Math.round(maxSpeedMs * 2.23694 * 10) / 10 : null // Convert m/s to mph, round to 1 decimal
        const avgSpeedMph = avgSpeedMs ? Math.round(avgSpeedMs * 2.23694 * 10) / 10 : null

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
          dataPoints: dataPoints.slice(0, 10000) // Limit to 10k points for now
        }
      })

      // Step 4: Update FIT file metadata
      await step.run('update-fit-metadata', async () => {
        console.log(`💾 Updating FIT file metadata`)
        
        const { error } = await supabase
          .from('fit_files')
          .update({
            status: 'ready',
            parsed_at: new Date().toISOString(),
            ...extractedData.metadata
          })
          .eq('id', fileId)

        if (error) {
          throw new Error(`Failed to update FIT file metadata: ${error.message}`)
        }

        console.log(`✅ FIT file metadata updated`)
      })

      // Step 5: Insert data points in batches
      await step.run('insert-fit-data-points', async () => {
        console.log(`📊 Inserting ${extractedData.dataPoints.length} FIT data points`)
        
        if (extractedData.dataPoints.length === 0) {
          console.log('⚠️ No data points to insert')
          return
        }

        const BATCH_SIZE = 1000
        const batches = []
        for (let i = 0; i < extractedData.dataPoints.length; i += BATCH_SIZE) {
          batches.push(extractedData.dataPoints.slice(i, i + BATCH_SIZE))
        }

        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i]
          const dataPointsWithIds = batch.map(point => ({
            fit_file_id: fileId,
            ...point
          }))

          const { error } = await supabase
            .from('fit_data_points')
            .insert(dataPointsWithIds)

          if (error) {
            throw new Error(`Failed to insert batch ${i + 1}: ${error.message}`)
          }

          console.log(`✅ Inserted batch ${i + 1}/${batches.length} (${batch.length} points)`)
        }

        console.log(`✅ All FIT data points inserted successfully`)
      })

      // Step 4: Automatic ride creation disabled - use Ride Builder for manual creation
      await step.run('log-manual-ride-creation', async () => {
        console.log(`🚴‍♂️ FIT file parsing complete for ${fileId}`)
        console.log(`ℹ️ Use the Ride Builder (/ride-builder) to manually create rides`)
        console.log(`ℹ️ Automatic ride creation is disabled - manual control preferred`)
      })

      console.log(`🎉 FIT file parsing completed successfully for file ${fileId}`)
      return { success: true, dataPointsCount: extractedData.dataPoints.length }

    } catch (error) {
      console.error(`❌ FIT file parsing failed for file ${fileId}:`, error)
      
      // Update file status to failed
      await supabase
        .from('fit_files')
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
    console.log(`📊 FIT file timestamps: start_time=${fitFile.start_time}, end_time=${fitFile.end_time}`)
    
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
    
    console.log(`🔍 Searching for IMU files between ${searchStart.toISOString()} and ${searchEnd.toISOString()}`)

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
