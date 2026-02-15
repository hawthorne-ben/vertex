import { inngest } from '@/inngest/client'
import { createClient } from '@supabase/supabase-js'
import { calculatePedalingEfficiency } from '@/lib/analysis/pedaling-efficiency'
import { ALGORITHM_VERSION } from '@/lib/analysis/pedaling-efficiency-constants'
import { fileCache } from '@/lib/cache/file-cache'
import { VTXDecoder } from '@vertex-pkg/vtx-parser'
import FitParser from 'fit-file-parser'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Calculate pedaling efficiency AND riding position for a ride
 *
 * Triggered by: ride/vtx.merged event (after VTX files are merged)
 *
 * Computes both metrics in single pass to avoid duplicate pedaling detection logic.
 * All processing done in single step to avoid Inngest output size limits (512KB).
 * Similar pattern to VTX file merging - compute and store in one atomic operation.
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
      // Step 1: Check if analyses already exist and are up-to-date
      const existingAnalyses = await step.run('check-existing-analyses', async () => {
        const { data } = await supabase
          .from('ride_analysis')
          .select('*')
          .eq('ride_id', rideId)
          .in('analysis_type', ['pedaling_efficiency', 'riding_position'])

        return data || []
      })

      const efficiencyAnalysis = existingAnalyses.find(a => a.analysis_type === 'pedaling_efficiency')
      const positionAnalysis = existingAnalyses.find(a => a.analysis_type === 'riding_position')

      const bothUpToDate =
        efficiencyAnalysis?.status === 'completed' &&
        efficiencyAnalysis?.algorithm_version === ALGORITHM_VERSION &&
        positionAnalysis?.status === 'completed' &&
        positionAnalysis?.algorithm_version === ALGORITHM_VERSION

      if (bothUpToDate) {
        return {
          success: true,
          message: 'Analyses already up-to-date',
          rideId,
          efficiencyAnalysisId: efficiencyAnalysis.id,
          positionAnalysisId: positionAnalysis.id,
        }
      }

      // Step 2: Compute and store results (all in one step to avoid output size limits)
      const result = await step.run('compute-and-store-analyses', async () => {
        // Create or update both analysis records with 'processing' status
        const sharedParameters = {
          hpfCutoff: 0.5,
          windowSize: 3,
          yAxisThreshold: 1.5,
        }

        const { data: efficiencyAnalysis, error: efficiencyError } = await supabase
          .from('ride_analysis')
          .upsert(
            {
              ride_id: rideId,
              analysis_type: 'pedaling_efficiency',
              status: 'processing',
              started_at: new Date().toISOString(),
              algorithm_version: ALGORITHM_VERSION,
              parameters: sharedParameters,
              metadata: {},
            },
            { onConflict: 'ride_id,analysis_type' }
          )
          .select('id')
          .single()

        if (efficiencyError)
          throw new Error(`Failed to create efficiency analysis: ${efficiencyError.message}`)

        const { data: positionAnalysis, error: positionError } = await supabase
          .from('ride_analysis')
          .upsert(
            {
              ride_id: rideId,
              analysis_type: 'riding_position',
              status: 'processing',
              started_at: new Date().toISOString(),
              algorithm_version: ALGORITHM_VERSION,
              parameters: sharedParameters,
              metadata: {},
            },
            { onConflict: 'ride_id,analysis_type' }
          )
          .select('id')
          .single()

        if (positionError)
          throw new Error(`Failed to create position analysis: ${positionError.message}`)

        const efficiencyAnalysisId = efficiencyAnalysis.id
        const positionAnalysisId = positionAnalysis.id

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
            cadence: r.cadence ?? null,
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

        // Run pedaling efficiency AND riding position calculation (computed together in single pass)
        const computeResult = calculatePedalingEfficiency({
          vtxSamples,
          fitSamples,
          options: {
            hpfCutoff: 0.5,
            windowSize: 3,
            yAxisThreshold: 1.5,
            includeDebug: false, // Don't store debug stats
          },
        })

        // Store efficiency results in database
        const { error: efficiencyUpdateError } = await supabase
          .from('ride_analysis')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            samples: computeResult.efficiency.samples,
            metadata: computeResult.efficiency.metadata,
          })
          .eq('id', efficiencyAnalysisId)

        if (efficiencyUpdateError) {
          throw new Error(`Failed to store efficiency results: ${efficiencyUpdateError.message}`)
        }

        // Store position results in database
        const { error: positionUpdateError } = await supabase
          .from('ride_analysis')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            samples: computeResult.position.samples,
            metadata: computeResult.position.metadata,
          })
          .eq('id', positionAnalysisId)

        if (positionUpdateError) {
          throw new Error(`Failed to store position results: ${positionUpdateError.message}`)
        }

        // Return only small summary stats (not the full samples arrays)
        return {
          efficiencyAnalysisId,
          positionAnalysisId,
          efficiencySampleCount: computeResult.efficiency.samples.length,
          positionSampleCount: computeResult.position.samples.length,
          avgEfficiency: computeResult.efficiency.metadata.avgEfficiencyPercent,
          pedalingPercent: computeResult.efficiency.metadata.pedalingPercent,
          standingPercent: computeResult.position.metadata.standingPercent,
          seatedPercent: computeResult.position.metadata.seatedPercent,
        }
      })

      console.log(`[Ride Analysis] Completed efficiency and position for ride ${rideId}`, result)

      return {
        success: true,
        rideId,
        ...result,
      }
    } catch (error) {
      console.error(`[Ride Analysis] Failed for ride ${rideId}:`, error)

      // Update both analysis statuses to failed
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const now = new Date().toISOString()

      await supabase
        .from('ride_analysis')
        .update({
          status: 'failed',
          error_message: errorMessage,
          completed_at: now,
        })
        .eq('ride_id', rideId)
        .eq('analysis_type', 'pedaling_efficiency')

      await supabase
        .from('ride_analysis')
        .update({
          status: 'failed',
          error_message: errorMessage,
          completed_at: now,
        })
        .eq('ride_id', rideId)
        .eq('analysis_type', 'riding_position')

      throw error
    }
  }
)
