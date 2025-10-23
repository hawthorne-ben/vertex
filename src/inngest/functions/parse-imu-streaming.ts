import { inngest } from '../client'
import { parseIMUCSVStreaming, StreamingParseOptions } from '@/lib/imu/streaming-parser'
import { createClient } from '@supabase/supabase-js'
import { IMUSample } from '@/lib/imu/types'

const BATCH_SIZE = 50000 // Insert 50k rows at a time for better performance

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
 * True streaming IMU file processor
 * Processes CSV files row-by-row without loading entire file into memory
 */
export const parseIMUStreaming = inngest.createFunction(
  { 
    id: 'parse-imu-file-streaming',
    name: 'Parse IMU CSV File (Streaming)',
    retries: 1, // Limit retries to 1 for faster dev iteration
    timeouts: { finish: '30s' } // 30 second timeout for dev debugging
  },
  { event: 'imu/parse-streaming' },
  async ({ event, step }) => {
    const { fileId, userId } = event.data
    const supabaseAdmin = getSupabaseAdmin()
    
    console.log(`🚀 Starting streaming IMU parse for file ${fileId}, user ${userId}`)

    // Step 1: Get file metadata and check for resume
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
        throw new Error(`File ${fileId} not found`)
      }

      console.log(`✅ File metadata retrieved: ${data.filename} (${data.file_size_bytes} bytes)`)
      return data
    })

    // Step 2: Update status to parsing with streaming mode
    await step.run('update-status-parsing', async () => {
      const { error } = await supabaseAdmin
        .from('imu_data_files')
        .update({ 
          status: 'parsing',
          streaming_mode: true,
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
      // Step 3: Download, parse and process CSV in one step to avoid large data transfer
      const result = await step.run('download-parse-process', async () => {
        try {
          console.log(`📥 Downloading CSV from storage: ${file.storage_path}`)
          
          let csvText = ''
          
          if (file.chunk_count && file.chunk_count > 1) {
          // Handle chunked files - download and combine chunks
          console.log(`📦 Downloading ${file.chunk_count} chunks for file ${fileId}`)
          
          // Extract the original fileId from storage_path (e.g., "chunks/file_123_abc" -> "file_123_abc")
          const originalFileId = file.storage_path.replace('chunks/', '')
          console.log(`📦 Original fileId for chunks: ${originalFileId}`)
          
          const downloadTimeout = 30000 // 30 seconds per chunk
          
          for (let i = 0; i < file.chunk_count; i++) {
            const chunkPath = `chunks/${originalFileId}/${originalFileId}_chunk_${i.toString().padStart(3, '0')}`
            console.log(`📥 Downloading chunk ${i + 1}/${file.chunk_count}: ${chunkPath}`)
            
            const downloadPromise = supabaseAdmin.storage
              .from('uploads')
              .download(chunkPath)
            
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error(`Chunk ${i} download timeout after 30 seconds`)), downloadTimeout)
            })

            const { data: chunkData, error: chunkError } = await Promise.race([
              downloadPromise,
              timeoutPromise
            ]) as any

            if (chunkError) {
              console.error(`❌ Chunk ${i} download failed:`, chunkError)
              throw new Error(`Failed to download chunk ${i}: ${chunkError.message}`)
            }
            if (!chunkData) {
              console.error(`❌ Chunk ${i} data is empty`)
              throw new Error(`Chunk ${i} data is empty`)
            }

            const chunkText = await chunkData.text()
            
            if (i === 0) {
              // First chunk - use as is
              csvText = chunkText
            } else {
              // Subsequent chunks - remove header and append
              const firstNewline = chunkText.indexOf('\n')
              if (firstNewline !== -1) {
                csvText += chunkText.substring(firstNewline + 1)
              } else {
                csvText += chunkText
              }
            }
            
            console.log(`✅ Chunk ${i + 1}/${file.chunk_count} downloaded: ${chunkText.length} characters`)
          }
          
          console.log(`✅ All chunks combined: ${csvText.length} characters`)
        } else {
          // Handle single file (non-chunked)
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

          csvText = await fileData.text()
          console.log(`✅ CSV downloaded: ${csvText.length} characters`)
        }

        // Now parse the CSV in the same step to avoid large data transfer
        let totalProcessed = file.samples_processed || 0
        let batchNumber = 0

        const streamingOptions: StreamingParseOptions = {
          batchSize: BATCH_SIZE,
          
          onBatch: async (samples: IMUSample[], currentBatchNumber: number) => {
            const batchStartTime = Date.now()
            batchNumber = currentBatchNumber

            // Insert batch into database with optimized query
            const rows = samples.map(sample => ({
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

            // Use upsert for better performance and handle duplicates gracefully
            const { error } = await supabaseAdmin
              .from('imu_samples')
              .upsert(rows, { 
                onConflict: 'user_id,imu_file_id,timestamp',
                ignoreDuplicates: true 
              })

            if (error) {
              console.error(`❌ Batch insert failed for ${fileId}:`, error)
              throw new Error(`Batch insert failed: ${error.message}`)
            }

            totalProcessed += samples.length
            const batchDuration = Date.now() - batchStartTime

            console.log(`✅ Batch ${batchNumber} processed: ${samples.length} samples in ${batchDuration}ms`)
          },
          
          onProgress: (processedCount: number, totalEstimate?: number) => {
            if (processedCount % 1000 === 0) {
              const totalText = totalEstimate ? `/${totalEstimate}` : ''
              console.log(`📊 Progress: ${processedCount}${totalText} samples processed`)
            }
          },
          
          onComplete: async (totalProcessed: number) => {
            console.log(`✅ Streaming parse completed: ${totalProcessed} total samples processed`)
          }
        }

        // Start streaming parse
        const parseResult = await parseIMUCSVStreaming(csvText, streamingOptions)
        
        console.log(`✅ Streaming parsing completed for ${fileId}: ${parseResult.totalProcessed} samples`)
        
          // Return only essential data to avoid "output_too_large" error
          return {
            totalProcessed: parseResult.totalProcessed,
            success: parseResult.success,
            errorCount: parseResult.errors.length
          }
        } catch (stepError) {
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
                  streaming_mode: false,
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
        }
      })

      // Step 4: Update file metadata with success
      await step.run('update-metadata', async () => {
        const { error } = await supabaseAdmin
          .from('imu_data_files')
          .update({
            status: 'ready',
            streaming_mode: false,
            sample_count: result.totalProcessed,
            sample_rate: Math.round(result.totalProcessed / (file.file_size_bytes / (result.totalProcessed * 0.001))), // Rough estimate
            parsed_at: new Date().toISOString(),
            processing_completed_at: new Date().toISOString()
          })
          .eq('id', fileId)

        if (error) throw new Error(`Failed to update metadata: ${error.message}`)
      })

      // Return minimal data to avoid "output_too_large" error
      return {
        success: true,
        fileId,
        sampleCount: result.totalProcessed,
        totalErrors: result.errorCount,
        streamingMode: true,
        message: `Successfully processed ${result.totalProcessed} samples`
      }

    } catch (err) {
      // Update status to error - do this OUTSIDE of Inngest steps to avoid step failures
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      
      console.error(`❌ Streaming parse failed for file ${fileId}:`, errorMessage)
      console.error(`❌ Error type:`, typeof err)
      console.error(`❌ Error details:`, err)
      
      try {
        // COMPENSATION: Clean up any orphaned samples before marking as failed
        console.log(`🧹 Cleaning up orphaned samples for failed streaming file ${fileId}`)
        
        const { data: orphanedSamples, error: countError } = await supabaseAdmin
          .from('imu_samples')
          .select('id')
          .eq('imu_file_id', fileId)
          .limit(1) // Just check if any exist
        
        if (countError) {
          console.error('Failed to check for orphaned samples:', countError)
        } else if (orphanedSamples && orphanedSamples.length > 0) {
          console.log(`🗑️ Found orphaned samples for streaming file ${fileId}, cleaning up...`)
          
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
          console.log(`✅ No orphaned samples found for streaming file ${fileId}`)
        }
        
        // Now update the file status to failed
        const { error: updateError } = await supabaseAdmin
          .from('imu_data_files')
          .update({
            status: 'failed',
            streaming_mode: false,
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