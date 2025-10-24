import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { IMUUPlotCharts } from '@/components/imu-uplot-charts'
import { DataDetailHeader } from '@/components/data-detail-header'
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
      const stride = Math.ceil((totalCount || 1) / TARGET_SAMPLES)
      
      // PostgREST has a hard 1000-row limit per RPC call
      // We need to fetch in batches of 1000 and combine them
      const BATCH_SIZE = 1000
      const numBatches = Math.ceil(TARGET_SAMPLES / BATCH_SIZE)
      
      for (let batch = 0; batch < numBatches; batch++) {
        const batchStart = batch * BATCH_SIZE
        const batchLimit = Math.min(BATCH_SIZE, TARGET_SAMPLES - batchStart)
        
        // Calculate offset in terms of actual rows (stride * batchStart)
        const { data, error } = await supabase
          .rpc('sample_imu_data', {
            p_file_id: id,
            p_stride: stride,
            p_limit: TARGET_SAMPLES // Still pass full limit to function
          })
          .range(batchStart, batchStart + batchLimit - 1) // Fetch this batch's slice
        
        if (error || !data) break
        
        // Map sample_timestamp back to timestamp for consistency
        const mappedData = data.map((row: any) => ({
          ...row,
          timestamp: row.sample_timestamp
        }))
        
        samplesData.push(...mappedData)
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
      {fileData.start_time && fileData.end_time ? (
        <DataDetailHeader
          startTime={fileData.start_time}
          endTime={fileData.end_time}
          sampleCount={fileData.sample_count}
          sampleRate={fileData.sample_rate}
          status={fileData.status}
          filename={fileData.filename}
        />
      ) : (
        <div className="mb-8">
          <h1 className="text-3xl font-normal text-primary mb-2">
            IMU Data Segment
          </h1>
        </div>
      )}

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

