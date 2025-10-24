import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { IMUUPlotCharts } from '@/components/imu-uplot-charts'
import { downsampleMultiSeries } from '@/lib/imu/lttb-downsample'
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
  let originalSampleCount = 0
  if (fileData.status === 'ready') {
    // Scalable data fetching strategy:
    // 1. For small datasets (≤5k samples): Fetch all data
    // 2. For large datasets (>5k): Use SQL function to systematically sample every Nth row
    // 3. Apply LTTB downsampling to 2k points for optimal chart performance
    
    const { count: totalCount } = await supabase
      .from('imu_samples')
      .select('*', { count: 'exact', head: true })
      .eq('imu_file_id', id)
    
    const TARGET_SAMPLES = 5000 // Target samples to fetch before LTTB downsampling
    const PAGE_SIZE = 1000 // Supabase page size for small datasets
    
    let samplesData: any[] = []
    
    if (totalCount && totalCount <= TARGET_SAMPLES) {
      // Small dataset: fetch all data in one or more pages
      const numPages = Math.ceil(totalCount / PAGE_SIZE)
      
      for (let page = 0; page < numPages; page++) {
        const from = page * PAGE_SIZE
        const to = from + PAGE_SIZE - 1
        
        const { data, error } = await supabase
          .from('imu_samples')
          .select('timestamp, accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z, mag_x, mag_y, mag_z')
          .eq('imu_file_id', id)
          .order('timestamp', { ascending: true })
          .range(from, to)
        
        if (error) break
        if (data) samplesData.push(...data)
      }
    } else {
      // Large dataset: systematic sampling using SQL
      // Use row_number() to select every Nth row efficiently in a single query
      const stride = Math.ceil((totalCount || 1) / TARGET_SAMPLES)
      
      // Use RPC call with custom SQL for efficient sampling
      // This fetches every Nth row in a single query instead of N individual queries
      const { data, error } = await supabase
        .rpc('sample_imu_data', {
          p_file_id: id,
          p_stride: stride,
          p_limit: TARGET_SAMPLES
        })
      
      if (error) {
        console.warn('📊 SQL sampling function not available (run complete-schema.sql to enable), using fallback:', error.message || error)
        // Fallback: just fetch the first TARGET_SAMPLES rows
        const { data: fallbackData } = await supabase
          .from('imu_samples')
          .select('timestamp, accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z, mag_x, mag_y, mag_z')
          .eq('imu_file_id', id)
          .order('timestamp', { ascending: true })
          .limit(TARGET_SAMPLES)
        
        if (fallbackData) samplesData = fallbackData
      } else if (data) {
        // Map sample_timestamp back to timestamp for consistency
        samplesData = data.map((row: any) => ({
          ...row,
          timestamp: row.sample_timestamp
        }))
      }
    }

    if (samplesData.length > 0) {
      originalSampleCount = totalCount || samplesData.length
      
      // Apply LTTB downsampling to 2000 points for optimal chart performance
      const targetPoints = 2000
      samples = downsampleMultiSeries(samplesData, targetPoints)
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
          <p className="text-xs text-secondary mt-2">
            Source: {fileData.filename}
          </p>
        )}
      </div>

      {/* Status-based content */}
      {fileData.status === 'ready' && samples ? (
        <IMUUPlotCharts fileId={id} initialSamples={samples} originalCount={originalSampleCount} />
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

