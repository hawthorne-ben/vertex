import { useMemo, useState } from 'react'
import { useDerivedMetric, type DerivedMetricSample } from './useDerivedMetric'
import { ANALYTICS_METRICS } from '@/lib/analytics-registry'

export interface MetricState {
  samples: DerivedMetricSample[]
  loading: boolean
  polling: boolean
  error: string | null
}

export interface AnalyticsRange {
  start: string
  end: string
}

export interface AnalyticsMetricsResult {
  /** Per-metric state for the map overlay (always full ride at 1 Hz). */
  mapMetrics: Record<string, MetricState>
  /** Per-metric state for the chart (zoom-aware density). */
  chartMetrics: Record<string, MetricState>
}

// Target ~1000 samples in the chart's visible range — roughly one sample
// per pixel on a typical chart width. Translates to a resolution (Hz) that
// scales with the zoom span: zoom in 10× → 10× the density.
const CHART_TARGET_SAMPLES = 1000
const CHART_MIN_HZ = 0.1
const CHART_MAX_HZ = 5

function chartResolutionForRange(range: AnalyticsRange | null, fallbackSeconds: number): number {
  const seconds = range
    ? Math.max(1, (new Date(range.end).getTime() - new Date(range.start).getTime()) / 1000)
    : fallbackSeconds
  const hz = CHART_TARGET_SAMPLES / seconds
  return Math.min(CHART_MAX_HZ, Math.max(CHART_MIN_HZ, hz))
}

/**
 * Manages all analytics metrics with lazy fetching.
 * Each metric is only fetched when its tab is first visited (map or chart).
 *
 * Map and chart fetch separately:
 * - Map always pulls the full ride at 1 Hz so overlays stay dense across the
 *   whole route. Cached forever — re-renders never refetch.
 * - Chart pulls its current zoom range at a density that scales with the
 *   span (more zoom → more samples per second). Refetches when the zoom
 *   range changes; cached per zoom range.
 */
export function useAnalyticsMetrics({
  rideId,
  fitRecordingId,
  enabled,
  activeMapTab,
  activeChartTab,
  chartRange,
  rideDurationSeconds,
}: {
  rideId: string
  fitRecordingId: string | null
  enabled: boolean
  activeMapTab: string
  activeChartTab: string
  /** Chart zoom range (single window). Null = chart showing full ride. */
  chartRange: AnalyticsRange | null
  /** Total ride duration, used as the chart-zoom fallback when no range is set. */
  rideDurationSeconds: number
}): AnalyticsMetricsResult {
  // Track which metrics have been requested (sticky — never goes back to false).
  // Tracked separately for map vs chart so visiting only the chart tab doesn't
  // also pay for the map's full-ride fetch (and vice versa).
  const [mapRequested, setMapRequested] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    for (const m of ANALYTICS_METRICS) {
      if (activeMapTab === m.tabId) initial.add(m.tabId)
    }
    return initial
  })
  const [chartRequested, setChartRequested] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    for (const m of ANALYTICS_METRICS) {
      if (activeChartTab === m.tabId) initial.add(m.tabId)
    }
    return initial
  })

  for (const m of ANALYTICS_METRICS) {
    if (activeMapTab === m.tabId && !mapRequested.has(m.tabId)) {
      setMapRequested(prev => new Set(prev).add(m.tabId))
    }
    if (activeChartTab === m.tabId && !chartRequested.has(m.tabId)) {
      setChartRequested(prev => new Set(prev).add(m.tabId))
    }
  }

  // Per-metric MetricState objects are wrapped in useMemo keyed on their
  // primitive fields. Without this, every render allocates new objects for
  // each metric, which cascades into downstream useMemos that depend on
  // `mapMetrics` / `chartMetrics` identity (e.g. analyticsOverlay →
  // RoutePolylines rebuild).
  const mapStates: MetricState[] = []
  const chartStates: MetricState[] = []

  // ANALYTICS_METRICS is a module-level constant, so the loop length is stable
  // across renders — safe to call hooks inside the loop.
  for (const m of ANALYTICS_METRICS) {
    // Map fetch: full ride at 1 Hz. Stable URL, fetched once per metric.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const mapResult = useDerivedMetric({
      rideId,
      metric: m.apiMetric,
      ranges: null,
      resolution: 1,
      fitRecordingId,
      enabled: enabled && mapRequested.has(m.tabId),
    })

    // eslint-disable-next-line react-hooks/rules-of-hooks
    const mapState = useMemo<MetricState>(
      () => ({
        samples: mapResult.samples,
        loading: mapResult.loading,
        polling: mapResult.polling,
        error: mapResult.error,
      }),
      [mapResult.samples, mapResult.loading, mapResult.polling, mapResult.error]
    )
    mapStates.push(mapState)

    // Chart fetch: zoom range at a density that scales with the span.
    const chartResolution = chartResolutionForRange(chartRange, rideDurationSeconds)
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const chartResult = useDerivedMetric({
      rideId,
      metric: m.apiMetric,
      ranges: chartRange ? [chartRange] : null,
      resolution: chartResolution,
      fitRecordingId,
      enabled: enabled && chartRequested.has(m.tabId),
    })

    // eslint-disable-next-line react-hooks/rules-of-hooks
    const chartState = useMemo<MetricState>(
      () => ({
        samples: chartResult.samples,
        loading: chartResult.loading,
        polling: chartResult.polling,
        error: chartResult.error,
      }),
      [chartResult.samples, chartResult.loading, chartResult.polling, chartResult.error]
    )
    chartStates.push(chartState)
  }

  // Wrap into Records. Identity of the record itself must also stay stable
  // when contents are unchanged so downstream useMemos that depend on
  // `mapMetrics` / `chartMetrics` don't invalidate. The state entries are
  // memoized above, so React's shallow dep comparison on these arrays bails
  // when every entry kept its previous reference.
  const mapMetrics = useMemo(() => {
    const out: Record<string, MetricState> = {}
    for (let i = 0; i < ANALYTICS_METRICS.length; i++) {
      out[ANALYTICS_METRICS[i].tabId] = mapStates[i]
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, mapStates)

  const chartMetrics = useMemo(() => {
    const out: Record<string, MetricState> = {}
    for (let i = 0; i < ANALYTICS_METRICS.length; i++) {
      out[ANALYTICS_METRICS[i].tabId] = chartStates[i]
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, chartStates)

  return useMemo(() => ({ mapMetrics, chartMetrics }), [mapMetrics, chartMetrics])
}

/** Aggregate polling state across all map and chart metrics */
export function isAnyPolling(result: AnalyticsMetricsResult): boolean {
  const all = [...Object.values(result.mapMetrics), ...Object.values(result.chartMetrics)]
  return all.some(m => m.polling)
}

/** Aggregate loaded state across all map and chart metrics */
export function isAnyLoaded(result: AnalyticsMetricsResult): boolean {
  const all = [...Object.values(result.mapMetrics), ...Object.values(result.chartMetrics)]
  return all.some(m => m.samples.length > 0)
}

/** Check if any metric is loading */
export function isAnyLoading(result: AnalyticsMetricsResult): boolean {
  const all = [...Object.values(result.mapMetrics), ...Object.values(result.chartMetrics)]
  return all.some(m => m.loading)
}
