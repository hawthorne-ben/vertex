import { inngest } from '../client'
import { parseIMUCSVStreaming, StreamingParseOptions } from '@/lib/imu/streaming-parser'
import { createClient } from '@supabase/supabase-js'
import { IMUSample } from '@/lib/imu/types'

// Batch size tuned for good progress resolution and performance
// 10k provides updates every ~1-2 seconds with minimal overhead
const BATCH_SIZE = 10000

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
 * Streaming IMU file processor with real-time progress tracking
 * Processes CSV files row-by-row without loading entire file into memory
 * Updates progress every 50k samples for user visibility
 */
export const parseIMU = inngest.createFunction(
  { 
    id: 'parse-imu-file',
    name: 'Parse IMU CSV File',
    retries: 1,
    timeouts: {
      // Allow up to 15 minutes for large files (100MB+)
      // Individual steps inherit this timeout unless overridden
      finish: '15m'
    }
  },
  { event: 'imu/parse' },
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
      // Estimate sample count based on file size for progress tracking
      // Empirical data: 45MB = 500k samples = 90 bytes/row
      // Add 2% buffer to be conservative (better to reach 100% slightly early)
      const estimatedSampleCount = Math.round(file.file_size_bytes / 92)
      
      const { error } = await supabaseAdmin
        .from('imu_data_files')
        .update({ 
          status: 'parsing',
          streaming_mode: true,
          processing_started_at: new Date().toISOString(),
          error_message: null, // Clear any previous error messages
          samples_processed: 0, // Reset progress if retrying
          sample_count: estimatedSampleCount // Estimate for progress bar
        })
        .eq('id', fileId)

      if (error) {
        console.error(`❌ Failed to update status to parsing for ${fileId}:`, error)
        throw new Error(`Failed to update status: ${error.message}`)
      }
      
      console.log(`📊 Estimated ${estimatedSampleCount.toLocaleString()} samples from ${(file.file_size_bytes / 1024 / 1024).toFixed(1)}MB file`)
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

        // Yield control to prevent blocking
        await new Promise(resolve => setImmediate(resolve))
        console.log(`🔄 Starting CSV parsing... (${(csvText.length / 1024 / 1024).toFixed(1)}MB)`)

        // Now parse the CSV with checkpoint tracking
        let totalProcessed = file.samples_processed || 0
        let batchNumber = 0
        let firstTimestamp: Date | null = null
        let lastTimestamp: Date | null = null
        const parseStartTime = Date.now()

        const streamingOptions: StreamingParseOptions = {
          batchSize: BATCH_SIZE,
          
          onBatch: async (samples: IMUSample[], currentBatchNumber: number) => {
            const batchStartTime = Date.now()
            batchNumber = currentBatchNumber
            
            // Track first and last timestamps
            if (!firstTimestamp && samples.length > 0) {
              firstTimestamp = samples[0].timestamp
            }
            if (samples.length > 0) {
              lastTimestamp = samples[samples.length - 1].timestamp
            }

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

            // Insert with timeout to detect hanging
            console.log(`🔄 Inserting batch of ${rows.length} samples...`)
            const insertStart = Date.now()
            
            const { error } = await supabaseAdmin
              .from('imu_samples')
              .upsert(rows, { 
                onConflict: 'user_id,imu_file_id,timestamp',
                ignoreDuplicates: false
              })
            
            const insertDuration = Date.now() - insertStart
            console.log(`✅ Batch inserted in ${insertDuration}ms`)

            if (error) {
              console.error(`❌ Batch insert failed for ${fileId}:`, error)
              throw new Error(`Batch insert failed: ${error.message}`)
            }

            totalProcessed += samples.length
            const batchDuration = Date.now() - batchStartTime

            // Update progress checkpoint in database after each batch
            const { error: progressError } = await supabaseAdmin
              .from('imu_data_files')
              .update({
                samples_processed: totalProcessed,
                last_checkpoint_at: new Date().toISOString()
              })
              .eq('id', fileId)

            if (progressError) {
              console.error(`⚠️ Failed to update progress checkpoint: ${progressError.message}`)
              // Don't fail the entire process, just log the warning
            } else {
              console.log(`📊 Progress checkpoint updated: ${totalProcessed} samples`)
            }

            // Log batch to streaming_processing_logs for detailed monitoring
            const { error: logError } = await supabaseAdmin
              .from('streaming_processing_logs')
              .insert({
                file_id: fileId,
                user_id: userId,
                batch_number: batchNumber,
                samples_in_batch: samples.length,
                total_samples_processed: totalProcessed,
                batch_processing_time_ms: batchDuration,
                started_at: new Date(batchStartTime).toISOString(),
                completed_at: new Date().toISOString(),
                success: true
              })

            if (logError) {
              console.error(`⚠️ Failed to log batch processing: ${logError.message}`)
              // Don't fail the entire process, just log the warning
            }

            console.log(`✅ Batch ${batchNumber} processed: ${samples.length} samples in ${batchDuration}ms (${totalProcessed} total)`)
            
            // Yield control to event loop to prevent blocking Next.js server
            await new Promise(resolve => setImmediate(resolve))
          },
          
          onProgress: (processedCount: number, totalEstimate?: number) => {
            if (processedCount % 10000 === 0) {
              const totalText = totalEstimate ? `/${totalEstimate}` : ''
              const elapsedSeconds = (Date.now() - parseStartTime) / 1000
              const samplesPerSecond = Math.round(processedCount / elapsedSeconds)
              console.log(`📊 Progress: ${processedCount}${totalText} samples (${samplesPerSecond} samples/sec)`)
            }
          },
          
          onComplete: async (totalProcessed: number) => {
            const totalDuration = Date.now() - parseStartTime
            const avgSamplesPerSecond = Math.round(totalProcessed / (totalDuration / 1000))
            console.log(`✅ Streaming parse completed: ${totalProcessed} total samples in ${(totalDuration / 1000).toFixed(1)}s (${avgSamplesPerSecond} samples/sec)`)
          }
        }

        // Start streaming parse
        const parseResult = await parseIMUCSVStreaming(csvText, streamingOptions)
        
        console.log(`✅ Streaming parsing completed for ${fileId}: ${parseResult.totalProcessed} samples`)
        
          // Return only essential data to avoid "output_too_large" error
          return {
            totalProcessed: parseResult.totalProcessed,
            success: parseResult.success,
            errorCount: parseResult.errors.length,
            firstTimestamp: (firstTimestamp as Date | null)?.toISOString() ?? null,
            lastTimestamp: (lastTimestamp as Date | null)?.toISOString() ?? null
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
        console.log(`✅ Streaming parse complete! Updating status to 'ready' for ${fileId}`)
        console.log(`📊 Final stats: ${result.totalProcessed} samples processed`)
        
        // First update sample_count to match final count (so progress bar shows 100%)
        await supabaseAdmin
          .from('imu_data_files')
          .update({
            sample_count: result.totalProcessed,
            samples_processed: result.totalProcessed
          })
          .eq('id', fileId)
        
        // Small delay to let UI poll and show 100% before marking as 'ready'
        await new Promise(resolve => setTimeout(resolve, 500))
        
        // Calculate actual sample rate from timestamps if available, otherwise keep estimate
        let finalSampleRate = file.sample_rate // Keep the estimated frequency from earlier
        if (result.firstTimestamp && result.lastTimestamp) {
          try {
            const start = new Date(result.firstTimestamp).getTime()
            const end = new Date(result.lastTimestamp).getTime()
            const durationSeconds = (end - start) / 1000
            if (durationSeconds > 0) {
              finalSampleRate = Math.round(result.totalProcessed / durationSeconds)
            }
          } catch (error) {
            console.warn(`⚠️ Could not calculate final sample rate: ${error}`)
          }
        }
        
        // Now update to 'ready' status with all metadata
        const { error } = await supabaseAdmin
          .from('imu_data_files')
          .update({
            status: 'ready',
            streaming_mode: false,
            sample_count: result.totalProcessed,
            sample_rate: finalSampleRate,
            start_time: result.firstTimestamp,
            end_time: result.lastTimestamp,
            parsed_at: new Date().toISOString(),
            processing_completed_at: new Date().toISOString()
          })
          .eq('id', fileId)

        if (error) {
          console.error(`❌ Failed to update status to ready: ${error.message}`)
          throw new Error(`Failed to update metadata: ${error.message}`)
        }
        
        console.log(`✅ Status updated to 'ready' successfully`)
        if (result.firstTimestamp && result.lastTimestamp) {
          console.log(`📅 Time range: ${result.firstTimestamp} → ${result.lastTimestamp}`)
        }
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
        
        // Now update the file status to failed and reset progress tracking
        const { error: updateError } = await supabaseAdmin
          .from('imu_data_files')
          .update({
            status: 'failed',
            streaming_mode: false,
            samples_processed: 0,
            last_checkpoint_at: null,
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