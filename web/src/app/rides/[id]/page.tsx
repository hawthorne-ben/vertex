import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Bike, Clock, MapPin, TrendingUp, Zap, Heart, Activity } from 'lucide-react'
import { AddVtxDataButton } from '@/components/add-vtx-data-button'
import { RideMapClient } from '@/components/ride-map-client'
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

      {/* GPS Map */}
      {fitRecording && analysis.has_gps_data && (
        <div className="mb-8">
          <RideMapClient
            rideId={id}
            fitRecordingId={fitRecording.id}
          />
        </div>
      )}

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

      {/* FIT File Metadata */}
      {fitRecording && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>FIT File Data</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              {/* Performance Metrics */}
              {(analysis.max_power_watts || analysis.max_heart_rate || analysis.max_cadence) && (
                <div>
                  <h3 className="font-semibold mb-3">Performance</h3>
                  <div className="space-y-3">
                    {analysis.max_power_watts && (
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-gray-500" />
                        <div className="flex-1">
                          <div className="text-sm text-gray-600">Power</div>
                          <div className="font-medium">
                            Avg: {analysis.avg_power_watts || 'N/A'}W • Max: {analysis.max_power_watts}W
                          </div>
                        </div>
                      </div>
                    )}
                    {analysis.max_heart_rate && (
                      <div className="flex items-center gap-2">
                        <Heart className="h-4 w-4 text-gray-500" />
                        <div className="flex-1">
                          <div className="text-sm text-gray-600">Heart Rate</div>
                          <div className="font-medium">
                            Avg: {analysis.avg_heart_rate || 'N/A'} bpm • Max: {analysis.max_heart_rate} bpm
                          </div>
                        </div>
                      </div>
                    )}
                    {analysis.max_cadence && (
                      <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-gray-500" />
                        <div className="flex-1">
                          <div className="text-sm text-gray-600">Cadence</div>
                          <div className="font-medium">
                            Avg: {analysis.avg_cadence || 'N/A'} rpm • Max: {analysis.max_cadence} rpm
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* GPS & File Info */}
              <div>
                <h3 className="font-semibold mb-3">Data Summary</h3>
                <div className="space-y-2 text-sm">
                  {analysis.has_gps_data && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">GPS Points</span>
                      <span className="font-medium">{analysis.gps_points_count?.toLocaleString() || 'Yes'}</span>
                    </div>
                  )}
                  {analysis.riding_time_seconds && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Riding Time</span>
                      <span className="font-medium">{formatDuration(analysis.riding_time_seconds)}</span>
                    </div>
                  )}
                  {analysis.stationary_time_seconds && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Stationary Time</span>
                      <span className="font-medium">{formatDuration(analysis.stationary_time_seconds)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-600">File</span>
                    <span className="font-medium text-xs">{fitRecording.filename}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">File Size</span>
                    <span className="font-medium">{formatFileSize(fitRecording.file_size_bytes)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Uploaded</span>
                    <span className="font-medium">{new Date(fitRecording.uploaded_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Device & Session Info (if available) */}
            {(fitRecording.device_info || fitRecording.session_metadata) && (
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h3 className="font-semibold mb-3">Additional Metadata</h3>
                <div className="grid md:grid-cols-2 gap-4 text-sm">
                  {fitRecording.device_info && (
                    <div>
                      <div className="text-gray-600 font-medium mb-2">Device Info</div>
                      <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto max-h-32">
                        {JSON.stringify(fitRecording.device_info, null, 2)}
                      </pre>
                    </div>
                  )}
                  {fitRecording.session_metadata && (
                    <div>
                      <div className="text-gray-600 font-medium mb-2">Session Metadata</div>
                      <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto max-h-32">
                        {JSON.stringify(fitRecording.session_metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* VTX Data Section */}
      <Card>
        <CardHeader>
          <CardTitle>Vertex IMU Data</CardTitle>
        </CardHeader>
        <CardContent>
          {vtxRecordings.length > 0 ? (
            <div className="space-y-3 mb-4">
              {vtxRecordings.map((vtx: any) => (
                <div key={vtx.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <div className="font-medium">{vtx.filename}</div>
                    <div className="text-sm text-gray-600">
                      {new Date(vtx.start_time).toLocaleString()} • {formatFileSize(vtx.file_size_bytes)}
                    </div>
                  </div>
                  <a
                    href={`/recordings/${vtx.id}`}
                    className="px-3 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50"
                  >
                    View
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-600 mb-4">No IMU data associated with this ride yet.</p>
          )}

          <AddVtxDataButton rideId={id} />
        </CardContent>
      </Card>
    </div>
  )
}
