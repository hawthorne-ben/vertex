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
    // 1. For datasets ≤20k: Fetch all data in 1000-row pages (Supabase limit)
    // 2. For datasets >20k: Use systematic sampling (every Nth row) to fetch ~20k representative samples
    // 3. Apply LTTB downsampling to 2k points for display
    
    const { count: totalCount } = await supabase
      .from('imu_samples')
      .select('*', { count: 'exact', head: true })
      .eq('imu_file_id', id)
    
    const FETCH_LIMIT = 20000
    const PAGE_SIZE = 1000 // Supabase default page size
    
    let samplesData: any[] = []
    
    if (totalCount && totalCount <= FETCH_LIMIT) {
      // Small dataset: fetch all data in paginated batches
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
      // Large dataset: systematic sampling (fetch every Nth row)
      // This ensures we get samples evenly distributed across the full time range
      const stride = Math.ceil((totalCount || 1) / FETCH_LIMIT)
      const numSamplesToFetch = Math.floor((totalCount || 0) / stride)
      const numPages = Math.ceil(numSamplesToFetch / PAGE_SIZE)
      
      for (let page = 0; page < numPages; page++) {
        const pageStart = page * PAGE_SIZE * stride
        const pageEnd = Math.min(pageStart + PAGE_SIZE * stride, totalCount || 0)
        
        // Fetch samples at regular intervals (systematic sampling)
        for (let offset = pageStart; offset < pageEnd && samplesData.length < FETCH_LIMIT; offset += stride) {
          const { data, error } = await supabase
            .from('imu_samples')
            .select('timestamp, accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z, mag_x, mag_y, mag_z')
            .eq('imu_file_id', id)
            .order('timestamp', { ascending: true })
            .range(offset, offset)
            .single()
          
          if (error) continue
          if (data) samplesData.push(data)
        }
      }
    }

    if (samplesData.length > 0) {
      originalSampleCount = samplesData.length
      
      // Apply LTTB downsampling to 2000 points for optimal chart performance
      // LTTB preserves visual features (peaks, valleys, trends) better than naive sampling
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

