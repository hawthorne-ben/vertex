import Link from 'next/link'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { formatDurationFromTimestamps as formatDurationFromTimestampsUtil, formatDurationFromSeconds } from '@/lib/utils/formatting'
import { EfficiencyTrendChart } from '@/components/efficiency-trend-chart'

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  // Fetch rides data
  const { data: rides, error: ridesError } = await supabase
    .from('rides')
    .select('*')
    .eq('user_id', user.id)
    .order('start_time', { ascending: false })

  if (ridesError) {
    console.error('Error fetching rides:', ridesError)
  }

  // Fetch all recordings (for storage stats)
  const { data: allRecordings, error: recordingsError } = await supabase
    .from('recordings')
    .select('*')
    .eq('user_id', user.id)
    .order('start_time', { ascending: false })

  if (recordingsError) {
    console.error('Error fetching recordings:', recordingsError)
  }

  // Split by type for display
  const recordings = allRecordings?.filter(r => r.file_type === 'vtx') || []

  // Calculate statistics
  const totalRides = rides?.length || 0

  // Total hours from rides (duration_seconds in rides table)
  const totalSeconds = rides?.reduce((sum, ride) => sum + (ride.duration_seconds || 0), 0) || 0
  const totalHours = (totalSeconds / 3600).toFixed(1)

  // Total storage used (sum of all recordings file sizes — FIT + VTX)
  const totalBytes = allRecordings?.reduce((sum, rec) => sum + (rec.file_size_bytes || 0), 0) || 0
  const storageGB = (totalBytes / (1024 * 1024 * 1024)).toFixed(2)

  // Total recordings length (duration in hours, duration_ms in recordings table)
  const totalRecordingMs = recordings?.reduce((sum, rec) => sum + (rec.duration_ms || 0), 0) || 0
  const totalRecordingHours = (totalRecordingMs / (1000 * 60 * 60)).toFixed(1)

  // Recent rides (up to 3)
  const recentRides = rides?.slice(0, 3) || []

  // Recent recordings (up to 3)
  const recentRecordings = recordings?.slice(0, 3) || []

  // Helper functions
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    })
  }

  const formatDurationFromTimestamps = formatDurationFromTimestampsUtil
  const formatDurationSeconds = formatDurationFromSeconds

  const formatDistance = (meters: number) => {
    const miles = (meters / 1609.34).toFixed(1)
    return `${miles} mi`
  }

  return (
    <div className="container mx-auto p-4 md:p-6">
      <h1 className="text-2xl md:text-3xl font-serif font-normal mb-6 md:mb-8">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-6 md:mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-secondary">Total Rides</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{totalRides}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-secondary">Total Hours</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{totalHours}h</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-secondary">Total Recordings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{totalRecordingHours}h</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-secondary">Storage Used</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{storageGB} GB</div>
          </CardContent>
        </Card>
      </div>

      {/* Two Column Layout */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* Recent Rides - Left Column */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-serif">Recent Rides</CardTitle>
          </CardHeader>
          <CardContent>
            {recentRides.length === 0 ? (
              <div className="text-center py-8 text-secondary">
                <p>No rides yet. Upload a FIT file to get started!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentRides.map((ride) => (
                  <Link
                    key={ride.id}
                    href={`/rides/${ride.id}`}
                    className="card-interactive block p-3 rounded-md"
                  >
                    <div className="flex justify-between gap-4 mb-2">
                      <h3 className="font-medium text-base text-primary">
                        {ride.name || 'Unnamed Ride'}
                      </h3>
                      <span className="text-sm text-secondary flex-shrink-0">
                        {formatDate(ride.start_time)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      {ride.distance_meters && (
                        <div className="flex justify-between">
                          <span className="text-secondary">Distance</span>
                          <span className="font-medium text-primary">{formatDistance(ride.distance_meters)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-secondary">Duration</span>
                        <span className="font-medium text-primary">{formatDurationSeconds(ride.duration_seconds)}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Recordings - Right Column */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-serif">Recent Recordings</CardTitle>
          </CardHeader>
          <CardContent>
            {recentRecordings.length === 0 ? (
              <div className="text-center py-8 text-secondary">
                <p>No recordings yet. Upload VTX data to get started!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentRecordings.map((recording) => (
                  <Link
                    key={recording.id}
                    href={`/recordings/${recording.id}`}
                    className="card-interactive block p-3 rounded-md"
                  >
                    <div className="flex justify-between gap-4 mb-2">
                      <h3 className="font-medium text-base text-primary">
                        {recording.filename}
                      </h3>
                      <span className="text-sm text-secondary flex-shrink-0">
                        {formatDate(recording.start_time)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-secondary">Duration</span>
                        <span className="font-medium text-primary">{formatDurationFromTimestamps(recording.start_time, recording.end_time)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-secondary">Samples</span>
                        <span className="font-medium text-primary">{recording.sample_count?.toLocaleString() || 'N/A'}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Efficiency Trend */}
      <Suspense>
        <Card className="mb-6 md:mb-8">
          <CardHeader>
            <CardTitle className="text-xl font-serif">Pedaling Stability</CardTitle>
            <p className="text-sm text-muted-foreground">Last 8 weeks</p>
          </CardHeader>
          <CardContent>
            <EfficiencyTrendChart />
          </CardContent>
        </Card>
      </Suspense>
    </div>
  )
}
