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
import { buildIMUChartConfig, buildEfficiencyChartConfig, buildPositionChartConfig, buildRoughnessChartConfig, buildBrakingChartConfig, buildFitMetricChartConfig } from '@/lib/charts/processing'
import { useRideSamples } from './hooks/useRideSamples'
import { useIMUData } from './charts/hooks/useIMUData'
import { useAnalyticsMetrics, isAnyPolling, isAnyLoaded, isAnyLoading } from './charts/hooks/useAnalyticsMetrics'
import { ANALYTICS_TAB_IDS, ANALYTICS_BY_TAB } from '@/lib/analytics-registry'
import { useAuthFetch } from '@/hooks/useAuthFetch'
import { apiCache } from '@/lib/cache/api-cache'
import { RideComparisonCards } from '@/components/ride-comparison-cards'
import { useToast } from '@/components/ui/toast-context'
import { RefreshCw, Settings, ChevronDown } from 'lucide-react'
import type { FitStatsMetric, AnalyticsOverlay } from './ride-map'
import type { ChartConfig } from '@/lib/charts/processing'

// Chart builder dispatch — maps chartBuilder key to function
const CHART_BUILDERS: Record<string, (samples: any[], zoomRange?: { start: string; end: string } | null) => ChartConfig> = {
  efficiency: buildEfficiencyChartConfig,
  position: buildPositionChartConfig,
  roughness: buildRoughnessChartConfig,
  braking: buildBrakingChartConfig,
}

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

const FIT_STATS_OPTIONS: Array<{ id: FitStatsMetric; label: string }> = [
  { id: 'power', label: 'Power' },
  { id: 'cadence', label: 'Cadence' },
  { id: 'hr', label: 'HR' },
  { id: 'speed', label: 'Speed' },
]

// Build tab configs from registry + fixed tabs
const MAP_TAB_CONFIG: Array<{ id: string; label: string }> = [
  { id: 'route', label: 'Route' },
  ...Array.from(ANALYTICS_BY_TAB.values()).map(m => ({ id: m.tabId, label: m.label })),
  { id: 'stats', label: 'Stats' },
  { id: 'orientation', label: 'Orientation' },
  { id: 'acceleration', label: 'Acceleration' },
  { id: 'rotation', label: 'Rotation' },
]

const CHART_TAB_CONFIG: Array<{ id: string; label: string }> = [
  ...Array.from(ANALYTICS_BY_TAB.values()).map(m => ({ id: m.tabId, label: m.label })),
  { id: 'stats', label: 'Stats' },
  { id: 'orientation', label: 'Orientation' },
  { id: 'acceleration', label: 'Acceleration' },
  { id: 'rotation', label: 'Rotation' },
]

// Map tab to IMU coverage color on the map
const IMU_TAB_COLORS: Record<string, string> = {
  orientation: '#22c55e',
  acceleration: '#3b82f6',
  rotation: '#f97316',
}

const IMU_TABS = new Set<string>(['orientation', 'acceleration', 'rotation'])

const TAB_TO_IMU_TYPE: Record<string, 'orientation' | 'accel' | 'gyro'> = {
  orientation: 'orientation',
  acceleration: 'accel',
  rotation: 'gyro',
}

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
  vtxTotalSizeBytes?: number
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
  const hasAnalyticsData = hasVtxData && hasFitData && hasGpsData

  const getTabDisabled = useCallback((id: string): boolean => {
    if (id === 'route') return !hasGpsData
    if (id === 'stats') return !(hasFitData && hasGpsData)
    if (ANALYTICS_TAB_IDS.has(id)) return !hasAnalyticsData
    if (IMU_TABS.has(id)) return !hasVtxData
    return false
  }, [hasGpsData, hasFitData, hasAnalyticsData, hasVtxData])

  const migrateTabParam = (param: string | null): string | null => {
    if (param === 'efficiency') return 'stability'
    return param
  }

  const initialMapTab = (() => {
    const param = migrateTabParam(searchParams.get('tab'))
    if (param && VALID_MAP_TABS.has(param) && !getTabDisabled(param)) return param
    return 'route'
  })()

  const initialChartTab = (() => {
    const param = migrateTabParam(searchParams.get('chart'))
    if (param && VALID_CHART_TABS.has(param) && !getTabDisabled(param)) return param
    for (const tab of CHART_TAB_CONFIG) {
      if (!getTabDisabled(tab.id)) return tab.id
    }
    return 'orientation'
  })()

  const [mapTab, setMapTab] = useState(initialMapTab)
  const [chartTab, setChartTab] = useState(initialChartTab)
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

  const handleMapTabChange = useCallback((tab: string) => {
    setMapTab(tab)
    const params = new URLSearchParams(window.location.search)
    params.set('tab', tab)
    window.history.replaceState(null, '', `${pathname}?${params.toString()}`)
  }, [pathname])

  const handleChartTabChange = useCallback((tab: string) => {
    setChartTab(tab)
    const params = new URLSearchParams(window.location.search)
    params.set('chart', tab)
    window.history.replaceState(null, '', `${pathname}?${params.toString()}`)
  }, [pathname])

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
      const response = await authFetch(`/api/rides/${rideId}/reanalyze`, { method: 'POST' })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to trigger reanalysis')
      }
      apiCache.invalidatePattern(rideId)
      window.location.reload()
    } catch (err: any) {
      console.error('Failed to rerun analysis:', err)
      addToast({ type: 'error', title: 'Rerun failed', message: err.message || 'Failed to trigger reanalysis' })
      setRerunning(false)
    }
  }, [authFetch, rideId])

  // Fetch ride samples once - shared between map and charts
  const { samples, loading, error } = useRideSamples(rideId, fitRecordingId)

  // Fetch IMU data once at parent level
  const {
    samples: imuSamples,
    loading: imuLoading,
    error: imuError,
    coverageRanges: imuCoverageRangesFromHook
  } = useIMUData({
    rideId,
    recordings: vtxRecordings,
    dataType: 'accel',
    timeRange: sharedZoomRange,
    skip: !hasVtxData
  })

  // All analytics metrics via centralized hook — lazy-fetched, data-driven
  const metrics = useAnalyticsMetrics({
    rideId,
    fitRecordingId,
    enabled: hasAnalyticsData,
    activeMapTab: mapTab,
    activeChartTab: chartTab,
  })

  // Derived state
  const isMapAnalyticsTab = ANALYTICS_TAB_IDS.has(mapTab)
  const isMapRouteTab = mapTab === 'route'
  const isMapStatsTab = mapTab === 'stats'
  const isChartImuTab = IMU_TABS.has(chartTab)
  const isChartAnalyticsTab = ANALYTICS_TAB_IDS.has(chartTab)

  const anyPolling = isAnyPolling(metrics)
  const anyLoaded = isAnyLoaded(metrics)

  // Track analysis completion for comparison cards refresh
  const [analysisRefreshKey, setAnalysisRefreshKey] = useState(0)
  const prevAnalyticsLoading = useRef(false)

  useEffect(() => {
    if (prevAnalyticsLoading.current && !anyPolling && anyLoaded) {
      setAnalysisRefreshKey(k => k + 1)
    }
    prevAnalyticsLoading.current = anyPolling
  }, [anyPolling, anyLoaded])

  const estimatedAnalysisSeconds = vtxTotalSizeBytes > 0
    ? Math.max(10, Math.round((vtxTotalSizeBytes / (22 * 1024 * 1024)) * 150))
    : null

  const hasOrientationData = !imuLoading && imuSamples.length > 0
    ? imuSamples.some(s => s.roll != null && s.pitch != null)
    : null

  const visibleMapTabs = useMemo(() =>
    MAP_TAB_CONFIG.filter(tab => tab.id !== 'orientation' || hasOrientationData !== false),
    [hasOrientationData]
  )
  const visibleChartTabs = useMemo(() =>
    CHART_TAB_CONFIG.filter(tab => tab.id !== 'orientation' || hasOrientationData !== false),
    [hasOrientationData]
  )

  const imuTimeRanges = useMemo(() => {
    if (imuCoverageRangesFromHook.length > 0) return imuCoverageRangesFromHook
    return getVtxTimeRanges(vtxRecordings)
  }, [imuCoverageRangesFromHook, vtxRecordings])

  // Build map mode string
  const mapMode = isMapRouteTab ? 'route'
    : isMapStatsTab ? 'fitStats'
    : isMapAnalyticsTab ? 'analytics'
    : 'vtx'

  const imuColor = IMU_TAB_COLORS[mapTab]

  // Build analytics overlay for map — uses registry color function
  const analyticsOverlay = useMemo((): AnalyticsOverlay | undefined => {
    if (!isMapAnalyticsTab || isMapRouteTab) return undefined
    const def = ANALYTICS_BY_TAB.get(mapTab)
    const metricState = metrics[mapTab]
    if (!def || !metricState || metricState.samples.length === 0) return undefined
    return {
      samples: metricState.samples,
      getColor: def.getOverlayColor,
    }
  }, [isMapAnalyticsTab, isMapRouteTab, mapTab, metrics])

  const activeMapMetric = metrics[mapTab]
  const activeChartMetric = metrics[chartTab]

  const showRerunButton = hasAnalyticsData && (isMapAnalyticsTab ? !isAnyLoading(metrics) : true)
  const mapAnalyticsLoading = isMapAnalyticsTab && activeMapMetric?.loading

  // Chart stats config
  const chartStatsConfig = CHART_STATS_CONFIG[chartStatsMetric]
  const chartStatsSamples = useMemo(() => {
    if (!samples || samples.length === 0) return []
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

  // Chart config — dispatches to the right builder based on tab type
  const chartConfig = useMemo(() => {
    if (isChartImuTab) return buildIMUChartConfig(imuSamples, TAB_TO_IMU_TYPE[chartTab], sharedZoomRange)
    if (chartTab === 'stats') return buildFitMetricChartConfig(chartStatsSamples, chartStatsConfig)

    // Analytics tab — use registry to find chart builder
    const def = ANALYTICS_BY_TAB.get(chartTab)
    if (def && activeChartMetric) {
      const builder = CHART_BUILDERS[def.chartBuilder]
      if (builder) return builder(activeChartMetric.samples, sharedZoomRange)
    }

    return null
  }, [chartTab, isChartImuTab, imuSamples, activeChartMetric, chartStatsSamples, chartStatsConfig, sharedZoomRange])

  const chartLoading =
    (isChartImuTab && imuLoading) ||
    (isChartAnalyticsTab && activeChartMetric?.loading) ||
    (chartTab === 'stats' && loading)

  const chartError =
    (isChartImuTab && imuError) ||
    (isChartAnalyticsTab && activeChartMetric?.error) ||
    null

  const showAnalysisBanner = hasAnalyticsData && anyPolling

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

          {showRerunButton && (
            <button
              onClick={handleRerunAnalysis}
              disabled={rerunning || !!mapAnalyticsLoading}
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
              analyticsOverlay={analyticsOverlay}
              analyticsLoading={!!activeMapMetric?.loading}
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

      {/* Chart content */}
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

      <RideComparisonCards rideId={rideId} refreshKey={analysisRefreshKey} />

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
