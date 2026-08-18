import Link from 'next/link'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { resolveRideDuration } from '@/lib/utils/formatting'
import { DashboardMetrics } from '@/components/dashboard-metrics'
import { LatestRideHero } from '@/components/latest-ride-hero'
import { computeHeroInsights } from '@/lib/dashboard/hero-insights'

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  // Fetch rides data, joining each ride's FIT recording analysis_results so we
  // can surface computed riding (moving) time alongside elapsed duration.
  const { data: ridesRaw, error: ridesError } = await supabase
    .from('rides')
    .select(`
      *,
      ride_recordings (
        recordings ( file_type, analysis_results )
      )
    `)
    .eq('user_id', user.id)
    .order('start_time', { ascending: false })

  // Flatten: attach riding_time_seconds from the FIT recording onto each ride.
  const rides = ridesRaw?.map((ride: any) => {
    const fit = ride.ride_recordings?.find(
      (rr: any) => rr.recordings?.file_type === 'fit'
    )?.recordings
    return {
      ...ride,
      riding_time_seconds: fit?.analysis_results?.riding_time_seconds ?? null,
    }
  })

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

  const recordings = allRecordings?.filter(r => r.file_type === 'vtx') || []

  // Calculate statistics
  const totalRides = rides?.length || 0

  const totalSeconds = rides?.reduce((sum, ride) => sum + (ride.duration_seconds || 0), 0) || 0
  const totalHours = (totalSeconds / 3600).toFixed(1)

  const totalBytes = allRecordings?.reduce((sum, rec) => sum + (rec.file_size_bytes || 0), 0) || 0
  const storageGB = (totalBytes / (1024 * 1024 * 1024)).toFixed(2)

  const totalRecordingMs = recordings?.reduce((sum, rec) => sum + (rec.duration_ms || 0), 0) || 0
  const totalRecordingHours = (totalRecordingMs / (1000 * 60 * 60)).toFixed(1)

  // Latest ride + its analysis summary for the hero
  const latestRide = rides?.[0] ?? null
  let latestSummary = null
  let heroInsights = { summary: null as string | null, streak: null as string | null }
  if (latestRide) {
    const { data: summary } = await supabase
      .from('ride_summaries')
      .select('avg_stability_percent, standing_percent, avg_roughness, avg_power_watts')
      .eq('ride_id', latestRide.id)
      .maybeSingle()
    latestSummary = summary

    // Recent stability/roughness history for the hero's human summary + streak.
    // Ordered ascending so the last row is the latest ride.
    const { data: history } = await supabase
      .from('ride_summaries')
      .select('ride_started_at, avg_stability_percent, avg_roughness')
      .eq('user_id', user.id)
      .not('avg_stability_percent', 'is', null)
      .order('ride_started_at', { ascending: true })
      .limit(30)

    // The latest ride may lack IMU analysis (e.g. FIT-only, no sensor). In that
    // case the stability history describes an OLDER ride, so pass the latest
    // ride's FIT facts to fall back to a sensor-free summary sentence.
    heroInsights = computeHeroInsights(history ?? [], {
      distance_meters: latestRide.distance_meters ?? null,
      elevation_gain_meters: latestRide.elevation_gain_meters ?? null,
      duration_seconds: latestRide.duration_seconds ?? null,
      riding_time_seconds: latestRide.riding_time_seconds ?? null,
      hasImuData: latestSummary?.avg_stability_percent != null,
    })
  }

  // Recent rides (up to 5) for the secondary list
  const recentRides = rides?.slice(0, 5) || []

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    })
  }

  const formatDistance = (meters: number) => {
    const miles = (meters / 1609.34).toFixed(1)
    return `${miles} mi`
  }

  return (
    <div className="container mx-auto p-4 md:p-6">
      <h1 className="text-2xl md:text-3xl font-serif font-normal mb-6 md:mb-8">Dashboard</h1>

      {totalRides === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-secondary">
            <p className="mb-2 text-lg text-primary font-serif">No rides yet</p>
            <p>
              Upload a FIT file or VTX recording to see your riding dynamics.{' '}
              <Link href="/upload" className="text-primary underline underline-offset-2">
                Upload data
              </Link>
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Latest ride hero — the primary entry point */}
          {latestRide && (
            <LatestRideHero
              ride={latestRide}
              summary={latestSummary}
              insights={heroInsights}
            />
          )}

          {/* Riding KPIs + switchable trend chart */}
          <div className="mb-8">
            <Suspense>
              <DashboardMetrics />
            </Suspense>
          </div>

          {/* Recent rides — secondary list */}
          <Card className="mb-8">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-xl font-serif">Recent Rides</CardTitle>
              <Link href="/rides" className="text-sm text-secondary hover:text-primary transition-colors">
                View all
              </Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {recentRides.map((ride) => (
                  <Link
                    key={ride.id}
                    href={`/rides/${ride.id}`}
                    className="card-interactive flex items-center justify-between gap-4 p-3 rounded-md"
                  >
                    <div className="min-w-0">
                      <h3 className="font-medium text-base text-primary truncate">
                        {ride.name || 'Unnamed Ride'}
                      </h3>
                      <span className="text-sm text-secondary">{formatDate(ride.start_time)}</span>
                    </div>
                    <div className="flex gap-6 text-sm flex-shrink-0">
                      {ride.distance_meters != null && (
                        <div className="text-right">
                          <div className="text-secondary text-xs">Distance</div>
                          <div className="font-medium text-primary">{formatDistance(ride.distance_meters)}</div>
                        </div>
                      )}
                      {(() => {
                        const d = resolveRideDuration(ride.duration_seconds, ride.riding_time_seconds)
                        return (
                          <div className="text-right">
                            <div className="text-secondary text-xs">{d.label}</div>
                            <div className="font-medium text-primary">{d.primary}</div>
                          </div>
                        )
                      })()}
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Account / storage metadata — demoted to a footer strip */}
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm text-secondary border-t border-border pt-4">
            <span><span className="text-primary font-medium">{totalRides}</span> rides</span>
            <span><span className="text-primary font-medium">{totalHours}h</span> ridden</span>
            <span><span className="text-primary font-medium">{totalRecordingHours}h</span> recorded</span>
            <span><span className="text-primary font-medium">{storageGB} GB</span> stored</span>
          </div>
        </>
      )}
    </div>
  )
}
