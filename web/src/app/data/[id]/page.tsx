import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { IMUUPlotCharts } from '@/components/imu-uplot-charts'
import { DataDetailHeader } from '@/components/data-detail-header'
import { Loader2 } from 'lucide-react'

export default async function DataDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    redirect('/login')
  }

  // Fetch the recording metadata
  const { data: recording, error: recordingError } = await supabase
    .from('recordings')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (recordingError || !recording) {
    notFound()
  }

  // Only fetch samples if status is 'ready' and it's a VTX file
  let samples = null
  let originalSampleCount = 0
  let gaps = []

  if (recording.status === 'ready' && recording.file_type === 'vtx') {
    // Use VTX streaming API with built-in LTTB downsampling
    // The API handles:
    // 1. Direct VTX file parsing with O(1) timestamp seeking
    // 2. LTTB downsampling to 2000 points for optimal performance
    // 3. Gap information for visualization

    const {data: { session}} = await supabase.auth.getSession()

    if (!session) {
      redirect('/login')
    }

    const apiUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    const samplesUrl = `${apiUrl}/api/recordings/${id}/samples?resolution=2000&downsample=lttb`

    const response = await fetch(samplesUrl, {
      headers: {
        'Authorization': `Bearer ${session.access_token}`
      },
      cache: 'no-store'
    })

    if (response.ok) {
      const result = await response.json()
      originalSampleCount = result.metadata.total_samples
      gaps = result.gaps || []

      // Convert samples to match expected format (timestamp as ISO string)
      const samplesData = result.samples.map((s: any) => ({
        timestamp: new Date(s.timestamp).toISOString(),
        accel_x: s.accel.x,
        accel_y: s.accel.y,
        accel_z: s.accel.z,
        gyro_x: s.gyro.x,
        gyro_y: s.gyro.y,
        gyro_z: s.gyro.z,
        mag_x: s.mag?.x,
        mag_y: s.mag?.y,
        mag_z: s.mag?.z
      }))

      // API already applies LTTB downsampling, use samples directly
      samples = samplesData
    }
  }

  return (
    <div className="container mx-auto px-4 md:px-6 py-8 max-w-7xl">
      {/* Header */}
      {recording.start_time && recording.end_time ? (
        <DataDetailHeader
          startTime={recording.start_time}
          endTime={recording.end_time}
          sampleCount={recording.sample_count}
          sampleRate={recording.sample_rate}
          status={recording.status}
          filename={recording.filename}
        />
      ) : (
        <div className="mb-8">
          <h1 className="text-3xl font-normal text-primary mb-2">
            Recording Detail
          </h1>
        </div>
      )}

      {/* Status-based content */}
      {recording.status === 'ready' && samples ? (
        <IMUUPlotCharts fileId={id} initialSamples={samples} originalCount={originalSampleCount} />
      ) : recording.status === 'processing' ? (
        <div className="text-center py-12 border border-border rounded-lg bg-muted">
          <Loader2 className="w-8 h-8 text-info animate-spin mx-auto mb-4" />
          <p className="text-secondary">Processing data...</p>
        </div>
      ) : recording.status === 'failed' ? (
        <div className="text-center py-12 border border-error rounded-lg bg-error">
          <p className="text-error mb-2">Failed to process recording</p>
          {recording.error_message && (
            <p className="text-sm text-error/80">{recording.error_message}</p>
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

