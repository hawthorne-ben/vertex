import { inngest } from '../client'
import { parseIMUCSV, IMUParseError } from '@/lib/imu/parser'
import { ParsedIMUData } from '@/lib/imu/types'
import { createClient } from '@supabase/supabase-js'

const BATCH_SIZE = 10000 // Insert 10k rows at a time

// Create Supabase admin client lazily (only when function runs)
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // Service role key for admin access
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
}

/**
 * Process chunked IMU file uploads
 * Handles large files split into multiple chunks
 */
export const parseIMUChunked = inngest.createFunction(
  { 
    id: 'parse-imu-file-chunked',
    name: 'Parse Chunked IMU CSV File',
    retries: 1 // Limit retries to 1 for faster dev iteration
  },
  { event: 'imu/parse-chunked' },
  async ({ event, step }) => {
    const { fileId, userId, chunkPaths, totalChunks, fileName, fileSize } = event.data
    const supabaseAdmin = getSupabaseAdmin()
    
    console.log(`🚀 Starting chunked IMU parse for file ${fileId}, ${totalChunks} chunks`)

    // Step 1: Get file metadata
    const file = await step.run('get-file-metadata', async () => {
      const { data, error } = await supabaseAdmin
        .from('imu_data_files')
        .select('*')
        .eq('id', fileId)
        .single()

      if (error) {
        console.error(`❌ Database error getting file ${fileId}:`, error)
        throw new Error(`Failed to get file: ${error.message}`)
      }
      if (!data) {
        console.error(`❌ File not found: ${fileId}`)
        throw new Error('File not found')
      }
      
      console.log(`✅ File metadata retrieved: ${data.filename} (${data.file_size_bytes} bytes)`)
      return data
    })

    // Step 2: Update status to parsing
    await step.run('update-status-parsing', async () => {
      const { error } = await supabaseAdmin
        .from('imu_data_files')
        .update({ status: 'parsing' })
        .eq('id', fileId)

      if (error) {
        console.error(`❌ Failed to update status to parsing for ${fileId}:`, error)
        throw new Error(`Failed to update status: ${error.message}`)
      }
    })

    try {
      // Step 3: Download and combine chunks
      const combinedCSV = await step.run('download-and-combine-chunks', async () => {
        let combinedText = ''
        let csvHeader = ''
        
        for (let i = 0; i < chunkPaths.length; i++) {
          const chunkPath = chunkPaths[i]
          
          console.log(`📥 Downloading chunk ${i + 1}/${totalChunks}: ${chunkPath}`)
          
          // Download chunk with timeout
          const downloadTimeout = 30000 // 30 seconds per chunk
          const downloadPromise = supabaseAdmin.storage
            .from('uploads')
            .download(chunkPath)
          
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Chunk ${i} download timeout after 30 seconds`)), downloadTimeout)
          })

          const { data: chunkData, error: downloadError } = await Promise.race([
            downloadPromise,
            timeoutPromise
          ]) as any

          if (downloadError) {
            console.error(`❌ Chunk ${i} download failed:`, downloadError)
            throw new Error(`Failed to download chunk ${i}: ${downloadError.message}`)
          }
          if (!chunkData) {
            console.error(`❌ Chunk ${i} data is empty`)
            throw new Error(`Chunk ${i} data is empty`)
          }

          const chunkText = await chunkData.text()
          
          // Extract header from first chunk
          if (i === 0) {
            const firstNewline = chunkText.indexOf('\n')
            csvHeader = chunkText.substring(0, firstNewline + 1)
            combinedText = chunkText
          } else {
            // Skip header for subsequent chunks
            const firstNewline = chunkText.indexOf('\n')
            const chunkData = chunkText.substring(firstNewline + 1)
            combinedText += chunkData
          }
          
          console.log(`✅ Chunk ${i + 1} downloaded and combined (${chunkText.length} chars)`)
        }

        console.log(`✅ All chunks combined: ${combinedText.length} total characters`)
        
        // Check total file size
        if (combinedText.length > 200 * 1024 * 1024) { // 200MB limit for combined file
          throw new Error(`Combined file too large: ${Math.round(combinedText.length / 1024 / 1024)}MB (max 200MB)`)
        }

        return combinedText
      })

      // Step 4: Parse combined CSV
      const parsedData = await step.run('parse-combined-csv', async () => {
        try {
          const parseTimeout = 600000 // 10 minutes for parsing large files
          
          // Yield control to prevent blocking
          await new Promise(resolve => setImmediate(resolve))
          
          const parsePromise = parseIMUCSV(combinedCSV)
          const parseTimeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('CSV parsing timeout after 10 minutes')), parseTimeout)
          })

          const parsed = await Promise.race([parsePromise, parseTimeoutPromise]) as ParsedIMUData
          console.log(`✅ CSV parsing completed for ${fileId}: ${parsed.sampleCount} samples`)
          
          // Convert to serializable format (Inngest serializes data between steps)
          return {
            samples: parsed.samples.map(s => ({
              timestamp: s.timestamp.toISOString(),
              accel_x: s.accel_x,
              accel_y: s.accel_y,
              accel_z: s.accel_z,
              gyro_x: s.gyro_x,
              gyro_y: s.gyro_y,
              gyro_z: s.gyro_z,
              mag_x: s.mag_x || null,
              mag_y: s.mag_y || null,
              mag_z: s.mag_z || null,
              quat_w: s.quat_w || null,
              quat_x: s.quat_x || null,
              quat_y: s.quat_y || null,
              quat_z: s.quat_z || null
            })),
            startTime: parsed.startTime.toISOString(),
            endTime: parsed.endTime.toISOString(),
            sampleCount: parsed.sampleCount,
            sampleRate: parsed.sampleRate,
            duration: parsed.duration
          }
        } catch (err) {
          console.error(`❌ CSV parsing failed for ${fileId}:`, err)
          if (err instanceof IMUParseError) {
            throw err
          }
          throw new Error(`Parse error: ${err instanceof Error ? err.message : 'Unknown error'}`)
        }
      })

      // Step 5: Insert samples in batches with timeout
      await step.run('insert-samples', async () => {
        const { samples } = parsedData
        let insertedCount = 0
        const insertTimeout = 600000 // 10 minutes for database inserts (large files)
        
        for (let i = 0; i < samples.length; i += BATCH_SIZE) {
          // Yield control every batch to prevent blocking
          if (i > 0) {
            await new Promise(resolve => setImmediate(resolve))
          }
          
          const batch = samples.slice(i, i + BATCH_SIZE)
          
          const rows = batch.map(sample => ({
            user_id: userId,
            imu_file_id: fileId,
            timestamp: sample.timestamp,
            accel_x: sample.accel_x,
            accel_y: sample.accel_y,
            accel_z: sample.accel_z,
            gyro_x: sample.gyro_x,
            gyro_y: sample.gyro_y,
            gyro_z: sample.gyro_z,
            mag_x: sample.mag_x,
            mag_y: sample.mag_y,
            mag_z: sample.mag_z,
            quat_w: sample.quat_w,
            quat_x: sample.quat_x,
            quat_y: sample.quat_y,
            quat_z: sample.quat_z
          }))

          // Insert with timeout
          const insertPromise = supabaseAdmin
            .from('imu_samples')
            .insert(rows)
          
          const insertTimeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Database insert timeout for batch ${Math.floor(i / BATCH_SIZE) + 1}`)), insertTimeout)
          })

          const { error } = await Promise.race([insertPromise, insertTimeoutPromise]) as any

          if (error) {
            console.error(`❌ Batch insert failed for ${fileId}, batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error)
            throw new Error(`Failed to insert batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`)
          }

          insertedCount += rows.length
          console.log(`✅ Batch ${Math.floor(i / BATCH_SIZE) + 1} inserted: ${insertedCount}/${samples.length} samples`)
        }

        console.log(`✅ All samples inserted for ${fileId}: ${insertedCount} total`)
        return insertedCount
      })

      // Step 6: Update file metadata with success
      await step.run('update-metadata', async () => {
        const { error } = await supabaseAdmin
          .from('imu_data_files')
          .update({
            status: 'ready',
            start_time: parsedData.startTime,
            end_time: parsedData.endTime,
            sample_count: parsedData.sampleCount,
            sample_rate: Math.round(parsedData.sampleRate), // Round to nearest integer
            parsed_at: new Date().toISOString()
          })
          .eq('id', fileId)

        if (error) throw new Error(`Failed to update metadata: ${error.message}`)
      })

      // Step 7: Clean up chunk files (optional - keep for debugging)
      await step.run('cleanup-chunks', async () => {
        try {
          // Delete chunk files to save storage space
          const { error } = await supabaseAdmin.storage
            .from('uploads')
            .remove(chunkPaths)

          if (error) {
            console.warn(`⚠️ Failed to cleanup chunks for ${fileId}:`, error)
            // Don't fail the entire process for cleanup errors
          } else {
            console.log(`✅ Chunk files cleaned up for ${fileId}`)
          }
        } catch (cleanupError) {
          console.warn(`⚠️ Chunk cleanup error for ${fileId}:`, cleanupError)
          // Don't fail the entire process for cleanup errors
        }
      })

      return {
        success: true,
        fileId,
        sampleCount: parsedData.sampleCount,
        duration: parsedData.duration,
        sampleRate: parsedData.sampleRate,
        chunksProcessed: totalChunks
      }

    } catch (err) {
      // Update status to error - do this OUTSIDE of Inngest steps to avoid step failures
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      
      console.error(`❌ Chunked parse failed for file ${fileId}:`, errorMessage)
      
      try {
        const { error: updateError } = await supabaseAdmin
          .from('imu_data_files')
          .update({
            status: 'failed',
            error_message: errorMessage
          })
          .eq('id', fileId)

        if (updateError) {
          console.error('Failed to update error status:', updateError)
        } else {
          console.log(`✅ Error status updated for file ${fileId}`)
        }
      } catch (updateErr) {
        console.error(`❌ CRITICAL: Failed to update error status for ${fileId}:`, updateErr)
      }

      throw err
    }
  }
)
