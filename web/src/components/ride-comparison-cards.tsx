'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface ComparisonData {
  value: number
  average: number
}

interface RideComparisons {
  stability: ComparisonData | null
  standing: ComparisonData | null
  avgHr: ComparisonData | null
  avgPower: ComparisonData | null
  stable: ComparisonData | null
  unstable: ComparisonData | null
  cadenceStanding: ComparisonData | null
  cadenceSeated: ComparisonData | null
}

function ComparisonMetric({
  label,
  value,
  average,
  unit,
  precision,
  colored = false,
  invertColor = false,
}: {
  label: string
  value: number
  average: number
  unit: string
  precision: number
  colored?: boolean
  invertColor?: boolean
}) {
  const diff = value - average
  const isUp = diff > 0.05
  const isDown = diff < -0.05

  let trendColor = 'text-muted-foreground'
  if (colored) {
    if (invertColor) {
      trendColor = isUp ? 'text-red-400' : isDown ? 'text-emerald-500' : 'text-muted-foreground'
    } else {
      trendColor = isUp ? 'text-emerald-500' : isDown ? 'text-red-400' : 'text-muted-foreground'
    }
  }

  return (
    <Card>
      <CardContent className="pt-4 md:pt-6">
        <div className="text-xs md:text-sm text-secondary mb-1">{label}</div>
        <div className="text-xl md:text-2xl font-bold text-primary">
          {value.toFixed(precision)}{unit}
        </div>
        <div className={`flex items-center gap-1 mt-1.5 text-xs md:text-sm ${trendColor}`}>
          {isUp ? (
            <TrendingUp className="w-3.5 h-3.5 shrink-0" />
          ) : isDown ? (
            <TrendingDown className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <Minus className="w-3.5 h-3.5 shrink-0" />
          )}
          {isUp ? '+' : ''}{diff.toFixed(precision)} vs 8-wk avg ({average.toFixed(precision)}{unit})
        </div>
      </CardContent>
    </Card>
  )
}

export function RideComparisonCards({ rideId }: { rideId: string }) {
  const [data, setData] = useState<RideComparisons | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const supabase = createClient()

      // Fetch this ride's summary
      const { data: summary } = await supabase
        .from('ride_summaries')
        .select('avg_stability_percent, standing_percent, avg_heart_rate, avg_power_watts, stable_pedaling_percent, unstable_pedaling_percent, avg_cadence_standing, avg_cadence_seated, user_id')
        .eq('ride_id', rideId)
        .maybeSingle()

      if (!summary || cancelled) return

      // Fetch rolling averages from other rides in the last 8 weeks
      const { data: others } = await supabase
        .from('ride_summaries')
        .select('avg_stability_percent, standing_percent, avg_heart_rate, avg_power_watts, stable_pedaling_percent, unstable_pedaling_percent, avg_cadence_standing, avg_cadence_seated')
        .eq('user_id', summary.user_id)
        .gte('ride_started_at', new Date(Date.now() - 8 * 7 * 24 * 60 * 60 * 1000).toISOString())

      if (!others || others.length === 0 || cancelled) return

      const avg = (arr: (number | null)[]) => {
        const valid = arr.filter((v): v is number => v !== null)
        return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null
      }

      const avgStability = avg(others.map(r => r.avg_stability_percent))
      const avgStanding = avg(others.map(r => r.standing_percent))
      const avgHr = avg(others.map(r => r.avg_heart_rate))
      const avgPower = avg(others.map(r => r.avg_power_watts))
      const avgStable = avg(others.map(r => r.stable_pedaling_percent))
      const avgUnstable = avg(others.map(r => r.unstable_pedaling_percent))
      const avgCadenceStanding = avg(others.map(r => r.avg_cadence_standing))
      const avgCadenceSeated = avg(others.map(r => r.avg_cadence_seated))

      if (cancelled) return

      setData({
        stability: summary.avg_stability_percent != null && avgStability != null
          ? { value: summary.avg_stability_percent, average: avgStability } : null,
        standing: summary.standing_percent != null && avgStanding != null
          ? { value: summary.standing_percent, average: avgStanding } : null,
        avgHr: summary.avg_heart_rate != null && avgHr != null
          ? { value: summary.avg_heart_rate, average: avgHr } : null,
        avgPower: summary.avg_power_watts != null && avgPower != null
          ? { value: summary.avg_power_watts, average: avgPower } : null,
        stable: summary.stable_pedaling_percent != null && avgStable != null
          ? { value: summary.stable_pedaling_percent, average: avgStable } : null,
        unstable: summary.unstable_pedaling_percent != null && avgUnstable != null
          ? { value: summary.unstable_pedaling_percent, average: avgUnstable } : null,
        cadenceStanding: summary.avg_cadence_standing != null && avgCadenceStanding != null
          ? { value: summary.avg_cadence_standing, average: avgCadenceStanding } : null,
        cadenceSeated: summary.avg_cadence_seated != null && avgCadenceSeated != null
          ? { value: summary.avg_cadence_seated, average: avgCadenceSeated } : null,
      })
    }

    load()
    return () => { cancelled = true }
  }, [rideId])

  if (!data) return null

  const hasAny = data.stability || data.standing || data.avgHr || data.avgPower
  if (!hasAny) return null

  const hasAnalysisRow = data.stable || data.unstable || data.cadenceStanding || data.cadenceSeated

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4">
        {data.stability && (
          <ComparisonMetric
            label="Stability"
            value={data.stability.value}
            average={data.stability.average}
            unit="%"
            precision={1}
            colored
          />
        )}
        {data.standing && (
          <ComparisonMetric
            label="Standing"
            value={data.standing.value}
            average={data.standing.average}
            unit="%"
            precision={1}
          />
        )}
        {data.avgHr && (
          <ComparisonMetric
            label="Avg HR"
            value={data.avgHr.value}
            average={data.avgHr.average}
            unit=" bpm"
            precision={0}
          />
        )}
        {data.avgPower && (
          <ComparisonMetric
            label="Avg Power"
            value={data.avgPower.value}
            average={data.avgPower.average}
            unit=" W"
            precision={0}
            colored
          />
        )}
      </div>
      {hasAnalysisRow && (
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
          {data.stable && (
            <ComparisonMetric
              label="Stable %"
              value={data.stable.value}
              average={data.stable.average}
              unit="%"
              precision={0}
              colored
            />
          )}
          {data.unstable && (
            <ComparisonMetric
              label="Unstable %"
              value={data.unstable.value}
              average={data.unstable.average}
              unit="%"
              precision={0}
              colored
              invertColor
            />
          )}
          {data.cadenceStanding && (
            <ComparisonMetric
              label="Cadence (Standing)"
              value={data.cadenceStanding.value}
              average={data.cadenceStanding.average}
              unit=" rpm"
              precision={0}
            />
          )}
          {data.cadenceSeated && (
            <ComparisonMetric
              label="Cadence (Seated)"
              value={data.cadenceSeated.value}
              average={data.cadenceSeated.average}
              unit=" rpm"
              precision={0}
            />
          )}
        </div>
      )}
      {!hasAnalysisRow && <div className="mb-4" />}
    </>
  )
}
