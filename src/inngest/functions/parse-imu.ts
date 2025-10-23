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

export const parseIMU = inngest.createFunction(
  { 
    id: 'parse-imu-file',
    name: 'Parse IMU CSV File',
    retries: 3 // Limit retries to 3
  },
  { event: 'imu/parse' },
  async ({ event, step }) => {
    const { fileId, userId } = event.data
    const supabaseAdmin = getSupabaseAdmin()
    
    console.log(`🚀 Starting IMU parse for file ${fileId}, user ${userId}`)

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
        .update({ 
          status: 'parsing',
          processing_started_at: new Date().toISOString(),
          error_message: null // Clear any previous error messages
        })
        .eq('id', fileId)

      if (error) {
        console.error(`❌ Failed to update status to parsing for ${fileId}:`, error)
        throw new Error(`Failed to update status: ${error.message}`)
      }
    })

    try {
      // Step 3: Download, parse and insert CSV in one step to avoid large data transfer
      const result = await step.run('download-parse-insert', async () => {
        try {
          // Download CSV from storage with timeout
          const downloadTimeout = 30000 // 30 seconds
          const downloadPromise = supabaseAdmin.storage
            .from('uploads')
            .download(file.storage_path)
          
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Storage download timeout after 30 seconds')), downloadTimeout)
          })

          const { data: fileData, error: downloadError } = await Promise.race([
            downloadPromise,
            timeoutPromise
          ]) as any

          if (downloadError) {
            console.error(`❌ Storage download failed for ${fileId}:`, downloadError)
            throw new Error(`Failed to download file: ${downloadError.message}`)
          }
          if (!fileData) {
            console.error(`❌ File data is empty for ${fileId}`)
            throw new Error('File data is empty')
          }

          const csvText = await fileData.text()
          
          // Check file size before parsing
          if (csvText.length > 100 * 1024 * 1024) { // 100MB limit
            throw new Error(`File too large for processing: ${Math.round(csvText.length / 1024 / 1024)}MB (max 100MB)`)
          }

          // Parse CSV with timeout and yield control to prevent blocking
          const parseTimeout = 300000 // 5 minutes for parsing large files
          
          // Yield control to prevent blocking the main thread
          await new Promise(resolve => setImmediate(resolve))
          
          const parsePromise = parseIMUCSV(csvText)
          const parseTimeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('CSV parsing timeout after 5 minutes')), parseTimeout)
          })

          const parsed = await Promise.race([parsePromise, parseTimeoutPromise]) as ParsedIMUData
          console.log(`✅ CSV parsing completed for ${fileId}: ${parsed.sampleCount} samples`)
          
          // Insert samples in batches immediately to avoid large data transfer
          let insertedCount = 0
          const insertTimeout = 300000 // 5 minutes for database inserts
          
          for (let i = 0; i < parsed.samples.length; i += BATCH_SIZE) {
            // Yield control every batch to prevent blocking
            if (i > 0) {
              await new Promise(resolve => setImmediate(resolve))
            }
            
            const batch = parsed.samples.slice(i, i + BATCH_SIZE)
            
            const rows = batch.map(sample => ({
              user_id: userId,
              imu_file_id: fileId,
              timestamp: sample.timestamp.toISOString(),
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
          }

          console.log(`✅ All samples inserted for ${fileId}: ${insertedCount} total`)
          
          // Return only essential metadata to avoid "output_too_large" error
          return {
            startTime: parsed.startTime.toISOString(),
            endTime: parsed.endTime.toISOString(),
            sampleCount: parsed.sampleCount,
            sampleRate: parsed.sampleRate,
            duration: parsed.duration,
            insertedCount
          }
        } catch (err) {
          console.error(`❌ CSV parsing failed for ${fileId}:`, err)
          if (err instanceof IMUParseError) {
            throw err
          }
          throw new Error(`Parse error: ${err instanceof Error ? err.message : 'Unknown error'}`)
        }
      }).catch(async (stepError) => {
        // Handle errors within the step, especially "output_too_large"
        const errorMessage = stepError instanceof Error ? stepError.message : 'Unknown step error'
        console.error(`❌ Step error for file ${fileId}:`, errorMessage)
        console.error(`❌ Step error type:`, typeof stepError)
        console.error(`❌ Step error details:`, stepError)
        
        // Check if it's an "output_too_large" error
        if (errorMessage.includes('output_too_large') || errorMessage.includes('too large')) {
          console.error(`❌ OUTPUT_TOO_LARGE detected for file ${fileId} - updating status to failed`)
          
          // Update database status immediately
          try {
            const { error: updateError } = await supabaseAdmin
              .from('imu_data_files')
              .update({
                status: 'failed',
                error_message: 'File too large for processing (output_too_large)',
                processing_completed_at: new Date().toISOString()
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
        }
        
        // Always throw a proper Error object to avoid deserialization issues
        const properError = stepError instanceof Error 
          ? stepError 
          : new Error(typeof stepError === 'string' ? stepError : 'Unknown step error')
        
        throw properError
      })

      // Step 4: Update file metadata with success
      await step.run('update-metadata', async () => {
        const { error } = await supabaseAdmin
          .from('imu_data_files')
          .update({
            status: 'ready',
            start_time: result.startTime,
            end_time: result.endTime,
            sample_count: result.sampleCount,
            sample_rate: Math.round(result.sampleRate), // Round to nearest integer
            parsed_at: new Date().toISOString(),
            processing_completed_at: new Date().toISOString()
          })
          .eq('id', fileId)

        if (error) throw new Error(`Failed to update metadata: ${error.message}`)
      })

      return {
        success: true,
        fileId,
        sampleCount: result.sampleCount,
        duration: result.duration,
        sampleRate: result.sampleRate
      }

    } catch (err) {
      // Update status to error - do this OUTSIDE of Inngest steps to avoid step failures
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      
      console.error(`❌ Parse failed for file ${fileId}:`, errorMessage)
      console.error(`❌ Error type:`, typeof err)
      console.error(`❌ Error details:`, err)
      
      try {
        // COMPENSATION: Clean up any orphaned samples before marking as failed
        console.log(`🧹 Cleaning up orphaned samples for failed file ${fileId}`)
        
        const { data: orphanedSamples, error: countError } = await supabaseAdmin
          .from('imu_samples')
          .select('id')
          .eq('imu_file_id', fileId)
          .limit(1) // Just check if any exist
        
        if (countError) {
          console.error('Failed to check for orphaned samples:', countError)
        } else if (orphanedSamples && orphanedSamples.length > 0) {
          console.log(`🗑️ Found orphaned samples for file ${fileId}, cleaning up...`)
          
          // Delete orphaned samples in batches
          let deletedCount = 0
          const BATCH_SIZE = 10000
          let hasMore = true
          
          while (hasMore) {
            const { data: sampleBatch, error: fetchError } = await supabaseAdmin
              .from('imu_samples')
              .select('id')
              .eq('imu_file_id', fileId)
              .limit(BATCH_SIZE)
            
            if (fetchError || !sampleBatch || sampleBatch.length === 0) {
              hasMore = false
              break
            }
            
            const { error: deleteError } = await supabaseAdmin
              .from('imu_samples')
              .delete()
              .in('id', sampleBatch.map(s => s.id))
            
            if (deleteError) {
              console.error('Failed to delete orphaned sample batch:', deleteError)
              break
            }
            
            deletedCount += sampleBatch.length
            console.log(`✅ Cleaned up ${deletedCount} orphaned samples`)
            
            if (sampleBatch.length < BATCH_SIZE) {
              hasMore = false
            }
          }
          
          console.log(`✅ Cleanup complete: ${deletedCount} orphaned samples removed`)
        } else {
          console.log(`✅ No orphaned samples found for file ${fileId}`)
        }
        
        // Now update the file status to failed
        const { error: updateError } = await supabaseAdmin
          .from('imu_data_files')
          .update({
            status: 'failed',
            error_message: errorMessage,
            processing_completed_at: new Date().toISOString()
          })
          .eq('id', fileId)

        if (updateError) {
          console.error('Failed to update error status:', updateError)
        } else {
          console.log(`✅ Error status updated for file ${fileId}: ${errorMessage}`)
        }
      } catch (updateErr) {
        console.error(`❌ CRITICAL: Failed to update error status for ${fileId}:`, updateErr)
      }

      // Always throw a proper Error object to avoid Inngest deserialization issues
      const properError = err instanceof Error 
        ? err 
        : new Error(typeof err === 'string' ? err : errorMessage)
      
      throw properError
    }
  }
)

