import { useState, useRef, useEffect } from 'react'
import { useDerivedMetric, type DerivedMetricSample } from './useDerivedMetric'
import { ANALYTICS_METRICS } from '@/lib/analytics-registry'

export interface MetricState {
  samples: DerivedMetricSample[]
  loading: boolean
  polling: boolean
  error: string | null
}

/**
 * Manages all analytics metrics with lazy fetching.
 * Each metric is only fetched when its tab is first visited (map or chart).
 * Returns a Record<tabId, MetricState> that works for any number of metrics.
 */
export function useAnalyticsMetrics({
  rideId,
  fitRecordingId,
  enabled,
  activeMapTab,
  activeChartTab,
}: {
  rideId: string
  fitRecordingId: string | null
  enabled: boolean
  activeMapTab: string
  activeChartTab: string
}): Record<string, MetricState> {
  // Track which metrics have been requested (sticky — never goes back to false)
  const [requested, setRequested] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    for (const m of ANALYTICS_METRICS) {
      if (activeMapTab === m.tabId || activeChartTab === m.tabId) {
        initial.add(m.tabId)
      }
    }
    return initial
  })

  // Mark metric as requested when tab is visited
  for (const m of ANALYTICS_METRICS) {
    if ((activeMapTab === m.tabId || activeChartTab === m.tabId) && !requested.has(m.tabId)) {
      setRequested(prev => new Set(prev).add(m.tabId))
    }
  }

  // Call useDerivedMetric for each registered metric.
  // Hooks must be called unconditionally (Rules of Hooks), but `enabled` controls fetching.
  // We use the array index to maintain stable hook order.
  const results: Record<string, MetricState> = {}

  // We need to call hooks in a fixed order. Since ANALYTICS_METRICS is a module-level
  // constant, the array length never changes between renders.
  for (const m of ANALYTICS_METRICS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const result = useDerivedMetric({
      rideId,
      metric: m.apiMetric,
      timeRange: null,
      fitRecordingId,
      // No resolution override — use native output rate (5 Hz for braking,
      // stability, roughness, position). The API's peak-selection downsampling
      // at 1 Hz was amplifying single-sample noise in braking BPF data.
      enabled: enabled && requested.has(m.tabId),
    })

    results[m.tabId] = {
      samples: result.samples,
      loading: result.loading,
      polling: result.polling,
      error: result.error,
    }
  }

  return results
}

/** Aggregate polling state across all metrics */
export function isAnyPolling(metrics: Record<string, MetricState>): boolean {
  return Object.values(metrics).some(m => m.polling)
}

/** Aggregate loaded state across all metrics */
export function isAnyLoaded(metrics: Record<string, MetricState>): boolean {
  return Object.values(metrics).some(m => m.samples.length > 0)
}

/** Check if any metric is loading */
export function isAnyLoading(metrics: Record<string, MetricState>): boolean {
  return Object.values(metrics).some(m => m.loading)
}
