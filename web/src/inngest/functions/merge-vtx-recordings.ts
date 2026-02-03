import { inngest } from '@/inngest/client'
import { createClient } from '@supabase/supabase-js'
import { VTXMerger, VTXDecoder } from '@vertex-pkg/vtx-parser'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Merge VTX recordings into a single file
 *
 * Triggered by: recordings/vtx.merge-requested event
 *
 * Steps:
 * 1. Fetch recordings
 * 2. Download, validate, merge files (atomic step)
 * 3. Create new recording DB entry
 * 4. Delete original recordings
 */
export const mergeVTXRecordings = inngest.createFunction(
  {
    id: 'merge-vtx-recordings',
    retries: 3,
    concurrency: {
      limit: 5 // Limit concurrent merges
    }
  },
  { event: 'recordings/vtx.merge-requested' },
  async ({ event, step }) => {
    const { recordingIds, newFilename, userId } = event.data

    try {
      // Step 1: Fetch recordings to merge
      const recordingsData = await step.run('fetch-recordings', async () => {
        const { data: recordings, error } = await supabase
          .from('recordings')
          .select('*')
          .in('id', recordingIds)
          .eq('user_id', userId)
          .eq('file_type', 'vtx')
          .eq('status', 'ready')

        if (error || !recordings || recordings.length === 0) {
          throw new Error('Failed to fetch recordings or access denied')
        }

        if (recordings.length !== recordingIds.length) {
          throw new Error('Some recordings not found or not accessible')
        }

        // Sort by start time
        recordings.sort((a, b) => a.start_time.localeCompare(b.start_time))

        return recordings
      })

      // Step 2: Download, merge, and upload (all in one step to avoid size limits)
      const mergedPath = `${userId}/recordings/${newFilename}`

      const mergeResult = await step.run('download-merge-upload', async () => {
        // Download all files in parallel
        const downloads = await Promise.all(
          recordingsData.map(async (rec) => {
            const { data, error } = await supabase.storage
              .from('recordings')
              .download(rec.storage_path)

            if (error || !data) {
              throw new Error(`Failed to download ${rec.filename}: ${error?.message}`)
            }

            return await data.arrayBuffer()
          })
        )

        // Merge VTX files
        const result = VTXMerger.merge(downloads)

        // Upload merged file
        const blob = new Blob([result.buffer], { type: 'application/octet-stream' })

        const { error: uploadError } = await supabase.storage
          .from('recordings')
          .upload(mergedPath, blob, {
            contentType: 'application/octet-stream',
            upsert: true
          })

        if (uploadError) {
          throw new Error(`Failed to upload merged file: ${uploadError.message}`)
        }

        // Parse merged file to get metadata
        const decoder = new VTXDecoder(result.buffer)
        const header = decoder.getHeader()
        const recordCount = Number(header.recordCount)

        const firstRecord = decoder.readRecord(0)
        const lastRecord = decoder.readRecord(recordCount - 1)

        // Calculate duration
        const startTime = new Date(firstRecord.timestamp)
        const endTime = new Date(lastRecord.timestamp)
        const durationMs = endTime.getTime() - startTime.getTime()

        // Merge device_info (should all match due to validation)
        const mergedDeviceInfo = recordingsData[0].device_info || {}

        return {
          bufferSize: result.buffer.byteLength,
          stats: result.stats,
          header,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          durationMs,
          sampleRate: header.sampleRate,
          sampleCount: recordCount,
          recordFormat: header.recordFormat,
          deviceInfo: mergedDeviceInfo
        }
      })

      // Step 3: Create new recording DB entry
      const newRecording = await step.run('create-recording-entry', async () => {
        const { data, error } = await supabase
          .from('recordings')
          .insert({
            user_id: userId,
            filename: newFilename,
            file_type: 'vtx',
            storage_path: mergedPath,
            file_size_bytes: mergeResult.bufferSize,
            start_time: mergeResult.startTime,
            end_time: mergeResult.endTime,
            duration_ms: mergeResult.durationMs,
            sample_rate: mergeResult.sampleRate,
            sample_count: mergeResult.sampleCount,
            record_format: mergeResult.recordFormat,
            device_info: mergeResult.deviceInfo,
            status: 'ready',
            uploaded_at: new Date().toISOString(),
            processed_at: new Date().toISOString()
          })
          .select('id')
          .single()

        if (error || !data) {
          throw new Error(`Failed to create recording entry: ${error?.message}`)
        }

        return data
      })

      // Step 4: Delete original recordings (DB + storage)
      await step.run('delete-originals', async () => {
        // Delete from storage
        const storagePaths = recordingsData.map(r => r.storage_path)

        const { error: storageError } = await supabase.storage
          .from('recordings')
          .remove(storagePaths)

        if (storageError) {
          console.warn('Failed to delete some original files from storage:', storageError)
          // Continue - non-critical
        }

        // Delete from database
        const { error: deleteError } = await supabase
          .from('recordings')
          .delete()
          .in('id', recordingIds)

        if (deleteError) {
          console.error('Failed to delete original recordings from database:', deleteError)
          // Don't throw - merged file already created successfully
        }
      })

      console.log(`[VTX Merge] Successfully merged ${recordingIds.length} files into ${newFilename}`)

      return {
        success: true,
        newRecordingId: newRecording.id,
        filename: newFilename,
        stats: {
          inputFiles: mergeResult.stats.inputFiles,
          totalInputRecords: mergeResult.stats.totalInputRecords,
          outputRecords: mergeResult.stats.outputRecords,
          deduplicatedRecords: mergeResult.stats.deduplicatedRecords,
          mergedSizeBytes: mergeResult.bufferSize
        }
      }

    } catch (error) {
      console.error('[VTX Merge] Failed:', error)
      throw error
    }
  }
)
