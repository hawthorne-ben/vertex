import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Bike, Clock, MapPin, TrendingUp, Zap, Heart, Activity } from 'lucide-react'
import { AddVtxDataButton } from '@/components/add-vtx-data-button'
import { RideVisualizationsClient } from '@/components/ride-visualizations-client'
import { formatDurationFromSeconds } from '@/lib/utils/format-duration'

export default async function RideDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  // Fetch the ride with its associated recordings
  const { data: ride, error: rideError } = await supabase
    .from('rides')
    .select(`
      *,
      ride_recordings (
        recording_id,
        recordings (
          id,
          filename,
          file_type,
          file_size_bytes,
          start_time,
          end_time,
          duration_ms,
          sample_count,
          status,
          uploaded_at,
          device_info,
          session_metadata,
          analysis_results
        )
      )
    `)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (rideError || !ride) {
    notFound()
  }

  // Extract FIT and VTX recordings
  const fitRecording = ride.ride_recordings?.find(
    (rr: any) => rr.recordings?.file_type === 'fit'
  )?.recordings

  const vtxRecordings = ride.ride_recordings
    ?.filter((rr: any) => rr.recordings?.file_type === 'vtx')
    .map((rr: any) => rr.recordings) || []

  // Fetch IMU samples for each VTX recording (server-side)
  const vtxRecordingsWithSamples = await Promise.all(
    vtxRecordings.map(async (vtx: any) => {
      if (vtx.status !== 'ready') {
        return { ...vtx, samples: null, originalCount: 0 }
      }

      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          return { ...vtx, samples: null, originalCount: 0 }
        }

        const headersList = await headers()
        const host = headersList.get('host') || 'localhost:3000'
        const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
        const apiUrl = `${protocol}://${host}`

        const samplesUrl = `${apiUrl}/api/recordings/${vtx.id}/samples?resolution=1000&downsample=lttb`

        const response = await fetch(samplesUrl, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          },
          cache: 'no-store'
        })

        if (!response.ok) {
          console.error(`Failed to fetch samples for ${vtx.id}:`, response.statusText)
          return { ...vtx, samples: null, originalCount: 0 }
        }

        const result = await response.json()

        if (!result.samples || result.samples.length === 0) {
          return { ...vtx, samples: [], originalCount: result.metadata?.total_samples || 0 }
        }

        // Transform samples to match IMUUPlotCharts expected format
        const samples = result.samples.map((s: any) => ({
          timestamp: new Date(s.timestamp).toISOString(),
          accel_x: s.accel.x,
          accel_y: s.accel.y,
          accel_z: s.accel.z,
          gyro_x: s.gyro.x,
          gyro_y: s.gyro.y,
          gyro_z: s.gyro.z,
          mag_x: s.mag?.x ?? null,
          mag_y: s.mag?.y ?? null,
          mag_z: s.mag?.z ?? null,
          roll: s.euler?.roll ?? null,
          pitch: s.euler?.pitch ?? null,
          yaw: s.euler?.yaw ?? null
        }))

        return {
          ...vtx,
          samples,
          originalCount: result.metadata?.total_samples || samples.length
        }
      } catch (error) {
        console.error(`Error fetching samples for ${vtx.id}:`, error)
        return { ...vtx, samples: null, originalCount: 0 }
      }
    })
  )

  const analysis = fitRecording?.analysis_results || {}

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatDuration = formatDurationFromSeconds

  const formatDistance = (meters: number | null) => {
    if (!meters) return 'N/A'
    const miles = meters * 0.000621371
    return `${miles.toFixed(2)} mi`
  }

  const formatElevation = (meters: number | null) => {
    if (!meters) return 'N/A'
    const feet = meters * 3.28084
    return `${feet.toFixed(0)} ft`
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="container mx-auto p-4 md:p-6">
      {/* Ride Header */}
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold mb-2 text-primary">{ride.name}</h1>
        <div className="flex flex-wrap gap-2 md:gap-4 text-sm md:text-base text-secondary">
          <span>{formatDate(ride.start_time)}</span>
          {ride.bike_type && (
            <>
              <span className="hidden sm:inline">•</span>
              <span>{ride.bike_type}</span>
            </>
          )}
          {ride.conditions && (
            <>
              <span className="hidden sm:inline">•</span>
              <span>{ride.conditions}</span>
            </>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 md:gap-4 mb-8">
        <Card>
          <CardContent className="pt-4 md:pt-6">
            <div className="text-xs md:text-sm text-secondary mb-1">Distance</div>
            <div className="text-xl md:text-2xl font-bold text-primary">{formatDistance(ride.distance_meters)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 md:pt-6">
            <div className="text-xs md:text-sm text-secondary mb-1">Duration</div>
            <div className="text-xl md:text-2xl font-bold text-primary">{formatDuration(ride.duration_seconds)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 md:pt-6">
            <div className="text-xs md:text-sm text-secondary mb-1">Elevation</div>
            <div className="text-xl md:text-2xl font-bold text-primary">{formatElevation(ride.elevation_gain_meters)}</div>
          </CardContent>
        </Card>
        {analysis.avg_speed_mph && (
          <Card>
            <CardContent className="pt-4 md:pt-6">
              <div className="text-xs md:text-sm text-secondary mb-1">Avg Speed</div>
              <div className="text-xl md:text-2xl font-bold text-primary">{analysis.avg_speed_mph.toFixed(1)} mph</div>
            </CardContent>
          </Card>
        )}
        {analysis.max_speed_mph && (
          <Card>
            <CardContent className="pt-4 md:pt-6">
              <div className="text-xs md:text-sm text-secondary mb-1">Max Speed</div>
              <div className="text-xl md:text-2xl font-bold text-primary">{analysis.max_speed_mph.toFixed(1)} mph</div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Time-Synced Visualizations (Map, IMU Charts, FIT Charts) */}
      <RideVisualizationsClient
        rideId={id}
        rideStartTime={ride.start_time}
        rideEndTime={ride.end_time}
        fitRecordingId={fitRecording?.id || null}
        hasGpsData={analysis.has_gps_data || false}
        vtxRecordings={vtxRecordingsWithSamples}
      />

      {/* Add VTX Data Button (if no recordings yet) */}
      {vtxRecordingsWithSamples.length === 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Vertex IMU Data</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">No IMU data associated with this ride yet.</p>
            <AddVtxDataButton rideId={id} />
          </CardContent>
        </Card>
      )}

      {/* Add More VTX Data Button (if recordings exist) */}
      {vtxRecordingsWithSamples.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Add More IMU Data</CardTitle>
          </CardHeader>
          <CardContent>
            <AddVtxDataButton rideId={id} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
