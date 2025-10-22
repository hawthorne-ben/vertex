import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { IMUDataCharts } from '@/components/imu-data-charts'
import { Loader2 } from 'lucide-react'

export default async function DataDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    redirect('/login')
  }

  // Fetch the data segment metadata
  const { data: fileData, error: fileError } = await supabase
    .from('imu_data_files')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fileError || !fileData) {
    notFound()
  }

  // Only fetch samples if status is 'ready'
  let samples = null
  if (fileData.status === 'ready') {
    // Fetch samples (limit to 10k for performance, sample if needed)
    const { data: samplesData, error: samplesError } = await supabase
      .from('imu_samples')
      .select('timestamp, accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z, mag_x, mag_y, mag_z')
      .eq('imu_file_id', id)
      .order('timestamp', { ascending: true })
      .limit(10000)

    if (!samplesError && samplesData) {
      // Sample every Nth point if we have too many
      const maxPoints = 2000
      if (samplesData.length > maxPoints) {
        const step = Math.ceil(samplesData.length / maxPoints)
        samples = samplesData.filter((_, i) => i % step === 0)
      } else {
        samples = samplesData
      }
    }
  }

  return (
    <div className="container mx-auto px-4 md:px-6 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-normal text-primary mb-2">
          {fileData.start_time && fileData.end_time ? (
            <>
              {new Date(fileData.start_time).toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
              })}
              {' → '}
              {new Date(fileData.end_time).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit'
              })}
            </>
          ) : (
            'IMU Data Segment'
          )}
        </h1>
        
        {/* Metadata */}
        <div className="flex items-center gap-6 text-sm text-secondary">
          {fileData.sample_count && (
            <span>{fileData.sample_count.toLocaleString()} samples</span>
          )}
          {fileData.sample_rate && (
            <span>{fileData.sample_rate} Hz</span>
          )}
          {fileData.start_time && fileData.end_time && (
            <span>
              {((new Date(fileData.end_time).getTime() - new Date(fileData.start_time).getTime()) / 1000).toFixed(1)}s
            </span>
          )}
          <span className={`
            px-2 py-1 rounded-full text-xs
            ${fileData.status === 'ready' ? 'status-badge-success' : ''}
            ${fileData.status === 'parsing' ? 'status-badge-info' : ''}
            ${fileData.status === 'error' ? 'status-badge-error' : ''}
            ${fileData.status === 'uploaded' ? 'bg-muted text-muted-foreground' : ''}
          `}>
            {fileData.status}
          </span>
        </div>

        {fileData.filename && (
          <p className="text-xs text-tertiary mt-2">
            Source: {fileData.filename}
          </p>
        )}
      </div>

      {/* Status-based content */}
      {fileData.status === 'ready' && samples ? (
        <IMUDataCharts samples={samples} />
      ) : fileData.status === 'parsing' ? (
        <div className="text-center py-12 border border-border rounded-lg bg-muted">
          <Loader2 className="w-8 h-8 text-info animate-spin mx-auto mb-4" />
          <p className="text-secondary">Processing data...</p>
        </div>
      ) : fileData.status === 'failed' ? (
        <div className="text-center py-12 border border-error rounded-lg bg-error">
          <p className="text-error mb-2">Failed to process data</p>
          {fileData.error_message && (
            <p className="text-sm text-error/80">{fileData.error_message}</p>
          )}
        </div>
      ) : (
        <div className="text-center py-12 border border-border rounded-lg bg-muted">
          <p className="text-secondary">Waiting for data to be processed...</p>
        </div>
      )}
    </div>
  )
}

