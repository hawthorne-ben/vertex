'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useSearchParams, usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import { TimeSlider } from './time-slider'
import { RideMapClient } from './ride-map-client'
import { RideChartsClient } from './ride-charts-client'
import { Card, CardContent } from './ui/card'
import { MapErrorBoundary } from './map-error-boundary'
import { ConfirmationModal } from './ui/confirmation-modal'
import { EfficiencyTuningModal } from './dev/efficiency-tuning-modal'
import { getVtxTimeRanges } from '@/lib/sync/fit-vtx-sync'
import { buildIMUChartConfig, buildEfficiencyChartConfig, buildPositionChartConfig, buildRoughnessChartConfig, buildFitMetricChartConfig } from '@/lib/charts/processing'
import { useRideSamples } from './hooks/useRideSamples'
import { useIMUData } from './charts/hooks/useIMUData'
import { useDerivedMetric } from './charts/hooks/useDerivedMetric'
import { useAuthFetch } from '@/hooks/useAuthFetch'
import { apiCache } from '@/lib/cache/api-cache'
import { RideComparisonCards } from '@/components/ride-comparison-cards'
import { useToast } from '@/components/ui/toast-context'
import { RefreshCw, Settings, ChevronDown } from 'lucide-react'
import type { FitStatsMetric } from './ride-map'

// Shared stats dropdown used in both map and chart tab bars
function StatsDropdown({
  tabId,
  metric,
  setMetric,
  dropdownOpen,
  setDropdownOpen,
  isActive,
  disabled,
  stateClass,
  onActivate,
}: {
  tabId: string
  metric: FitStatsMetric
  setMetric: (m: FitStatsMetric) => void
  dropdownOpen: boolean
  setDropdownOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  isActive: boolean
  disabled: boolean
  stateClass: string
  onActivate: () => void
}) {
  const selectedLabel = FIT_STATS_OPTIONS.find(o => o.id === metric)!.label
  const baseClass = `px-4 py-2 text-sm font-medium transition-colors relative inline-flex items-center gap-1 ${stateClass}`

  return (
    <div key={tabId} className="relative">
      <button
        onClick={() => {
          if (disabled) return
          if (!isActive) {
            onActivate()
          } else {
            setDropdownOpen((prev: boolean) => !prev)
          }
        }}
        onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
        disabled={disabled}
        className={baseClass}
      >
        {selectedLabel}
        <ChevronDown className={`w-3 h-3 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
        {isActive && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
        )}
      </button>
      {dropdownOpen && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-md py-1 min-w-[120px]">
          {FIT_STATS_OPTIONS.map(option => (
            <button
              key={option.id}
              onMouseDown={(e) => {
                e.preventDefault()
                setMetric(option.id)
                setDropdownOpen(false)
                if (!isActive) onActivate()
              }}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-accent transition-colors ${
                option.id === metric ? 'text-primary' : 'text-foreground'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const UPlotBase = dynamic(
  () => import('./charts/UPlotBase').then(mod => ({ default: mod.UPlotBase })),
  { ssr: false, loading: () => <div className="h-[400px] bg-muted rounded-lg animate-pulse" /> }
)

// Map tab includes Route; chart tab does not
type MapTab = 'route' | 'stability' | 'position' | 'roughness' | 'stats' | 'orientation' | 'acceleration' | 'rotation'
type ChartTab = 'stability' | 'position' | 'roughness' | 'stats' | 'orientation' | 'acceleration' | 'rotation'

const FIT_STATS_OPTIONS: Array<{ id: FitStatsMetric; label: string }> = [
  { id: 'power', label: 'Power' },
  { id: 'cadence', label: 'Cadence' },
  { id: 'hr', label: 'HR' },
  { id: 'speed', label: 'Speed' },
]

const MAP_TAB_CONFIG: Array<{ id: MapTab; label: string }> = [
  { id: 'route', label: 'Route' },
  { id: 'stability', label: 'Stability' },
  { id: 'position', label: 'Position' },
  { id: 'roughness', label: 'Roughness' },
  { id: 'stats', label: 'Stats' },
  { id: 'orientation', label: 'Orientation' },
  { id: 'acceleration', label: 'Acceleration' },
  { id: 'rotation', label: 'Rotation' },
]

const CHART_TAB_CONFIG: Array<{ id: ChartTab; label: string }> = [
  { id: 'stability', label: 'Stability' },
  { id: 'position', label: 'Position' },
  { id: 'roughness', label: 'Roughness' },
  { id: 'stats', label: 'Stats' },
  { id: 'orientation', label: 'Orientation' },
  { id: 'acceleration', label: 'Acceleration' },
  { id: 'rotation', label: 'Rotation' },
]

// Map tab to IMU coverage color on the map
const IMU_TAB_COLORS: Record<string, string> = {
  orientation: '#22c55e',  // Green
  acceleration: '#3b82f6', // Blue
  rotation: '#f97316',     // Orange
}

// Tabs that use IMU data vs derived analytics
const IMU_TABS = new Set<string>(['orientation', 'acceleration', 'rotation'])
const ANALYTICS_TABS = new Set<string>(['stability', 'position', 'roughness'])

// Map tab → IMU data type
const TAB_TO_IMU_TYPE: Record<string, 'orientation' | 'accel' | 'gyro'> = {
  orientation: 'orientation',
  acceleration: 'accel',
  rotation: 'gyro',
}

// Map tab → derived metric type
const TAB_TO_METRIC: Record<string, 'pedalingEfficiency' | 'ridingPosition' | 'surfaceRoughness'> = {
  stability: 'pedalingEfficiency',
  position: 'ridingPosition',
  roughness: 'surfaceRoughness',
}

// Chart stats metric → sample field + chart config
const CHART_STATS_CONFIG: Record<FitStatsMetric, { label: string; unit: string; color: string; field: 'power_watts' | 'heart_rate' | 'cadence' | 'speed_ms'; convert?: (v: number) => number }> = {
  power: { label: 'Power', unit: 'W', color: '#ef4444', field: 'power_watts' },
  hr: { label: 'Heart Rate', unit: 'bpm', color: '#ec4899', field: 'heart_rate' },
  cadence: { label: 'Cadence', unit: 'rpm', color: '#3b82f6', field: 'cadence' },
  speed: { label: 'Speed', unit: 'mph', color: '#10b981', field: 'speed_ms', convert: (v) => v * 2.23694 },
}

const VALID_MAP_TABS = new Set<string>(MAP_TAB_CONFIG.map(t => t.id))
const VALID_CHART_TABS = new Set<string>(CHART_TAB_CONFIG.map(t => t.id))

interface VTXRecording {
  id: string
  start_time: string
  end_time: string
}

interface RideVisualizationsClientProps {
  rideId: string
  rideName?: string
  rideStartTime: string
  rideEndTime: string
  fitRecordingId: string | null
  hasGpsData: boolean
  vtxRecordings: VTXRecording[]
  vtxTotalSizeBytes?: number  // Total VTX file size for analysis time estimate
}

export function RideVisualizationsClient({
  rideId,
  rideName,
  rideStartTime,
  rideEndTime,
  fitRecordingId,
  hasGpsData,
  vtxRecordings,
  vtxTotalSizeBytes = 0
}: RideVisualizationsClientProps) {
  const searchParams = useSearchParams()
  const pathname = usePathname()

  const hasVtxData = vtxRecordings.length > 0
  const hasFitData = !!fitRecordingId
  // Analytics require both VTX (IMU) and FIT (GPS) data
  const hasAnalyticsData = hasVtxData && hasFitData && hasGpsData

  const getTabDisabled = useCallback((id: string): boolean => {
    if (id === 'route') return !hasGpsData
    if (id === 'stats') return !(hasFitData && hasGpsData)
    if (ANALYTICS_TABS.has(id)) return !hasAnalyticsData
    if (IMU_TABS.has(id)) return !hasVtxData
    return false
  }, [hasGpsData, hasFitData, hasAnalyticsData, hasVtxData])

  // Migrate legacy query param values (efficiency → stability)
  const migrateTabParam = (param: string | null): string | null => {
    if (param === 'efficiency') return 'stability'
    return param
  }

  // Read initial map tab from URL query param, fallback to Route
  const initialMapTab = (() => {
    const param = migrateTabParam(searchParams.get('tab'))
    if (param && VALID_MAP_TABS.has(param) && !getTabDisabled(param)) {
      return param as MapTab
    }
    return 'route' as MapTab
  })()

  // Read initial chart tab from URL, default to first available
  const initialChartTab = (() => {
    const param = migrateTabParam(searchParams.get('chart'))
    if (param && VALID_CHART_TABS.has(param) && !getTabDisabled(param)) {
      return param as ChartTab
    }
    // Default to first available chart tab
    for (const tab of CHART_TAB_CONFIG) {
      if (!getTabDisabled(tab.id)) return tab.id
    }
    return 'orientation' as ChartTab
  })()

  const [mapTab, setMapTab] = useState<MapTab>(initialMapTab)
  const [chartTab, setChartTab] = useState<ChartTab>(initialChartTab)
  const [statsMetric, setStatsMetric] = useState<FitStatsMetric>('power')
  const [chartStatsMetric, setChartStatsMetric] = useState<FitStatsMetric>('power')
  const [statsDropdownOpen, setStatsDropdownOpen] = useState(false)
  const [chartStatsDropdownOpen, setChartStatsDropdownOpen] = useState(false)
  const [selectedTime, setSelectedTime] = useState<number | null>(null)
  const [sharedZoomRange, setSharedZoomRange] = useState<{ start: string; end: string } | null>(null)
  const [mapZoom, setMapZoom] = useState<number | null>(null)
  const [showRerunConfirm, setShowRerunConfirm] = useState(false)
  const [showTuningModal, setShowTuningModal] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const { authFetch } = useAuthFetch()
  const { addToast } = useToast()
  const isDev = process.env.NODE_ENV === 'development'

  // Persist map tab to URL query param (shallow — no server round-trip)
  const handleMapTabChange = useCallback((tab: MapTab) => {
    setMapTab(tab)
    const params = new URLSearchParams(window.location.search)
    params.set('tab', tab)
    window.history.replaceState(null, '', `${pathname}?${params.toString()}`)
  }, [pathname])

  // Persist chart tab to URL query param (shallow — no server round-trip)
  const handleChartTabChange = useCallback((tab: ChartTab) => {
    setChartTab(tab)
    const params = new URLSearchParams(window.location.search)
    params.set('chart', tab)
    window.history.replaceState(null, '', `${pathname}?${params.toString()}`)
  }, [pathname])

  // Rerun analysis handler (prod: recompute with defaults via Inngest, dev: open tuning modal)
  const handleRerunAnalysis = useCallback(async () => {
    if (isDev) {
      setShowTuningModal(true)
      return
    }
    setShowRerunConfirm(true)
  }, [isDev])

  const handleConfirmRerun = useCallback(async () => {
    setRerunning(true)
    setShowRerunConfirm(false)
    try {
      const response = await authFetch(`/api/rides/${rideId}/reanalyze`, {
        method: 'POST',
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to trigger reanalysis')
      }
      // Invalidate cache and reload — useDerivedMetric will poll for Inngest results
      apiCache.invalidatePattern(rideId)
      window.location.reload()
    } catch (err: any) {
      console.error('Failed to rerun analysis:', err)
      addToast({
        type: 'error',
        title: 'Rerun failed',
        message: err.message || 'Failed to trigger reanalysis',
      })
      setRerunning(false)
    }
  }, [authFetch, rideId])

  // Fetch ride samples once - shared between map and charts
  const { samples, loading, error } = useRideSamples(rideId, fitRecordingId)

  // Fetch IMU data once at parent level — persists across tab switches
  // The VTX API returns all sensor types (accel, gyro, orientation) in one response
  const {
    samples: imuSamples,
    loading: imuLoading,
    error: imuError,
    coverageRanges: imuCoverageRangesFromHook
  } = useIMUData({
    rideId,
    recordings: vtxRecordings,
    dataType: 'accel', // doesn't affect fetch — API returns all types
    timeRange: sharedZoomRange,
    skip: !hasVtxData
  })

  // Determine what to fetch for map overlay (reads from mapTab)
  const isMapRouteTab = mapTab === 'route'
  const isMapAnalyticsTab = ANALYTICS_TABS.has(mapTab)
  const isMapStatsTab = mapTab === 'stats'
  const selectedMapMetric = TAB_TO_METRIC[mapTab] ?? null

  // Determine chart content (reads from chartTab)
  const isChartImuTab = IMU_TABS.has(chartTab)

  // Lazy-fetch: only start when user visits the tab (either map or chart). Data persists across tab switches.
  const [efficiencyRequested, setEfficiencyRequested] = useState(mapTab === 'stability' || chartTab === 'stability')
  const [positionRequested, setPositionRequested] = useState(mapTab === 'position' || chartTab === 'position')
  const [roughnessRequested, setRoughnessRequested] = useState(mapTab === 'roughness' || chartTab === 'roughness')

  // Mark metric as requested once user visits its tab (sticky — never goes back to false)
  if ((mapTab === 'stability' || chartTab === 'stability') && !efficiencyRequested) setEfficiencyRequested(true)
  if ((mapTab === 'position' || chartTab === 'position') && !positionRequested) setPositionRequested(true)
  if ((mapTab === 'roughness' || chartTab === 'roughness') && !roughnessRequested) setRoughnessRequested(true)

  const {
    samples: efficiencySamples,
    loading: efficiencyLoading,
    polling: efficiencyPolling,
    error: efficiencyError,
  } = useDerivedMetric({
    rideId,
    metric: 'pedalingEfficiency',
    timeRange: null,
    fitRecordingId,
    resolution: 1,
    enabled: hasAnalyticsData && efficiencyRequested
  })

  const {
    samples: positionSamplesRaw,
    loading: positionLoading,
    polling: positionPolling,
    error: positionError,
  } = useDerivedMetric({
    rideId,
    metric: 'ridingPosition',
    timeRange: null,
    fitRecordingId,
    resolution: 1,
    enabled: hasAnalyticsData && positionRequested
  })

  const {
    samples: roughnessSamples,
    loading: roughnessLoading,
    polling: roughnessPolling,
    error: roughnessError,
  } = useDerivedMetric({
    rideId,
    metric: 'surfaceRoughness',
    timeRange: null,
    fitRecordingId,
    resolution: 1,
    enabled: hasAnalyticsData && roughnessRequested
  })

  // Cast to position-specific type
  const positionSamples = positionSamplesRaw as Array<{
    timestamp: string
    position: 'standing' | 'seated' | null
    rockingMagnitude: number
    cadence: number | null
    value: number | null
  }>

  // Track analysis completion — when any metric transitions from loading to loaded,
  // increment key so RideComparisonCards refetches summaries
  const [analysisRefreshKey, setAnalysisRefreshKey] = useState(0)
  const prevAnalyticsLoading = useRef(false)

  const anyAnalyticsPolling = efficiencyPolling || positionPolling || roughnessPolling
  const anyAnalyticsLoaded = efficiencySamples.length > 0 || positionSamples.length > 0 || roughnessSamples.length > 0

  useEffect(() => {
    // When polling transitions from true → false with data, bump refresh key
    if (prevAnalyticsLoading.current && !anyAnalyticsPolling && anyAnalyticsLoaded) {
      setAnalysisRefreshKey(k => k + 1)
    }
    prevAnalyticsLoading.current = anyAnalyticsPolling
  }, [anyAnalyticsPolling, anyAnalyticsLoaded])

  // Estimate analysis time from VTX file size
  // ~2.5 min for 22MB (800K samples at 100Hz) based on observed performance
  const estimatedAnalysisSeconds = vtxTotalSizeBytes > 0
    ? Math.max(10, Math.round((vtxTotalSizeBytes / (22 * 1024 * 1024)) * 150))
    : null

  // Check if IMU data has orientation fields (only meaningful once data is loaded)
  const hasOrientationData = !imuLoading && imuSamples.length > 0
    ? imuSamples.some(s => s.roll != null && s.pitch != null)
    : null // unknown until loaded

  // Filter out orientation tab when we know the data doesn't have it
  const visibleMapTabs = useMemo(() =>
    MAP_TAB_CONFIG.filter(tab => tab.id !== 'orientation' || hasOrientationData !== false),
    [hasOrientationData]
  )
  const visibleChartTabs = useMemo(() =>
    CHART_TAB_CONFIG.filter(tab => tab.id !== 'orientation' || hasOrientationData !== false),
    [hasOrientationData]
  )

  // Calculate IMU time ranges for GPS color coding
  const imuTimeRanges = useMemo(() => {
    if (imuCoverageRangesFromHook.length > 0) {
      return imuCoverageRangesFromHook
    }
    return getVtxTimeRanges(vtxRecordings)
  }, [imuCoverageRangesFromHook, vtxRecordings])

  // Determine map mode based on mapTab
  const getMapMode = (): 'route' | 'fitStats' | 'pedalingEfficiency' | 'ridingPosition' | 'surfaceRoughness' | 'vtx' => {
    if (isMapRouteTab) return 'route'
    if (isMapStatsTab) return 'fitStats'
    if (isMapAnalyticsTab) return (selectedMapMetric as 'pedalingEfficiency' | 'ridingPosition' | 'surfaceRoughness') ?? 'pedalingEfficiency'
    return 'vtx'
  }
  const mapMode = getMapMode()
  const imuColor = IMU_TAB_COLORS[mapTab]

  // Show rerun button when on an analytics tab and data is loaded, or always on route tab if analytics data is possible
  const showRerunButton = hasAnalyticsData && (isMapAnalyticsTab ? !efficiencyLoading && !positionLoading && !roughnessLoading : true)

  // Analytics tabs are loading (polling for Inngest results)
  const mapAnalyticsLoading = isMapAnalyticsTab && (efficiencyLoading || positionLoading || roughnessLoading)

  // Prepare data for chart stats tab (detailed single metric view)
  const chartStatsConfig = CHART_STATS_CONFIG[chartStatsMetric]
  const chartStatsSamples = useMemo(() => {
    if (!samples || samples.length === 0) return []

    // Filter by zoom range if applicable
    const filtered = sharedZoomRange
      ? samples.filter(s => {
          const t = new Date(s.timestamp).getTime()
          return t >= new Date(sharedZoomRange.start).getTime() && t <= new Date(sharedZoomRange.end).getTime()
        })
      : samples

    return filtered.map(s => {
      const raw = (s as any)[chartStatsConfig.field] ?? null
      const value = raw !== null && chartStatsConfig.convert ? chartStatsConfig.convert(raw) : raw
      return { timestamp: s.timestamp, value }
    })
  }, [samples, chartStatsMetric, chartStatsConfig, sharedZoomRange])

  // Unified chart config — single memoized computation for all chart tabs
  const chartConfig = useMemo(() => {
    if (isChartImuTab) return buildIMUChartConfig(imuSamples, TAB_TO_IMU_TYPE[chartTab], sharedZoomRange)
    if (chartTab === 'stability') return buildEfficiencyChartConfig(efficiencySamples, sharedZoomRange)
    if (chartTab === 'position') return buildPositionChartConfig(positionSamples, sharedZoomRange)
    if (chartTab === 'roughness') return buildRoughnessChartConfig(roughnessSamples, sharedZoomRange)
    if (chartTab === 'stats') return buildFitMetricChartConfig(chartStatsSamples, chartStatsConfig)
    return null
  }, [chartTab, isChartImuTab, imuSamples, efficiencySamples, positionSamples, roughnessSamples, chartStatsSamples, chartStatsConfig, sharedZoomRange])

  const chartLoading =
    (isChartImuTab && imuLoading) ||
    (chartTab === 'stability' && efficiencyLoading) ||
    (chartTab === 'position' && positionLoading) ||
    (chartTab === 'roughness' && roughnessLoading) ||
    (chartTab === 'stats' && loading)

  const chartError =
    (isChartImuTab && imuError) ||
    (chartTab === 'stability' && efficiencyError) ||
    (chartTab === 'position' && positionError) ||
    (chartTab === 'roughness' && roughnessError) ||
    null

  // Show analysis progress banner only when polling for inngest job results
  const showAnalysisBanner = hasAnalyticsData && anyAnalyticsPolling

  return (
    <>
      {/* Analysis Progress Banner */}
      {showAnalysisBanner && (
        <div className="mb-4 p-3 rounded-lg border border-border bg-muted/50 flex items-center gap-3">
          <div className="relative shrink-0">
            <div className="w-5 h-5 border-2 border-muted-foreground/20 rounded-full" />
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin absolute top-0" />
          </div>
          <div className="text-sm text-secondary">
            <span className="font-medium text-primary">Analyzing ride data</span>
            {estimatedAnalysisSeconds && (
              <span> — typically takes {estimatedAnalysisSeconds < 60
                ? `~${estimatedAnalysisSeconds}s`
                : `~${Math.round(estimatedAnalysisSeconds / 60)} min`
              }</span>
            )}
          </div>
        </div>
      )}

      {/* Map tabs */}
      <div className="mb-4">
        <div className="flex items-center gap-1">
          {visibleMapTabs.map(tab => {
            const isStats = tab.id === 'stats'
            const disabled = getTabDisabled(tab.id)
            const isActive = mapTab === tab.id
            let stateClass = 'text-muted-foreground hover:text-foreground'
            if (isActive) stateClass = 'text-primary'
            else if (disabled) stateClass = 'text-muted-foreground/40 cursor-not-allowed'
            const baseClass = `px-4 py-2 text-sm font-medium transition-colors relative ${stateClass}`

            if (isStats) {
              return (
                <StatsDropdown
                  key={tab.id}
                  tabId={tab.id}
                  metric={statsMetric}
                  setMetric={setStatsMetric}
                  dropdownOpen={statsDropdownOpen}
                  setDropdownOpen={setStatsDropdownOpen}
                  isActive={isActive}
                  disabled={disabled}
                  stateClass={stateClass}
                  onActivate={() => handleMapTabChange('stats')}
                />
              )
            }

            return (
              <button
                key={tab.id}
                onClick={() => handleMapTabChange(tab.id)}
                disabled={disabled}
                className={baseClass}
              >
                {tab.label}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                )}
              </button>
            )
          })}

          {/* Rerun Analysis button — inline with tabs, tertiary style */}
          {showRerunButton && (
            <button
              onClick={handleRerunAnalysis}
              disabled={rerunning || mapAnalyticsLoading}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {rerunning || mapAnalyticsLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  {rerunning ? 'Rerunning...' : 'Analyzing...'}
                </>
              ) : (
                <>
                  {isDev ? <Settings className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Rerun Analysis
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Prod confirmation modal */}
      <ConfirmationModal
        isOpen={showRerunConfirm}
        onClose={() => setShowRerunConfirm(false)}
        onConfirm={handleConfirmRerun}
        type="warning"
        title="Rerun Analysis"
        message="This will recompute pedaling efficiency and riding position with the latest algorithm. Existing results will be overwritten."
        confirmText="Rerun"
        isLoading={rerunning}
      />

      {/* Dev tuning modal */}
      {isDev && (
        <EfficiencyTuningModal
          isOpen={showTuningModal}
          onClose={() => setShowTuningModal(false)}
          rideId={rideId}
          rideName={rideName}
        />
      )}

      {/* GPS Map */}
      <div className="mb-8">
        {fitRecordingId && hasGpsData ? (
          <MapErrorBoundary key={rideId}>
            <RideMapClient
              key={rideId}
              rideId={rideId}
              fitRecordingId={fitRecordingId}
              highlightTime={selectedTime}
              imuTimeRanges={isMapRouteTab ? [] : imuTimeRanges}
              imuColor={isMapRouteTab ? undefined : imuColor}
              samples={samples}
              loading={loading}
              error={error}
              mapMode={mapMode}
              efficiencySamples={isMapRouteTab ? [] : efficiencySamples}
              efficiencyLoading={isMapRouteTab ? false : efficiencyLoading}
              positionSamples={isMapRouteTab ? [] : positionSamples}
              positionLoading={isMapRouteTab ? false : positionLoading}
              roughnessSamples={isMapRouteTab ? [] : roughnessSamples}
              roughnessLoading={isMapRouteTab ? false : roughnessLoading}
              fitStatsSamples={isMapStatsTab ? samples : undefined}
              fitStatsMetric={isMapStatsTab ? statsMetric : undefined}
              onZoomChange={setMapZoom}
            />
          </MapErrorBoundary>
        ) : (
          <Card>
            <CardContent className="h-[400px] flex items-center justify-center">
              <p className="text-muted-foreground">No GPS data available</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Time Slider */}
      <div className="mb-8">
        <TimeSlider
          startTime={rideStartTime}
          endTime={rideEndTime}
          selectedTime={selectedTime}
          onTimeChange={setSelectedTime}
          mapZoom={mapZoom}
          initialMapZoom={13}
        />
      </div>

      {/* Chart tab bar */}
      <div className="mb-4">
        <div className="flex items-center gap-1 border-b border-border">
          {visibleChartTabs.map(tab => {
            const isStats = tab.id === 'stats'
            const disabled = getTabDisabled(tab.id)
            const isActive = chartTab === tab.id

            let stateClass = 'text-muted-foreground hover:text-foreground'
            if (isActive) stateClass = 'text-primary'
            else if (disabled) stateClass = 'text-muted-foreground/40 cursor-not-allowed'

            if (isStats) {
              return (
                <StatsDropdown
                  key={tab.id}
                  tabId={tab.id}
                  metric={chartStatsMetric}
                  setMetric={setChartStatsMetric}
                  dropdownOpen={chartStatsDropdownOpen}
                  setDropdownOpen={setChartStatsDropdownOpen}
                  isActive={isActive}
                  disabled={disabled}
                  stateClass={stateClass}
                  onActivate={() => handleChartTabChange('stats')}
                />
              )
            }

            return (
              <button
                key={tab.id}
                onClick={() => !disabled && handleChartTabChange(tab.id)}
                disabled={disabled}
                className={`px-4 py-2 text-sm font-medium transition-colors relative ${stateClass}`}
              >
                {tab.label}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                )}
              </button>
            )
          })}

          {sharedZoomRange && (
            <button
              onClick={() => setSharedZoomRange(null)}
              className="ml-auto px-3 py-1.5 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/30 rounded-md transition-colors"
            >
              Reset Zoom
            </button>
          )}
        </div>
      </div>

      {/* Chart content — single code path for all tabs */}
      <div className="mb-8">
        <Card className="min-h-[460px] relative">
          <CardContent className="pt-6 px-3">
            {chartLoading && (
              <div className="absolute inset-0 bg-card/80 rounded-lg flex items-center justify-center z-10">
                <div className="flex flex-col items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 border-4 border-muted-foreground/20 rounded-full" />
                    <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin absolute top-0" />
                  </div>
                  <p className="text-sm text-muted-foreground">Loading chart data...</p>
                </div>
              </div>
            )}
            {!chartLoading && chartError && (
              <div className="h-[400px] flex items-center justify-center">
                <p className="text-destructive">{chartError}</p>
              </div>
            )}
            {!chartError && chartConfig && chartConfig.data[0].length > 0 && (
              <UPlotBase
                data={chartConfig.data}
                series={chartConfig.series}
                scales={chartConfig.scales}
                axes={chartConfig.axes}
                highlightTime={selectedTime}
                onZoom={(start, end) => setSharedZoomRange({ start, end })}
                stats={chartConfig.stats}
              />
            )}
            {!chartLoading && !chartError && (!chartConfig || chartConfig.data[0].length === 0) && (
              <div className="h-[400px] flex items-center justify-center">
                <p className="text-muted-foreground">No data available</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Per-Ride Comparison vs Rolling Averages */}
      <RideComparisonCards rideId={rideId} refreshKey={analysisRefreshKey} />

      {/* FIT Performance Charts */}
      {fitRecordingId && (
        <div className="mb-8">
          <RideChartsClient
            rideId={rideId}
            fitRecordingId={fitRecordingId}
            highlightTime={selectedTime}
            samples={samples}
            loading={loading}
            error={error}
            zoomRange={sharedZoomRange}
            onZoomChange={setSharedZoomRange}
          />
        </div>
      )}
    </>
  )
}
