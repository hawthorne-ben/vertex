/**
 * Central registry for analytics metrics.
 *
 * Adding a new metric requires ONE entry here + a chart builder + a map color fn.
 * No type unions, no if/else chains, no per-metric props.
 */

import type { DerivedMetricType } from '@/components/charts/hooks/useDerivedMetric'
import type { ChartConfig } from '@/lib/charts/processing'

// ---------- Map overlay color functions ----------

// Green-yellow-red gradient for 0-100 value (high = good)
const stabilityColor = (value: number): string => {
  if (value >= 70) return '#22c55e'
  if (value >= 65) return '#4ade80'
  if (value >= 60) return '#84cc16'
  if (value >= 55) return '#eab308'
  if (value >= 50) return '#f59e0b'
  if (value >= 45) return '#f97316'
  if (value >= 40) return '#fb923c'
  if (value >= 35) return '#ef4444'
  return '#dc2626'
}

// Green-yellow-red gradient for 0-100 value (low = good, inverted)
const roughnessColor = (value: number): string => {
  if (value <= 10) return '#22c55e'
  if (value <= 20) return '#4ade80'
  if (value <= 30) return '#84cc16'
  if (value <= 40) return '#eab308'
  if (value <= 50) return '#f59e0b'
  if (value <= 60) return '#f97316'
  if (value <= 70) return '#fb923c'
  if (value <= 85) return '#ef4444'
  return '#dc2626'
}

// Braking intensity: green = coasting, red = hard braking
const brakingColor = (value: number): string => {
  if (value <= 5) return '#22c55e'
  if (value <= 15) return '#4ade80'
  if (value <= 25) return '#84cc16'
  if (value <= 35) return '#eab308'
  if (value <= 45) return '#f59e0b'
  if (value <= 55) return '#f97316'
  if (value <= 70) return '#fb923c'
  if (value <= 85) return '#ef4444'
  return '#dc2626'
}

// Position: binary seated/standing based on value (0 = seated, 1 = standing)
const positionColor = (value: number): string | null => {
  if (value >= 0.5) return '#ef4444' // standing
  if (value >= 0) return '#22c55e'   // seated
  return null
}

// ---------- Registry types ----------

export interface AnalyticsMetricDef {
  /** Tab ID used in URL params and tab bar */
  tabId: string
  /** Human-readable label */
  label: string
  /** API metric type for useDerivedMetric */
  apiMetric: DerivedMetricType
  /** Map overlay: convert sample value (0-100) to hex color. Return null to skip. */
  getOverlayColor: (value: number) => string | null
  /** Chart builder function name key */
  chartBuilder: string
}

/**
 * All analytics metrics. To add a new metric:
 * 1. Add an entry here
 * 2. Add a chart builder in processing.ts
 * 3. Add a `case` in useDerivedMetric for the API URL + value transform
 * 4. Add the API endpoint
 */
export const ANALYTICS_METRICS: AnalyticsMetricDef[] = [
  {
    tabId: 'stability',
    label: 'Stability',
    apiMetric: 'pedalingEfficiency',
    getOverlayColor: stabilityColor,
    chartBuilder: 'efficiency',
  },
  {
    tabId: 'position',
    label: 'Position',
    apiMetric: 'ridingPosition',
    getOverlayColor: positionColor,
    chartBuilder: 'position',
  },
  {
    tabId: 'roughness',
    label: 'Roughness',
    apiMetric: 'surfaceRoughness',
    getOverlayColor: roughnessColor,
    chartBuilder: 'roughness',
  },
  {
    tabId: 'braking',
    label: 'Braking',
    apiMetric: 'braking',
    getOverlayColor: brakingColor,
    chartBuilder: 'braking',
  },
]

/** Set of analytics tab IDs for quick lookup */
export const ANALYTICS_TAB_IDS = new Set(ANALYTICS_METRICS.map(m => m.tabId))

/** Map tabId → metric definition */
export const ANALYTICS_BY_TAB = new Map(ANALYTICS_METRICS.map(m => [m.tabId, m]))
