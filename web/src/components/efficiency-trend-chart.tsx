'use client'

import { useEffect, useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import uPlot from 'uplot'
import { useAuthFetch } from '@/hooks/useAuthFetch'
import { TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-react'

const UPlotBase = dynamic(
  () => import('./charts/UPlotBase').then(mod => ({ default: mod.UPlotBase })),
  { ssr: false, loading: () => <div className="h-[180px] bg-muted rounded-lg animate-pulse" /> }
)

interface TrendPoint {
  date: string
  value: number
  durationSeconds: number
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

const PERIODS = [
  { label: '1W', value: '1w' },
  { label: '1M', value: '4w' },
  { label: '3M', value: '3m' },
  { label: '1Y', value: '1y' },
  { label: 'All', value: 'all' },
] as const

type PeriodValue = typeof PERIODS[number]['value']

interface MetricTrendChartProps {
  metric: string
  unit?: string
  lineColor?: string
  formatValue?: (v: number) => string
  defaultPeriod?: PeriodValue
}

export function MetricTrendChart({
  metric,
  unit = '',
  lineColor = '#22c55e',
  formatValue,
  defaultPeriod = '3m',
}: MetricTrendChartProps) {
  const { authFetch } = useAuthFetch()
  const [data, setData] = useState<TrendData | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<PeriodValue>(defaultPeriod)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setLoading(true)

    async function load() {
      try {
        const res = await authFetch(`/api/trends?metric=${metric}&period=${period}`)
        if (!res.ok || cancelled) return
        const json = await res.json()
        if (!cancelled) setData(json.metrics?.[metric] || null)
      } catch {
        // non-critical
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [authFetch, metric, period])

  const fmt = formatValue ?? ((v: number) => unit ? `${v.toFixed(1)}${unit}` : v.toFixed(2))

  const chartConfig = useMemo(() => {
    if (!data?.points || data.points.length < 1) return null

    const timestamps = data.points.map(p => new Date(p.date).getTime() / 1000)
    const values = data.points.map(p => p.value)
    const durations = data.points.map(p => p.durationSeconds)
    const chartData: uPlot.AlignedData = [timestamps, values, durations]

    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
    const textColor = isDark ? '#9ca3af' : '#6b7280'

    const series: uPlot.Series[] = [
      { label: 'Date' },
      {
        label: metric,
        stroke: lineColor,
        width: 2,
        fill: `${lineColor}14`,
        points: { show: true, size: 5, fill: lineColor, stroke: lineColor },
        value: (_u, v) => v == null ? '-' : fmt(v),
      },
      {
        label: 'Duration',
        show: false,
        scale: 'dur',
        value: (_u, v) => {
          if (v == null) return '-'
          const h = Math.floor(v / 3600)
          const m = Math.floor((v % 3600) / 60)
          return h > 0 ? `${h}h ${m}m` : `${m}m`
        },
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
        values: (_u, vals) => vals.map(v => v == null ? '' : fmt(v)),
      },
    ]

    const allValues = values.filter(v => v != null)
    const dataMin = Math.min(...allValues)
    const dataMax = Math.max(...allValues)

    const scales: Record<string, uPlot.Scale> = {
      x: {},
      dur: { auto: true },
      y: {
        auto: true,
        range: (_u, min, max) => {
          const pad = Math.max((max - min) * 0.15, 0.5)
          return [Math.max(0, min - pad), max + pad]
        },
      },
    }

    return { data: chartData, series, axes, scales, plugins: [] }
  }, [data, lineColor, metric, fmt])

  const stats = data?.stats ?? null

  const trendIcon = stats?.trendDirection === 'improving'
    ? <TrendingUp className="w-3.5 h-3.5" />
    : stats?.trendDirection === 'declining'
      ? <TrendingDown className="w-3.5 h-3.5" />
      : <Minus className="w-3.5 h-3.5" />

  const trendColor = stats?.trendDirection === 'improving'
    ? 'text-emerald-500'
    : stats?.trendDirection === 'declining'
      ? 'text-red-400'
      : 'text-muted-foreground'

  const periodSelector = (
    <div className="flex gap-0.5">
      {PERIODS.map(p => (
        <button
          key={p.value}
          onClick={() => setPeriod(p.value)}
          className={`px-2 py-0.5 text-xs rounded transition-colors ${
            period === p.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )

  if (loading) {
    return (
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <span className="text-2xl font-bold text-primary opacity-0">—</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground opacity-0">avg: —</span>
            {periodSelector}
          </div>
        </div>
        <div className="h-[180px] flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
      </div>
    )
  }

  if (!stats || !chartConfig) {
    return (
      <div>
        <div className="flex justify-end mb-3">{periodSelector}</div>
        <div className="h-[180px] flex items-center justify-center text-sm text-muted-foreground">
          No data in this period.
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <span className="text-2xl font-bold text-primary">{fmt(stats.periodAvg)}</span>
          <span className={`inline-flex items-center gap-1 ml-2 text-sm ${trendColor}`}>
            {trendIcon}
            {stats.trend > 0 ? '+' : ''}{stats.trend.toFixed(2)}/wk
          </span>
        </div>
        <div className="flex items-center gap-3">
          {periodSelector}
        </div>
      </div>
      <UPlotBase
        data={chartConfig.data}
        series={chartConfig.series}
        axes={chartConfig.axes}
        scales={chartConfig.scales}
        plugins={chartConfig.plugins}
        height={180}
      />
    </div>
  )
}

// Named exports for each dashboard chart
export function EfficiencyTrendChart() {
  return (
    <MetricTrendChart
      metric="stability"
      unit="%"
      lineColor="#22c55e"
      formatValue={v => `${v.toFixed(1)}%`}
    />
  )
}

export function StandingTrendChart() {
  return (
    <MetricTrendChart
      metric="standing"
      unit="%"
      lineColor="#f59e0b"
      formatValue={v => `${v.toFixed(1)}%`}
    />
  )
}

export function RoughnessTrendChart() {
  return (
    <MetricTrendChart
      metric="avg_roughness"
      lineColor="#ef4444"
      formatValue={v => `${(v * 100).toFixed(1)}%`}
    />
  )
}
