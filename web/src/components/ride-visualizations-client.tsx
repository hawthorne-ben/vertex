'use client'

import { useState, useMemo, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { TimeSlider } from './time-slider'
import { RideMapClient } from './ride-map-client'
import { RideChartsClient } from './ride-charts-client'
import { IMUSensorChart } from './charts/IMUSensorChart'
import { DerivedMetricsChart } from './charts/DerivedMetricsChart'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'
import { MapErrorBoundary } from './map-error-boundary'
import { ConfirmationModal } from './ui/confirmation-modal'
import { EfficiencyTuningModal } from './dev/efficiency-tuning-modal'
import { getVtxTimeRanges } from '@/lib/sync/fit-vtx-sync'
import { useRideSamples } from './hooks/useRideSamples'
import { useDerivedMetric } from './charts/hooks/useDerivedMetric'
import { useAuthFetch } from '@/hooks/useAuthFetch'
import { apiCache } from '@/lib/cache/api-cache'
import { RideComparisonCards } from '@/components/ride-comparison-cards'
import { RefreshCw, Settings, ChevronDown } from 'lucide-react'
import type { FitStatsMetric } from './ride-map'

// Unified tab type — the 7 top-level tabs
type ViewTab = 'route' | 'efficiency' | 'position' | 'stats' | 'orientation' | 'acceleration' | 'rotation'

const FIT_STATS_OPTIONS: Array<{ id: FitStatsMetric; label: string }> = [
  { id: 'power', label: 'Power' },
  { id: 'cadence', label: 'Cadence' },
  { id: 'hr', label: 'HR' },
  { id: 'speed', label: 'Speed' },
]

const TAB_CONFIG: Array<{ id: ViewTab; label: string }> = [
  { id: 'route', label: 'Route' },
  { id: 'efficiency', label: 'Efficiency' },
  { id: 'position', label: 'Position' },
  { id: 'stats', label: 'Stats' }, // label is dynamic, overridden in render
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
const IMU_TABS: ViewTab[] = ['orientation', 'acceleration', 'rotation']
const ANALYTICS_TABS: ViewTab[] = ['efficiency', 'position']
const ROUTE_TAB: ViewTab = 'route'

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

const VALID_TABS = new Set<string>(TAB_CONFIG.map(t => t.id))

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
  const router = useRouter()
  const pathname = usePathname()

  const hasVtxData = vtxRecordings.length > 0
  const hasFitData = !!fitRecordingId
  // Analytics require both VTX (IMU) and FIT (GPS) data
  const hasAnalyticsData = hasVtxData && hasFitData && hasGpsData

  // Read initial tab from URL query param, fallback to Route
  const initialTab = (() => {
    const param = searchParams.get('tab')
    if (param && VALID_TABS.has(param)) {
      const tab = param as ViewTab
      if (tab === 'route') return tab
      const isAvailable = (ANALYTICS_TABS.includes(tab) && hasAnalyticsData) ||
                          (IMU_TABS.includes(tab) && hasVtxData) ||
                          (tab === 'stats' && hasFitData && hasGpsData)
      if (isAvailable) return tab
    }
    // Default: Route tab
    return 'route' as ViewTab
  })()

  const [activeTab, setActiveTab] = useState<ViewTab>(initialTab)
  const [statsMetric, setStatsMetric] = useState<FitStatsMetric>('power')
  const [statsDropdownOpen, setStatsDropdownOpen] = useState(false)
  const [selectedTime, setSelectedTime] = useState<number | null>(null)
  const [imuCoverageRanges, setImuCoverageRanges] = useState<Array<{ start: number; end: number }>>([])
  const [sharedZoomRange, setSharedZoomRange] = useState<{ start: string; end: string } | null>(null)
  const [mapZoom, setMapZoom] = useState<number | null>(null)
  const [showRerunConfirm, setShowRerunConfirm] = useState(false)
  const [showTuningModal, setShowTuningModal] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const { authFetch } = useAuthFetch()
  const isDev = process.env.NODE_ENV === 'development'

  // Persist tab to URL query param
  const handleTabChange = useCallback((tab: ViewTab) => {
    setActiveTab(tab)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [searchParams, router, pathname])

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

  // Determine what to fetch for map overlay
  const isRouteTab = activeTab === ROUTE_TAB
  const isAnalyticsTab = ANALYTICS_TABS.includes(activeTab)
  const isImuTab = IMU_TABS.includes(activeTab)
  const isStatsTab = activeTab === 'stats'
  const selectedMetric = TAB_TO_METRIC[activeTab] ?? null

  // Lazy-fetch: only start when user visits the tab. Data persists across tab switches
  // (useDerivedMetric no longer clears state on disable).
  const [efficiencyRequested, setEfficiencyRequested] = useState(activeTab === 'efficiency')
  const [positionRequested, setPositionRequested] = useState(activeTab === 'position')

  // Mark metric as requested once user visits its tab (sticky — never goes back to false)
  if (activeTab === 'efficiency' && !efficiencyRequested) setEfficiencyRequested(true)
  if (activeTab === 'position' && !positionRequested) setPositionRequested(true)

  const {
    samples: efficiencySamples,
    loading: efficiencyLoading,
    error: efficiencyError,
    metadata: efficiencyMetadata
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
    metadata: positionMetadata
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
    if (imuCoverageRanges.length > 0) {
      return imuCoverageRanges
    }
    return getVtxTimeRanges(vtxRecordings)
  }, [imuCoverageRanges, vtxRecordings])

  const vtxRecordingsForChart = vtxRecordings

  const getTabDisabled = (id: ViewTab): boolean => {
    if (id === 'route') return !hasGpsData
    if (id === 'stats') return !(hasFitData && hasGpsData)
    if (ANALYTICS_TABS.includes(id)) return !hasAnalyticsData
    if (IMU_TABS.includes(id)) return !hasVtxData
    return false
  }

  // Determine map mode based on active tab
  const getMapMode = (): 'route' | 'fitStats' | 'pedalingEfficiency' | 'ridingPosition' | 'vtx' => {
    if (isRouteTab) return 'route'
    if (isStatsTab) return 'fitStats'
    if (isAnalyticsTab) return (selectedMetric as 'pedalingEfficiency' | 'ridingPosition') ?? 'pedalingEfficiency'
    return 'vtx'
  }
  const mapMode = getMapMode()
  const imuColor = IMU_TAB_COLORS[activeTab]

  // Determine if derived metrics are available (completed, not loading/polling)
  const efficiencyAvailable = hasAnalyticsData && !efficiencyLoading && efficiencySamples.length > 0
  const positionAvailable = hasAnalyticsData && !positionLoading && positionSamplesRaw.length > 0
  const derivedMetricsAvailable = efficiencyAvailable || positionAvailable
  // Show rerun button when on an analytics tab and data is loaded, or always on route tab if analytics data is possible
  const showRerunButton = hasAnalyticsData && (isAnalyticsTab ? !efficiencyLoading && !positionLoading : true)

  // Analytics tabs are loading (polling for Inngest results)
  const analyticsLoading = isAnalyticsTab && (efficiencyLoading || positionLoading)

  return (
    <>
      {/* Top-level tabs + rerun button */}
      <div className="mb-4">
        <div className="flex items-center gap-1">
          {TAB_CONFIG.map(tab => {
            const isStats = tab.id === 'stats'

            const disabled = getTabDisabled(tab.id)

            const isActive = activeTab === tab.id
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
                        handleTabChange('stats')
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
                            if (!isActive) handleTabChange('stats')
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
                onClick={() => handleTabChange(tab.id)}
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
              disabled={rerunning || analyticsLoading}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {rerunning || analyticsLoading ? (
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
              imuTimeRanges={isRouteTab ? [] : imuTimeRanges}
              imuColor={isRouteTab ? undefined : imuColor}
              samples={samples}
              loading={loading}
              error={error}
              mapMode={mapMode}
              efficiencySamples={isRouteTab ? [] : efficiencySamples}
              efficiencyLoading={isRouteTab ? false : efficiencyLoading}
              positionSamples={isRouteTab ? [] : positionSamples}
              positionLoading={isRouteTab ? false : positionLoading}
              fitStatsSamples={isStatsTab ? samples : undefined}
              fitStatsMetric={isStatsTab ? statsMetric : undefined}
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

      {/* Chart content — controlled by active tab */}
      {hasVtxData && isImuTab && (
        <div className="mb-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>
                  {activeTab === 'orientation' ? 'Orientation (BNO055)' :
                   activeTab === 'acceleration' ? 'Accelerometer' : 'Gyroscope'}
                  {vtxRecordings.length > 1 && (
                    <span className="text-sm font-normal text-muted-foreground ml-2">
                      ({vtxRecordings.length} recordings merged)
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  {sharedZoomRange && (
                    <button
                      onClick={() => setSharedZoomRange(null)}
                      className="px-3 py-1.5 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/30 rounded-md transition-colors"
                    >
                      Reset Zoom
                    </button>
                  )}
                  {vtxRecordings.length === 1 && (
                    <a
                      href={`/recordings/${vtxRecordings[0].id}`}
                      className="px-3 py-1 text-sm bg-muted border border-border rounded hover:bg-muted/80 text-foreground"
                    >
                      View Full Detail
                    </a>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <IMUSensorChart
                rideId={rideId}
                recordings={vtxRecordingsForChart}
                dataType={TAB_TO_IMU_TYPE[activeTab]}
                highlightTime={selectedTime}
                zoomRange={sharedZoomRange}
                onZoomChange={setSharedZoomRange}
                onCoverageUpdate={setImuCoverageRanges}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Analytics charts — only render when data is available (not loading/polling) */}
      {isAnalyticsTab && hasAnalyticsData && !analyticsLoading && (
        <div className="mb-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{activeTab === 'efficiency' ? 'Pedaling Efficiency' : 'Riding Position'}</span>
                {sharedZoomRange && (
                  <button
                    onClick={() => setSharedZoomRange(null)}
                    className="px-3 py-1.5 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/30 rounded-md transition-colors"
                  >
                    Reset Zoom
                  </button>
                )}
              </CardTitle>
              <div className="text-sm text-muted-foreground">
                Computed metrics from combined IMU and GPS data
              </div>
            </CardHeader>
            <CardContent>
              <DerivedMetricsChart
                rideId={rideId}
                rideName={rideName}
                fitRecordingId={fitRecordingId}
                selectedMetric={TAB_TO_METRIC[activeTab]}
                highlightTime={selectedTime}
                zoomRange={sharedZoomRange}
                onZoomChange={setSharedZoomRange}
                parentSamples={activeTab === 'efficiency' ? efficiencySamples : positionSamplesRaw}
                parentMetadata={activeTab === 'efficiency' ? efficiencyMetadata : positionMetadata}
                parentLoading={activeTab === 'efficiency' ? efficiencyLoading : positionLoading}
                parentError={activeTab === 'efficiency' ? efficiencyError : positionError}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {isAnalyticsTab && !hasAnalyticsData && (
        <div className="mb-8">
          <Card>
            <CardContent className="h-[200px] flex items-center justify-center">
              <p className="text-muted-foreground">Analytics require both IMU and GPS data</p>
            </CardContent>
          </Card>
        </div>
      )}

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
