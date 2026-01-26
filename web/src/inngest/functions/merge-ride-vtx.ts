import { inngest } from '@/inngest/client'
import { createClient } from '@supabase/supabase-js'
import { VTXMerger } from '@vertex-pkg/vtx-parser'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const mergeRideVTX = inngest.createFunction(
  { id: 'merge-ride-vtx', retries: 3 },
  { event: 'ride/vtx.associated' },
  async ({ event, step }) => {
    const { rideId } = event.data

    try {
      // Step 1: Fetch ride + all VTX recordings
      const rideData = await step.run('fetch-ride-and-recordings', async () => {
        const { data: ride, error } = await supabase
          .from('rides')
          .select(`
            *,
            ride_recordings!inner (
              recording_id,
              recordings!inner (
                id,
                storage_path,
                file_type,
                start_time,
                end_time,
                file_size_bytes
              )
            )
          `)
          .eq('id', rideId)
          .eq('ride_recordings.recordings.file_type', 'vtx')
          .eq('ride_recordings.recordings.status', 'ready')
          .single()

        if (error || !ride) {
          throw new Error(`Failed to fetch ride: ${error?.message || 'Ride not found'}`)
        }

        return ride
      })

      // Extract and sort VTX recordings by start time
      const vtxRecordings = rideData.ride_recordings
        .map((rr: any) => rr.recordings)
        .sort((a: any, b: any) => a.start_time.localeCompare(b.start_time))

      if (vtxRecordings.length === 0) {
        return { success: true, message: 'No VTX recordings to merge', rideId }
      }

      // Step 2: Handle single file case (no merge needed)
      if (vtxRecordings.length === 1) {
        const recording = await step.run('reference-single-file', async () => {
          const rec = vtxRecordings[0]

          await supabase
            .from('rides')
            .update({
              merged_vtx_path: rec.storage_path,
              merged_vtx_file_size_bytes: rec.file_size_bytes,
              merged_at: new Date().toISOString()
            })
            .eq('id', rideId)

          return rec
        })

        // Send event to trigger pedaling efficiency calculation
        await step.sendEvent('trigger-pedaling-efficiency', {
          name: 'ride/vtx.merged',
          data: {
            rideId,
            mergedPath: recording.storage_path,
            mergedSizeBytes: recording.file_size_bytes
          }
        })

        return {
          success: true,
          message: 'Single file - referenced directly without merge',
          rideId,
          fileCount: 1
        }
      }

      // Step 3: Download, validate, merge, and upload VTX files
      // All in one step to avoid Inngest's output size limit
      const mergedPath = `rides/${rideId}/merged.vtx`
      const mergeStats = await step.run('merge-and-upload-vtx-files', async () => {
        // Download all files in parallel
        const downloads = await Promise.all(
          vtxRecordings.map(async (rec: any) => {
            const { data, error } = await supabase.storage
              .from('recordings')
              .download(rec.storage_path)

            if (error || !data) {
              throw new Error(`Failed to download ${rec.storage_path}: ${error?.message}`)
            }

            return await data.arrayBuffer()
          })
        )

        // Validate merge compatibility
        const validation = VTXMerger.validateMergeCompatibility(downloads)

        if (!validation.compatible) {
          throw new Error(`VTX files are incompatible for merging: ${validation.errors.join(', ')}`)
        }

        // Log warnings if any
        if (validation.errors.length > 0) {
          console.warn('VTX merge warnings:', validation.errors)
        }

        // Merge VTX files
        const result = VTXMerger.merge(downloads)

        // Upload merged file immediately (don't return buffer)
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

        // Return only stats (small data)
        return {
          bufferSize: result.buffer.byteLength,
          stats: result.stats
        }
      })

      // Step 4: Update ride record
      await step.run('update-ride-record', async () => {
        const { error } = await supabase
          .from('rides')
          .update({
            merged_vtx_path: mergedPath,
            merged_vtx_file_size_bytes: mergeStats.bufferSize,
            merged_at: new Date().toISOString()
          })
          .eq('id', rideId)

        if (error) {
          throw new Error(`Failed to update ride record: ${error.message}`)
        }
      })

      // Send event to trigger pedaling efficiency calculation
      await step.sendEvent('trigger-pedaling-efficiency', {
        name: 'ride/vtx.merged',
        data: {
          rideId,
          mergedPath,
          mergedSizeBytes: mergeStats.bufferSize
        }
      })

      return {
        success: true,
        rideId,
        mergedPath,
        stats: {
          inputFiles: mergeStats.stats.inputFiles,
          totalInputRecords: mergeStats.stats.totalInputRecords,
          outputRecords: mergeStats.stats.outputRecords,
          deduplicatedRecords: mergeStats.stats.deduplicatedRecords,
          mergedSizeBytes: mergeStats.bufferSize,
          timeRange: mergeStats.stats.timeRange
        }
      }

    } catch (error) {
      console.error('VTX merge failed:', error)

      // Don't update ride status on error - leave merged_vtx_path as NULL
      // This allows retries and doesn't break existing functionality

      throw error
    }
  }
)
