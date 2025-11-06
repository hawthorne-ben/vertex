import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Bike, Clock, MapPin, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { formatDurationFromSeconds } from '@/lib/utils/format-duration'

interface Ride {
  id: string
  name: string
  start_time: string
  end_time: string
  duration_seconds: number
  distance_meters: number | null
  elevation_gain_meters: number | null
  created_at: string
  fit_recording_id: string | null
  fit_filename: string | null
  analysis_results: any
}

export default async function RidesPage() {
  const supabase = await createClient()

  // Get current user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return <div>Please log in to view rides</div>
  }

  // Fetch all rides for the user with their associated FIT recordings
  const { data: rides, error: ridesError } = await supabase
    .from('rides')
    .select(`
      *,
      ride_recordings (
        recording_id,
        recordings (
          id,
          filename,
          file_type,
          analysis_results
        )
      )
    `)
    .eq('user_id', user.id)
    .order('start_time', { ascending: false })

  if (ridesError) {
    console.error('Failed to fetch rides:', ridesError)
    return <div>Failed to load rides</div>
  }

  // Transform the data to include FIT recording info
  const ridesWithRecordings = (rides || []).map(ride => {
    // Find the FIT recording (there should be exactly one per ride for now)
    const fitRecording = ride.ride_recordings?.find(
      (rr: any) => rr.recordings?.file_type === 'fit'
    )?.recordings

    return {
      ...ride,
      fit_recording_id: fitRecording?.id || null,
      fit_filename: fitRecording?.filename || null,
      analysis_results: fitRecording?.analysis_results || {}
    }
  })

  const formatDuration = formatDurationFromSeconds

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatDistance = (meters: number | null) => {
    if (!meters) return 'N/A'
    const miles = meters * 0.000621371
    return `${miles.toFixed(1)} mi`
  }

  const formatElevation = (meters: number | null) => {
    if (!meters) return 'N/A'
    const feet = meters * 3.28084
    return `${feet.toFixed(0)} ft`
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Your Rides</h1>
          <p className="text-gray-600">
            View and analyze your cycling activities from FIT files.
          </p>
        </div>

        {ridesWithRecordings && ridesWithRecordings.length > 0 ? (
          <div className="grid gap-6">
            {ridesWithRecordings.map((ride) => (
              <Link key={ride.id} href={`/rides/${ride.id}`}>
                <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center">
                          <Bike className="h-5 w-5 mr-2" />
                          {ride.name}
                        </CardTitle>
                        <CardDescription>
                          {formatDate(ride.start_time)}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {/* Ride Metrics */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      <div className="flex items-center">
                        <MapPin className="h-4 w-4 mr-2 text-gray-500" />
                        <div>
                          <div className="text-sm text-gray-500">Distance</div>
                          <div className="font-semibold">{formatDistance(ride.distance_meters)}</div>
                        </div>
                      </div>
                      <div className="flex items-center">
                        <TrendingUp className="h-4 w-4 mr-2 text-gray-500" />
                        <div>
                          <div className="text-sm text-gray-500">Elevation</div>
                          <div className="font-semibold">{formatElevation(ride.elevation_gain_meters)}</div>
                        </div>
                      </div>
                      <div className="flex items-center">
                        <Clock className="h-4 w-4 mr-2 text-gray-500" />
                        <div>
                          <div className="text-sm text-gray-500">Duration</div>
                          <div className="font-semibold">{formatDuration(ride.duration_seconds)}</div>
                        </div>
                      </div>
                      {ride.analysis_results?.avg_speed_mph && (
                        <div className="flex items-center">
                          <div>
                            <div className="text-sm text-gray-500">Avg Speed</div>
                            <div className="font-semibold">{ride.analysis_results.avg_speed_mph.toFixed(1)} mph</div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Source FIT file */}
                    {ride.fit_filename && (
                      <div className="text-xs text-gray-500">
                        Source: {ride.fit_filename}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="text-center py-12">
              <Bike className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Rides Yet</h3>
              <p className="text-gray-600 mb-6">
                Upload a FIT file to create your first ride.
              </p>
              <Link href="/upload">
                <Button>
                  Upload FIT File
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}