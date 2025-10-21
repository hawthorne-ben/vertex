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
    name: 'Parse IMU CSV File'
  },
  { event: 'imu/parse' },
  async ({ event, step }) => {
    const { fileId, userId } = event.data
    const supabaseAdmin = getSupabaseAdmin()

    // Step 1: Get file metadata
    const file = await step.run('get-file-metadata', async () => {
      const { data, error } = await supabaseAdmin
        .from('imu_data_files')
        .select('*')
        .eq('id', fileId)
        .single()

      if (error) throw new Error(`Failed to get file: ${error.message}`)
      if (!data) throw new Error('File not found')
      
      return data
    })

    // Step 2: Update status to parsing
    await step.run('update-status-parsing', async () => {
      const { error } = await supabaseAdmin
        .from('imu_data_files')
        .update({ status: 'parsing' })
        .eq('id', fileId)

      if (error) throw new Error(`Failed to update status: ${error.message}`)
    })

    try {
      // Step 3: Download and parse CSV
      const parsedData = await step.run('download-and-parse-csv', async () => {
        // Download CSV from storage
        const { data: fileData, error: downloadError } = await supabaseAdmin.storage
          .from('uploads')
          .download(file.storage_path)

        if (downloadError) throw new Error(`Failed to download file: ${downloadError.message}`)
        if (!fileData) throw new Error('File data is empty')

        const csvText = await fileData.text()

        // Parse CSV
        try {
          const parsed = await parseIMUCSV(csvText)
          
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
          if (err instanceof IMUParseError) {
            throw err
          }
          throw new Error(`Parse error: ${err instanceof Error ? err.message : 'Unknown error'}`)
        }
      })

      // Step 4: Insert samples in batches
      await step.run('insert-samples', async () => {
        const { samples } = parsedData
        let insertedCount = 0

        for (let i = 0; i < samples.length; i += BATCH_SIZE) {
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

          const { error } = await supabaseAdmin
            .from('imu_samples')
            .insert(rows)

          if (error) {
            throw new Error(`Failed to insert batch ${i / BATCH_SIZE + 1}: ${error.message}`)
          }

          insertedCount += rows.length
        }

        return insertedCount
      })

      // Step 5: Update file metadata with success
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

      return {
        success: true,
        fileId,
        sampleCount: parsedData.sampleCount,
        duration: parsedData.duration,
        sampleRate: parsedData.sampleRate
      }

    } catch (err) {
      // Step 6: Update status to error
      await step.run('update-status-error', async () => {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        
        const { error: updateError } = await supabaseAdmin
          .from('imu_data_files')
          .update({
            status: 'error',
            error_message: errorMessage
          })
          .eq('id', fileId)

        if (updateError) {
          console.error('Failed to update error status:', updateError)
        }
      })

      throw err
    }
  }
)

