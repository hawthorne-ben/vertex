'use client'

import { useState, useMemo, useCallback } from 'react'
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
import { buildIMUChartConfig, buildEfficiencyChartConfig, buildPositionChartConfig, buildFitMetricChartConfig } from '@/lib/charts/processing'
import { useRideSamples } from './hooks/useRideSamples'
import { useIMUData } from './charts/hooks/useIMUData'
import { useDerivedMetric } from './charts/hooks/useDerivedMetric'
import { useAuthFetch } from '@/hooks/useAuthFetch'
import { apiCache } from '@/lib/cache/api-cache'
import { RideComparisonCards } from '@/components/ride-comparison-cards'
import { RefreshCw, Settings, ChevronDown } from 'lucide-react'
import type { FitStatsMetric } from './ride-map'

const UPlotBase = dynamic(
  () => import('./charts/UPlotBase').then(mod => ({ default: mod.UPlotBase })),
  { ssr: false, loading: () => <div className="h-[400px] bg-muted rounded-lg animate-pulse" /> }
)

// Map tab includes Route; chart tab does not
type MapTab = 'route' | 'efficiency' | 'position' | 'stats' | 'orientation' | 'acceleration' | 'rotation'
type ChartTab = 'efficiency' | 'position' | 'stats' | 'orientation' | 'acceleration' | 'rotation'

const FIT_STATS_OPTIONS: Array<{ id: FitStatsMetric; label: string }> = [
  { id: 'power', label: 'Power' },
  { id: 'cadence', label: 'Cadence' },
  { id: 'hr', label: 'HR' },
  { id: 'speed', label: 'Speed' },
]

const MAP_TAB_CONFIG: Array<{ id: MapTab; label: string }> = [
  { id: 'route', label: 'Route' },
  { id: 'efficiency', label: 'Efficiency' },
  { id: 'position', label: 'Position' },
  { id: 'stats', label: 'Stats' },
  { id: 'orientation', label: 'Orientation' },
  { id: 'acceleration', label: 'Acceleration' },
  { id: 'rotation', label: 'Rotation' },
]

const CHART_TAB_CONFIG: Array<{ id: ChartTab; label: string }> = [
  { id: 'efficiency', label: 'Efficiency' },
  { id: 'position', label: 'Position' },
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
const ANALYTICS_TABS = new Set<string>(['efficiency', 'position'])

// Map tab → IMU data type
const TAB_TO_IMU_TYPE: Record<string, 'orientation' | 'accel' | 'gyro'> = {
  orientation: 'orientation',
  acceleration: 'accel',
  rotation: 'gyro',
}

// Map tab → derived metric type
const TAB_TO_METRIC: Record<string, 'pedalingEfficiency' | 'ridingPosition'> = {
  efficiency: 'pedalingEfficiency',
  position: 'ridingPosition',
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
}

export function RideVisualizationsClient({
  rideId,
  rideName,
  rideStartTime,
  rideEndTime,
  fitRecordingId,
  hasGpsData,
  vtxRecordings
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

  // Read initial map tab from URL query param, fallback to Route
  const initialMapTab = (() => {
    const param = searchParams.get('tab')
    if (param && VALID_MAP_TABS.has(param) && !getTabDisabled(param)) {
      return param as MapTab
    }
    return 'route' as MapTab
  })()

  // Read initial chart tab from URL, default to first available
  const initialChartTab = (() => {
    const param = searchParams.get('chart')
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
      alert(`Failed to rerun analysis: ${err.message}`)
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
  const [efficiencyRequested, setEfficiencyRequested] = useState(mapTab === 'efficiency' || chartTab === 'efficiency')
  const [positionRequested, setPositionRequested] = useState(mapTab === 'position' || chartTab === 'position')

  // Mark metric as requested once user visits its tab (sticky — never goes back to false)
  if ((mapTab === 'efficiency' || chartTab === 'efficiency') && !efficiencyRequested) setEfficiencyRequested(true)
  if ((mapTab === 'position' || chartTab === 'position') && !positionRequested) setPositionRequested(true)

  const {
    samples: efficiencySamples,
    loading: efficiencyLoading,
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
    error: positionError,
  } = useDerivedMetric({
    rideId,
    metric: 'ridingPosition',
    timeRange: null,
    fitRecordingId,
    resolution: 1,
    enabled: hasAnalyticsData && positionRequested
  })

  // Cast to position-specific type
  const positionSamples = positionSamplesRaw as Array<{
    timestamp: string
    position: 'standing' | 'seated' | null
    rockingMagnitude: number
    cadence: number | null
    value: number | null
  }>

  // Calculate IMU time ranges for GPS color coding
  const imuTimeRanges = useMemo(() => {
    if (imuCoverageRangesFromHook.length > 0) {
      return imuCoverageRangesFromHook
    }
    return getVtxTimeRanges(vtxRecordings)
  }, [imuCoverageRangesFromHook, vtxRecordings])

  // Determine map mode based on mapTab
  const getMapMode = (): 'route' | 'fitStats' | 'pedalingEfficiency' | 'ridingPosition' | 'vtx' => {
    if (isMapRouteTab) return 'route'
    if (isMapStatsTab) return 'fitStats'
    if (isMapAnalyticsTab) return (selectedMapMetric as 'pedalingEfficiency' | 'ridingPosition') ?? 'pedalingEfficiency'
    return 'vtx'
  }
  const mapMode = getMapMode()
  const imuColor = IMU_TAB_COLORS[mapTab]

  // Show rerun button when on an analytics tab and data is loaded, or always on route tab if analytics data is possible
  const showRerunButton = hasAnalyticsData && (isMapAnalyticsTab ? !efficiencyLoading && !positionLoading : true)

  // Analytics tabs are loading (polling for Inngest results)
  const mapAnalyticsLoading = isMapAnalyticsTab && (efficiencyLoading || positionLoading)

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
    if (chartTab === 'efficiency') return buildEfficiencyChartConfig(efficiencySamples, sharedZoomRange)
    if (chartTab === 'position') return buildPositionChartConfig(positionSamples, sharedZoomRange)
    if (chartTab === 'stats') return buildFitMetricChartConfig(chartStatsSamples, chartStatsConfig)
    return null
  }, [chartTab, isChartImuTab, imuSamples, efficiencySamples, positionSamples, chartStatsSamples, chartStatsConfig, sharedZoomRange])

  const chartLoading =
    (isChartImuTab && imuLoading) ||
    (chartTab === 'efficiency' && efficiencyLoading) ||
    (chartTab === 'position' && positionLoading) ||
    (chartTab === 'stats' && loading)

  const chartError =
    (isChartImuTab && imuError) ||
    (chartTab === 'efficiency' && efficiencyError) ||
    (chartTab === 'position' && positionError) ||
    null

  return (
    <>
      {/* Map tabs */}
      <div className="mb-4">
        <div className="flex items-center gap-1">
          {MAP_TAB_CONFIG.map(tab => {
            const isStats = tab.id === 'stats'
            const disabled = getTabDisabled(tab.id)
            const isActive = mapTab === tab.id
            let stateClass = 'text-muted-foreground hover:text-foreground'
            if (isActive) stateClass = 'text-primary'
            else if (disabled) stateClass = 'text-muted-foreground/40 cursor-not-allowed'
            const baseClass = `px-4 py-2 text-sm font-medium transition-colors relative ${stateClass}`

            // Stats tab renders as a dropdown
            if (isStats) {
              const selectedLabel = FIT_STATS_OPTIONS.find(o => o.id === statsMetric)!.label
              return (
                <div key={tab.id} className="relative">
                  <button
                    onClick={() => {
                      if (disabled) return
                      if (!isActive) {
                        handleMapTabChange('stats')
                      } else {
                        setStatsDropdownOpen(prev => !prev)
                      }
                    }}
                    onBlur={() => setTimeout(() => setStatsDropdownOpen(false), 150)}
                    disabled={disabled}
                    className={`${baseClass} inline-flex items-center gap-1`}
                  >
                    {selectedLabel}
                    <ChevronDown className={`w-3 h-3 transition-transform ${statsDropdownOpen ? 'rotate-180' : ''}`} />
                    {isActive && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                    )}
                  </button>
                  {statsDropdownOpen && (
                    <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-md py-1 min-w-[120px]">
                      {FIT_STATS_OPTIONS.map(option => (
                        <button
                          key={option.id}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            setStatsMetric(option.id)
                            setStatsDropdownOpen(false)
                            if (!isActive) handleMapTabChange('stats')
                          }}
                          className={`w-full text-left px-4 py-2 text-sm hover:bg-accent transition-colors ${
                            option.id === statsMetric ? 'text-primary' : 'text-foreground'
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
          {CHART_TAB_CONFIG.map(tab => {
            const isStats = tab.id === 'stats'
            const disabled = getTabDisabled(tab.id)
            const isActive = chartTab === tab.id

            let stateClass = 'text-muted-foreground hover:text-foreground'
            if (isActive) stateClass = 'text-primary'
            else if (disabled) stateClass = 'text-muted-foreground/40 cursor-not-allowed'

            // Stats chart tab renders as a dropdown
            if (isStats) {
              const selectedLabel = FIT_STATS_OPTIONS.find(o => o.id === chartStatsMetric)!.label
              return (
                <div key={tab.id} className="relative">
                  <button
                    onClick={() => {
                      if (disabled) return
                      if (!isActive) {
                        handleChartTabChange('stats')
                      } else {
                        setChartStatsDropdownOpen(prev => !prev)
                      }
                    }}
                    onBlur={() => setTimeout(() => setChartStatsDropdownOpen(false), 150)}
                    disabled={disabled}
                    className={`px-4 py-2 text-sm font-medium transition-colors relative inline-flex items-center gap-1 ${stateClass}`}
                  >
                    {selectedLabel}
                    <ChevronDown className={`w-3 h-3 transition-transform ${chartStatsDropdownOpen ? 'rotate-180' : ''}`} />
                    {isActive && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                    )}
                  </button>
                  {chartStatsDropdownOpen && (
                    <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-md py-1 min-w-[120px]">
                      {FIT_STATS_OPTIONS.map(option => (
                        <button
                          key={option.id}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            setChartStatsMetric(option.id)
                            setChartStatsDropdownOpen(false)
                            if (!isActive) handleChartTabChange('stats')
                          }}
                          className={`w-full text-left px-4 py-2 text-sm hover:bg-accent transition-colors ${
                            option.id === chartStatsMetric ? 'text-primary' : 'text-foreground'
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
      <RideComparisonCards rideId={rideId} />

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
