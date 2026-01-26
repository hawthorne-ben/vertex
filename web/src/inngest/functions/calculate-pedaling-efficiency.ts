import { inngest } from '@/inngest/client'
import { createClient } from '@supabase/supabase-js'
import { calculatePedalingEfficiency } from '@/lib/analysis/pedaling-efficiency'
import { fileCache } from '@/lib/cache/file-cache'
import { VTXDecoder } from '@vertex-pkg/vtx-parser'
import FitParser from 'fit-file-parser'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ALGORITHM_VERSION = '1.0.0' // Bump when algorithm changes to invalidate cache

/**
 * Calculate pedaling efficiency for a ride
 *
 * Triggered by: ride/vtx.merged event (after VTX files are merged)
 *
 * All processing done in single step to avoid Inngest output size limits (512KB)
 * Similar pattern to VTX file merging - compute and store in one atomic operation
 */
export const calculatePedalingEfficiencyJob = inngest.createFunction(
  {
    id: 'calculate-pedaling-efficiency',
    retries: 3,
    concurrency: {
      limit: 5, // Limit concurrent computations to avoid memory pressure
    },
  },
  { event: 'ride/vtx.merged' }, // Trigger after VTX merge completes
  async ({ event, step }) => {
    const { rideId } = event.data

    try {
      // Step 1: Check if analysis already exists and is up-to-date
      const existingAnalysis = await step.run('check-existing-analysis', async () => {
        const { data } = await supabase
          .from('ride_analysis')
          .select('*')
          .eq('ride_id', rideId)
          .eq('analysis_type', 'pedaling_efficiency')
          .maybeSingle()

        return data
      })

      if (
        existingAnalysis?.status === 'completed' &&
        existingAnalysis?.algorithm_version === ALGORITHM_VERSION
      ) {
        return {
          success: true,
          message: 'Analysis already up-to-date',
          rideId,
          analysisId: existingAnalysis.id,
        }
      }

      // Step 2: Compute and store results (all in one step to avoid output size limits)
      const result = await step.run('compute-and-store-pedaling-efficiency', async () => {
        // Create or update analysis record with 'processing' status
        const { data: analysis, error: analysisError } = await supabase
          .from('ride_analysis')
          .upsert(
            {
              ride_id: rideId,
              analysis_type: 'pedaling_efficiency',
              status: 'processing',
              started_at: new Date().toISOString(),
              algorithm_version: ALGORITHM_VERSION,
              parameters: {
                hpfCutoff: 0.5,
                windowSize: 3,
                fftWindowSize: 10,
                confidenceThreshold: 0.15,
                minCadence: 40,
                maxCadence: 130,
                useMagnitude: true,
              },
              metadata: {}, // Will be populated on completion
            },
            {
              onConflict: 'ride_id,analysis_type',
            }
          )
          .select('id')
          .single()

        if (analysisError)
          throw new Error(`Failed to create analysis record: ${analysisError.message}`)
        const analysisId = analysis.id

        // Fetch ride with recordings
        type RecordingData = {
          id: string
          file_type: string
          storage_path: string
          start_time: string
          end_time: string
        }

        type RideRecordingData = {
          recording_id: string
          recordings: RecordingData | null
        }

        type RideWithRecordings = {
          id: string
          merged_vtx_path: string | null
          ride_recordings: RideRecordingData[] | null
        }

        const { data: ride, error: rideError } = await supabase
          .from('rides')
          .select(`
            id,
            merged_vtx_path,
            ride_recordings (
              recording_id,
              recordings (
                id,
                file_type,
                storage_path,
                start_time,
                end_time
              )
            )
          `)
          .eq('id', rideId)
          .single() as { data: RideWithRecordings | null; error: any }

        if (rideError || !ride) {
          throw new Error(`Failed to fetch ride: ${rideError?.message || 'Not found'}`)
        }

        // Validate required recordings
        const fitRecording = ride.ride_recordings?.find(
          (rr) => rr.recordings?.file_type === 'fit'
        )?.recordings

        const vtxPath = ride.merged_vtx_path

        if (!fitRecording) {
          throw new Error('No FIT file associated with ride - required for grade data')
        }

        if (!vtxPath) {
          throw new Error(
            'No merged VTX file - VTX merge must complete before efficiency calculation'
          )
        }

        // Download FIT file (with caching)
        const fitBuffer = await fileCache.getOrFetch(fitRecording.storage_path, async () => {
          const { data, error } = await supabase.storage
            .from('recordings')
            .download(fitRecording.storage_path)

          if (error || !data) {
            throw new Error(`Failed to download FIT: ${error?.message}`)
          }

          return await data.arrayBuffer()
        })

        // Download VTX file (merged version, with caching)
        const vtxBuffer = await fileCache.getOrFetch(vtxPath, async () => {
          const { data, error } = await supabase.storage
            .from('recordings')
            .download(vtxPath)

          if (error || !data) {
            throw new Error(`Failed to download merged VTX: ${error?.message}`)
          }

          return await data.arrayBuffer()
        })

        // Parse FIT file
        const fitParser = new FitParser({ force: true })

        const fitData: any = await new Promise((resolve, reject) => {
          fitParser.parse(new Uint8Array(fitBuffer), (error: any, data: any) => {
            if (error) reject(error)
            else resolve(data)
          })
        })

        const fitSamples = fitData.records
          .map((r: any) => ({
            timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : null,
            grade: r.grade || null,
            altitude: r.enhanced_altitude ?? r.altitude ?? null,
          }))
          .filter((s: any) => s.timestamp)

        if (fitSamples.length === 0) {
          throw new Error('No valid FIT samples found')
        }

        // Parse VTX file
        const decoder = new VTXDecoder(vtxBuffer)
        const header = decoder.getHeader()
        const recordCount = Number(header.recordCount)

        const vtxSamples = []
        for (let i = 0; i < recordCount; i++) {
          const record = decoder.readRecord(i)
          vtxSamples.push({
            timestamp: new Date(record.timestamp).toISOString(),
            accel_x: record.accelX,
            accel_y: record.accelY,
            accel_z: record.accelZ,
          })
        }

        if (vtxSamples.length === 0) {
          throw new Error('No valid VTX samples found')
        }

        // Run pedaling efficiency calculation
        const computeResult = calculatePedalingEfficiency({
          vtxSamples,
          fitSamples,
          options: {
            hpfCutoff: 0.5,
            windowSize: 3,
            fftWindowSize: 10,
            confidenceThreshold: 0.15,
            minCadence: 40,
            maxCadence: 130,
            useMagnitude: true,
            includeDebug: false, // Don't store debug stats
          },
        })

        // Store results in database
        const { error: updateError } = await supabase
          .from('ride_analysis')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            samples: computeResult.samples,
            metadata: computeResult.metadata,
          })
          .eq('id', analysisId)

        if (updateError) {
          throw new Error(`Failed to store results: ${updateError.message}`)
        }

        // Return only small summary stats (not the full samples array)
        return {
          analysisId,
          sampleCount: computeResult.samples.length,
          avgEfficiency: computeResult.metadata.avgEfficiencyPercent,
          pedalingPercent: computeResult.metadata.pedalingPercent,
        }
      })

      console.log(`[Pedaling Efficiency] Completed for ride ${rideId}`, result)

      return {
        success: true,
        rideId,
        ...result,
      }
    } catch (error) {
      console.error(`[Pedaling Efficiency] Failed for ride ${rideId}:`, error)

      // Update analysis status to failed
      await supabase
        .from('ride_analysis')
        .update({
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
          completed_at: new Date().toISOString(),
        })
        .eq('ride_id', rideId)
        .eq('analysis_type', 'pedaling_efficiency')

      throw error
    }
  }
)
