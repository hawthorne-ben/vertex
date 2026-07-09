'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import uPlot from 'uplot'
import { useAuthFetch } from '@/hooks/useAuthFetch'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import {
  MetricTrendChart,
  PERIODS,
  type PeriodValue,
  type TrendData,
} from '@/components/efficiency-trend-chart'

const Sparkline = dynamic(
  () => import('./charts/UPlotBase').then(mod => ({ default: mod.UPlotBase })),
  { ssr: false, loading: () => <div className="h-[36px] bg-muted rounded animate-pulse" /> }
)

// Metrics exposed on the dashboard. `key` matches the /api/trends allowlist.
// `higherIsBetter` controls whether an upward slope reads as good (green).
// `rideTab` is the ride-detail tab/chart id to deep-link to on point click
// (analytics tab ids: stability, position, roughness, braking; else 'stats').
export interface DashboardMetric {
  key: string
  label: string
  color: string
  format: (v: number) => string
  higherIsBetter: boolean
  rideTab: string
}

export const DASHBOARD_METRICS: DashboardMetric[] = [
  { key: 'stability', label: 'Stability', color: '#22c55e', format: v => `${v.toFixed(0)}%`, higherIsBetter: true, rideTab: 'stability' },
  { key: 'standing', label: 'Standing', color: '#f59e0b', format: v => `${v.toFixed(0)}%`, higherIsBetter: false, rideTab: 'position' },
  { key: 'avg_roughness', label: 'Roughness', color: '#ef4444', format: v => `${(v * 100).toFixed(0)}%`, higherIsBetter: false, rideTab: 'roughness' },
  { key: 'avg_power', label: 'Avg Power', color: '#3b82f6', format: v => `${v.toFixed(0)}W`, higherIsBetter: true, rideTab: 'stats' },
  { key: 'avg_hr', label: 'Avg HR', color: '#ec4899', format: v => `${v.toFixed(0)}`, higherIsBetter: false, rideTab: 'stats' },
  { key: 'avg_cadence', label: 'Cadence', color: '#8b5cf6', format: v => `${v.toFixed(0)}`, higherIsBetter: true, rideTab: 'stats' },
  { key: 'pedaling', label: 'Pedaling', color: '#14b8a6', format: v => `${v.toFixed(0)}%`, higherIsBetter: true, rideTab: 'stability' },
]

const ALL_KEYS = DASHBOARD_METRICS.map(m => m.key).join(',')
const STORAGE_KEY = 'dashboard.metrics.view'

interface PersistedView {
  metric: string
  period: PeriodValue
}

function loadPersistedView(): PersistedView {
  const fallback: PersistedView = { metric: DASHBOARD_METRICS[0].key, period: '3m' }
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<PersistedView>
    const metric = DASHBOARD_METRICS.some(m => m.key === parsed.metric) ? parsed.metric! : fallback.metric
    const period = PERIODS.some(p => p.value === parsed.period) ? parsed.period! : fallback.period
    return { metric, period }
  } catch {
    return fallback
  }
}

interface KpiTileProps {
  metric: DashboardMetric
  data: TrendData | null
  loading: boolean
  active: boolean
  onSelect: () => void
}

function KpiTile({ metric, data, loading, active, onSelect }: KpiTileProps) {
  const points = data?.points ?? null
  const stats = data?.stats ?? null

  const sparkConfig = useMemo(() => {
    if (!points || points.length < 2) return null
    const timestamps = points.map(p => new Date(p.date).getTime() / 1000)
    const values = points.map(p => p.value)
    const alignedData: uPlot.AlignedData = [timestamps, values]
    const series: uPlot.Series[] = [
      {},
      { stroke: metric.color, width: 1.5, fill: `${metric.color}14`, points: { show: false } },
    ]
    const axes: uPlot.Axis[] = [{ show: false }, { show: false }]
    const scales = { x: {}, y: { auto: true } }
    return { data: alignedData, series, axes, scales }
  }, [points, metric.color])

  // "Good" trend → green, "bad" → red. Direction meaning depends on the metric.
  const improving = stats
    ? metric.higherIsBetter
      ? stats.trendDirection === 'improving'
      : stats.trendDirection === 'declining'
    : false
  const declining = stats
    ? metric.higherIsBetter
      ? stats.trendDirection === 'declining'
      : stats.trendDirection === 'improving'
    : false

  const TrendIcon = stats?.trendDirection === 'improving'
    ? TrendingUp
    : stats?.trendDirection === 'declining'
      ? TrendingDown
      : Minus
  const trendColor = improving ? 'text-emerald-500' : declining ? 'text-red-400' : 'text-muted-foreground'

  return (
    <button
      onClick={onSelect}
      aria-pressed={active}
      className={`text-left rounded-lg border p-4 transition-colors ${
        active
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/40 bg-card'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-secondary">{metric.label}</span>
        {stats && <TrendIcon className={`w-3.5 h-3.5 ${trendColor} kpi-trend-icon`} />}
      </div>
      <div className="text-2xl font-bold text-primary tabular-nums">
        {stats ? metric.format(stats.current) : loading ? '' : '—'}
      </div>
      <div className="h-[36px] mt-1 -mx-1">
        {loading ? (
          <div className="h-[36px] bg-muted/60 rounded animate-pulse" />
        ) : sparkConfig ? (
          <div className="kpi-sparkline-fade">
            <Sparkline
              data={sparkConfig.data}
              series={sparkConfig.series}
              axes={sparkConfig.axes}
              scales={sparkConfig.scales}
              height={36}
            />
          </div>
        ) : (
          <div className="h-[36px] flex items-center text-xs text-muted-foreground">No data yet</div>
        )}
      </div>
    </button>
  )
}

/**
 * Interactive dashboard metrics section: a KPI row of clickable trend tiles
 * that drive a single large switchable trend chart below.
 *
 * All metrics are fetched in ONE /api/trends request (comma-separated) per
 * period, so the tiles resolve together instead of racing 7 requests. The
 * selected metric + period persist to localStorage.
 */
export function DashboardMetrics() {
  const router = useRouter()
  const { authFetch } = useAuthFetch()

  // Hydrate from localStorage after mount to avoid SSR/client mismatch.
  const [selectedKey, setSelectedKey] = useState<string>(DASHBOARD_METRICS[0].key)
  const [period, setPeriod] = useState<PeriodValue>('3m')
  useEffect(() => {
    const view = loadPersistedView()
    setSelectedKey(view.metric)
    setPeriod(view.period)
  }, [])

  const [allData, setAllData] = useState<Record<string, TrendData> | null>(null)
  const [loading, setLoading] = useState(true)

  // Single fetch for every metric at the current period.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    async function load() {
      try {
        const res = await authFetch(`/api/trends?metric=${ALL_KEYS}&period=${period}`)
        if (!res.ok || cancelled) return
        const json = await res.json()
        if (!cancelled) setAllData(json.metrics ?? {})
      } catch {
        // non-critical
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [authFetch, period])

  const selected = DASHBOARD_METRICS.find(m => m.key === selectedKey) ?? DASHBOARD_METRICS[0]

  const persist = useCallback((metric: string, per: PeriodValue) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ metric, period: per }))
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, [])

  const onSelectMetric = useCallback((m: DashboardMetric) => {
    setSelectedKey(m.key)
    persist(m.key, period)
  }, [period, persist])

  const onPeriodChange = useCallback((p: PeriodValue) => {
    setPeriod(p)
    persist(selectedKey, p)
  }, [selectedKey, persist])

  const onPointClick = useCallback((rideId: string) => {
    // Deep-link into the ride detail's matching tab + chart for this metric.
    const tab = selected.rideTab
    router.push(`/rides/${rideId}?tab=${tab}&chart=${tab}`)
  }, [router, selected.rideTab])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
        {DASHBOARD_METRICS.map(m => (
          <KpiTile
            key={m.key}
            metric={m}
            data={allData?.[m.key] ?? null}
            loading={loading}
            active={m.key === selected.key}
            onSelect={() => onSelectMetric(m)}
          />
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card p-4 md:p-6">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-xl font-serif">{selected.label} over time</h2>
          <span className="text-xs text-secondary">Click a point to open that ride</span>
        </div>
        <MetricTrendChart
          key={selected.key}
          metric={selected.key}
          lineColor={selected.color}
          formatValue={selected.format}
          data={allData?.[selected.key] ?? null}
          loading={loading}
          period={period}
          onPeriodChange={onPeriodChange}
          onPointClick={onPointClick}
        />
      </div>
    </div>
  )
}
