'use client'

import { useEffect, useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import uPlot from 'uplot'
import { useAuthFetch } from '@/hooks/useAuthFetch'
import { TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-react'

const UPlotBase = dynamic(
  () => import('./charts/UPlotBase').then(mod => ({ default: mod.UPlotBase })),
  { ssr: false, loading: () => <div className="h-[200px] bg-muted rounded-lg animate-pulse" /> }
)

interface TrendPoint {
  date: string
  value: number
  rideId: string
  rideName: string
}

interface TrendStats {
  current: number
  periodAvg: number
  periodMin: number
  periodMax: number
  trend: number
  trendDirection: 'improving' | 'declining' | 'stable'
}

interface TrendData {
  points: TrendPoint[]
  stats: TrendStats | null
}

export function EfficiencyTrendChart() {
  const { authFetch } = useAuthFetch()
  const [data, setData] = useState<TrendData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await authFetch('/api/trends?metric=efficiency&period=8w')
        if (!res.ok || cancelled) return
        const json = await res.json()
        if (!cancelled) setData(json.metrics?.efficiency || null)
      } catch {
        // Silently fail — dashboard chart is non-critical
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [authFetch])

  const chartConfig = useMemo(() => {
    if (!data?.points || data.points.length < 2) return null

    const timestamps = data.points.map(p => new Date(p.date).getTime() / 1000)
    const values = data.points.map(p => p.value)

    const chartData: uPlot.AlignedData = [timestamps, values]

    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
    const textColor = isDark ? '#9ca3af' : '#6b7280'
    const lineColor = '#22c55e'

    const series: uPlot.Series[] = [
      { label: 'Date' },
      {
        label: 'Efficiency',
        stroke: lineColor,
        width: 2,
        fill: isDark ? 'rgba(34,197,94,0.08)' : 'rgba(34,197,94,0.06)',
        points: { show: true, size: 5, fill: lineColor, stroke: lineColor },
        value: (_u, v) => v == null ? '-' : `${v.toFixed(1)}%`,
      },
    ]

    const axes: uPlot.Axis[] = [
      {
        space: 60,
        grid: { show: false },
        stroke: textColor,
        ticks: { show: false },
        size: 32,
        values: (_u, vals) => vals.map(v => {
          const d = new Date(v * 1000)
          return `${d.getMonth() + 1}/${d.getDate()}`
        }),
      },
      {
        side: 3,
        grid: { show: true, stroke: gridColor },
        stroke: textColor,
        ticks: { show: false },
        size: 40,
        space: 30,
        values: (_u, vals) => vals.map(v => `${v?.toFixed(0)}%`),
      },
    ]

    const scales: Record<string, uPlot.Scale> = {
      x: {},
      y: {
        auto: true,
        range: (_u, dataMin, dataMax) => {
          const pad = Math.max((dataMax - dataMin) * 0.15, 2)
          return [Math.max(0, dataMin - pad), Math.min(100, dataMax + pad)]
        },
      },
    }

    return { data: chartData, series, axes, scales }
  }, [data])

  if (loading) {
    return (
      <div className="h-[200px] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    )
  }

  if (!data?.stats || !chartConfig) return null

  const { stats } = data
  const trendIcon = stats.trendDirection === 'improving'
    ? <TrendingUp className="w-3.5 h-3.5" />
    : stats.trendDirection === 'declining'
      ? <TrendingDown className="w-3.5 h-3.5" />
      : <Minus className="w-3.5 h-3.5" />

  const trendColor = stats.trendDirection === 'improving'
    ? 'text-emerald-500'
    : stats.trendDirection === 'declining'
      ? 'text-red-400'
      : 'text-muted-foreground'

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <span className="text-2xl font-bold text-primary">{stats.current.toFixed(1)}%</span>
          <span className={`inline-flex items-center gap-1 ml-2 text-sm ${trendColor}`}>
            {trendIcon}
            {stats.trend > 0 ? '+' : ''}{stats.trend.toFixed(2)}/wk
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          8-wk avg: {stats.periodAvg.toFixed(1)}%
        </span>
      </div>
      <UPlotBase
        data={chartConfig.data}
        series={chartConfig.series}
        axes={chartConfig.axes}
        scales={chartConfig.scales}
        height={180}
      />
    </div>
  )
}
