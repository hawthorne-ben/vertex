import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Bike, FileText, Clock, MapPin, TrendingUp, Zap } from 'lucide-react'
import Link from 'next/link'

interface Ride {
  id: string
  imu_file_id: string
  fit_file_id: string
  association_method: string
  association_confidence: number
  association_overlap_start: string
  association_overlap_end: string
  association_overlap_duration_minutes: number
  association_created_at: string
  imu_filename: string
  fit_filename: string
  total_distance_miles: number
  total_ascent_feet: number
  avg_speed_mph: number
  sample_count: number
}

export default async function RidesPage() {
  const supabase = await createClient()
  
  // Get current user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return <div>Please log in to view rides</div>
  }

  // Fetch rides (associated IMU and FIT files) - simplified query
  const { data: imuFiles, error: imuError } = await supabase
    .from('imu_data_files')
    .select('*')
    .eq('user_id', user.id)
    .not('associated_fit_file_id', 'is', null)
    .order('association_created_at', { ascending: false })

  if (imuError) {
    console.error('Failed to fetch IMU files:', imuError)
    return <div>Failed to load rides</div>
  }

  // Fetch corresponding FIT files
  const rides = []
  if (imuFiles && imuFiles.length > 0) {
    for (const imuFile of imuFiles) {
      const { data: fitFile, error: fitError } = await supabase
        .from('fit_files')
        .select('*')
        .eq('id', imuFile.associated_fit_file_id)
        .single()

      if (!fitError && fitFile) {
        rides.push({
          id: imuFile.id,
          imu_file_id: imuFile.id,
          fit_file_id: fitFile.id,
          association_method: imuFile.association_method,
          association_confidence: imuFile.association_confidence,
          association_overlap_start: imuFile.association_overlap_start,
          association_overlap_end: imuFile.association_overlap_end,
          association_overlap_duration_minutes: imuFile.association_overlap_duration_minutes,
          association_created_at: imuFile.association_created_at,
          imu_filename: imuFile.filename,
          fit_filename: fitFile.filename,
          total_distance_miles: fitFile.total_distance_miles,
          total_ascent_feet: fitFile.total_ascent_feet,
          avg_speed_mph: fitFile.avg_speed_mph,
          sample_count: imuFile.sample_count
        })
      }
    }
  }

  const getConfidenceBadgeColor = (confidence: number) => {
    if (confidence >= 0.8) return 'bg-green-100 text-green-800'
    if (confidence >= 0.6) return 'bg-yellow-100 text-yellow-800'
    if (confidence >= 0.4) return 'bg-orange-100 text-orange-800'
    return 'bg-red-100 text-red-800'
  }

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60)
    const mins = Math.floor(minutes % 60)
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Your Rides</h1>
          <p className="text-gray-600">
            Comprehensive ride analysis combining IMU sensor data with GPS tracking.
          </p>
        </div>

        {rides && rides.length > 0 ? (
          <div className="grid gap-6">
            {rides.map((ride) => (
              <Card key={ride.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center">
                        <Bike className="h-5 w-5 mr-2" />
                        {ride.fit_filename}
                      </CardTitle>
                      <CardDescription>
                        Created {formatDate(ride.association_created_at)}
                      </CardDescription>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getConfidenceBadgeColor(ride.association_confidence)}`}>
                      {(ride.association_confidence * 100).toFixed(0)}% confidence
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-2 gap-6">
                    {/* Ride Metrics */}
                    <div className="space-y-4">
                      <h3 className="font-semibold text-lg">Ride Metrics</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex items-center">
                          <MapPin className="h-4 w-4 mr-2 text-gray-500" />
                          <div>
                            <div className="text-sm text-gray-500">Distance</div>
                            <div className="font-semibold">{ride.total_distance_miles.toFixed(1)} mi</div>
                          </div>
                        </div>
                        <div className="flex items-center">
                          <TrendingUp className="h-4 w-4 mr-2 text-gray-500" />
                          <div>
                            <div className="text-sm text-gray-500">Elevation</div>
                            <div className="font-semibold">{ride.total_ascent_feet.toFixed(0)} ft</div>
                          </div>
                        </div>
                        <div className="flex items-center">
                          <Zap className="h-4 w-4 mr-2 text-gray-500" />
                          <div>
                            <div className="text-sm text-gray-500">Avg Speed</div>
                            <div className="font-semibold">{ride.avg_speed_mph.toFixed(1)} mph</div>
                          </div>
                        </div>
                        <div className="flex items-center">
                          <Clock className="h-4 w-4 mr-2 text-gray-500" />
                          <div>
                            <div className="text-sm text-gray-500">Duration</div>
                            <div className="font-semibold">{formatDuration(ride.association_overlap_duration_minutes)}</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Data Sources */}
                    <div className="space-y-4">
                      <h3 className="font-semibold text-lg">Data Sources</h3>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div className="flex items-center">
                            <FileText className="h-4 w-4 mr-2 text-blue-500" />
                            <div>
                              <div className="font-medium">{ride.imu_filename}</div>
                              <div className="text-sm text-gray-500">
                                {ride.sample_count.toLocaleString()} sensor samples
                              </div>
                            </div>
                          </div>
                          <span className="px-2 py-1 border border-gray-300 rounded-full text-xs font-medium text-gray-700">
                            IMU Data
                          </span>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div className="flex items-center">
                            <Bike className="h-4 w-4 mr-2 text-green-500" />
                            <div>
                              <div className="font-medium">{ride.fit_filename}</div>
                              <div className="text-sm text-gray-500">
                                GPS & ride metrics
                              </div>
                            </div>
                          </div>
                          <span className="px-2 py-1 border border-gray-300 rounded-full text-xs font-medium text-gray-700">
                            FIT Data
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex justify-end mt-6 space-x-3">
                    <Link href={`/data/${ride.imu_file_id}`}>
                      <Button variant="outline">
                        View IMU Data
                      </Button>
                    </Link>
                    <Link href={`/data/${ride.fit_file_id}`}>
                      <Button variant="outline">
                        View FIT Data
                      </Button>
                    </Link>
                    <Link href={`/rides/${ride.id}`}>
                      <Button>
                        Analyze Ride
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="text-center py-12">
              <Bike className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Rides Yet</h3>
              <p className="text-gray-600 mb-6">
                Create your first ride by combining IMU sensor data with FIT file data.
              </p>
              <Link href="/ride-builder">
                <Button>
                  Build Your First Ride
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}