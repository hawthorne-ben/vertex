import Link from 'next/link'
import { ArrowRight, Flame } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { describeStability, describeRoughness, resolveRideDuration } from '@/lib/utils/formatting'
import { RouteThumbnail } from '@/components/route-thumbnail'

export interface LatestRideHeroProps {
  ride: {
    id: string
    name: string | null
    start_time: string
    distance_meters: number | null
    duration_seconds: number | null
    riding_time_seconds?: number | null
    elevation_gain_meters: number | null
  }
  summary: {
    avg_stability_percent: number | null
    standing_percent: number | null
    avg_roughness: number | null
    avg_power_watts: number | null
  } | null
  insights?: {
    summary: string | null
    streak: string | null
  }
}

function formatDistance(meters: number | null): string {
  if (!meters) return '—'
  return `${(meters * 0.000621371).toFixed(1)} mi`
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

export function LatestRideHero({ ride, summary, insights }: LatestRideHeroProps) {
  const stability = summary?.avg_stability_percent ?? null
  const rideDuration = resolveRideDuration(ride.duration_seconds, ride.riding_time_seconds)

  return (
    <Link href={`/rides/${ride.id}`} className="block group mb-6 md:mb-8">
      <Card className="card-interactive">
        <CardContent className="p-5 md:p-6">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs uppercase tracking-wide text-secondary">
                  Latest ride
                </span>
                {insights?.streak && (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-500 bg-amber-500/10 rounded-full px-2 py-0.5">
                    <Flame className="w-3 h-3" />
                    {insights.streak}
                  </span>
                )}
              </div>
              <h2 className="text-xl md:text-2xl font-serif text-primary">
                {ride.name || 'Unnamed Ride'}
              </h2>
              <div className="text-sm text-secondary mt-0.5">
                {formatDate(ride.start_time)}
              </div>
            </div>
            <div className="flex items-start gap-4 flex-shrink-0">
              <RouteThumbnail
                rideId={ride.id}
                className="hidden sm:block opacity-80 group-hover:opacity-100 transition-opacity"
              />
              <ArrowRight className="w-5 h-5 text-secondary opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
            </div>
          </div>

          {insights?.summary && (
            <p className="text-sm md:text-base text-primary/90 mb-4 max-w-2xl">
              {insights.summary}
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <HeroStat label="Distance" value={formatDistance(ride.distance_meters)} />
            <HeroStat label={rideDuration.label} value={rideDuration.primary} sub={rideDuration.secondary ?? undefined} />
            <HeroStat
              label="Stability"
              value={stability != null ? `${stability.toFixed(0)}%` : '—'}
              sub={describeStability(stability)}
            />
            <HeroStat
              label="Road"
              value={describeRoughness(summary?.avg_roughness)}
            />
            {summary?.avg_power_watts != null && (
              <HeroStat label="Avg Power" value={`${summary.avg_power_watts.toFixed(0)} W`} />
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

function HeroStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-secondary mb-1">{label}</div>
      <div className="text-lg md:text-xl font-bold text-primary leading-tight">{value}</div>
      {sub && <div className="text-xs text-secondary mt-0.5">{sub}</div>}
    </div>
  )
}
