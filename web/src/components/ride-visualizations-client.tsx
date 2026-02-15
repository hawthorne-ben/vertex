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
import { getVtxTimeRanges } from '@/lib/sync/fit-vtx-sync'
import { useRideSamples } from './hooks/useRideSamples'
import { useDerivedMetric } from './charts/hooks/useDerivedMetric'

// Unified tab type — the 5 top-level tabs
type ViewTab = 'efficiency' | 'position' | 'orientation' | 'acceleration' | 'rotation'

const TAB_CONFIG: Array<{ id: ViewTab; label: string }> = [
  { id: 'efficiency', label: 'Efficiency' },
  { id: 'position', label: 'Position' },
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

  // Read initial tab from URL query param, fallback to first available tab
  const initialTab = (() => {
    const param = searchParams.get('tab')
    if (param && VALID_TABS.has(param)) {
      const tab = param as ViewTab
      const isAvailable = (ANALYTICS_TABS.includes(tab) && hasAnalyticsData) ||
                          (IMU_TABS.includes(tab) && hasVtxData)
      if (isAvailable) return tab
    }
    // Default: first available tab
    if (hasAnalyticsData) return 'efficiency' as ViewTab
    if (hasVtxData) return 'orientation' as ViewTab
    return 'efficiency' as ViewTab
  })()

  const [activeTab, setActiveTab] = useState<ViewTab>(initialTab)
  const [selectedTime, setSelectedTime] = useState<number | null>(null)
  const [imuCoverageRanges, setImuCoverageRanges] = useState<Array<{ start: number; end: number }>>([])
  const [sharedZoomRange, setSharedZoomRange] = useState<{ start: string; end: string } | null>(null)
  const [mapZoom, setMapZoom] = useState<number | null>(null)

  // Persist tab to URL query param
  const handleTabChange = useCallback((tab: ViewTab) => {
    setActiveTab(tab)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [searchParams, router, pathname])

  // Fetch ride samples once - shared between map and charts
  const { samples, loading, error } = useRideSamples(rideId, fitRecordingId)

  // Determine what to fetch for map overlay
  const isAnalyticsTab = ANALYTICS_TABS.includes(activeTab)
  const isImuTab = IMU_TABS.includes(activeTab)
  const selectedMetric = TAB_TO_METRIC[activeTab] ?? null

  const shouldFetchEfficiency = activeTab === 'efficiency'
  const shouldFetchPosition = activeTab === 'position'

  // Fetch pedaling efficiency data for map overlay (1 Hz to match GPS frequency)
  const {
    samples: efficiencySamples,
    loading: efficiencyLoading
  } = useDerivedMetric({
    rideId,
    metric: 'pedalingEfficiency',
    timeRange: null,
    fitRecordingId,
    resolution: 1,
    enabled: shouldFetchEfficiency
  })

  // Fetch riding position data for map overlay (already at 1 Hz)
  const {
    samples: positionSamplesRaw,
    loading: positionLoading
  } = useDerivedMetric({
    rideId,
    metric: 'ridingPosition',
    timeRange: null,
    fitRecordingId,
    resolution: 1,
    enabled: shouldFetchPosition
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

  // Determine map mode and color based on active tab
  const mapMode = isAnalyticsTab
    ? (selectedMetric as 'pedalingEfficiency' | 'ridingPosition') ?? 'pedalingEfficiency'
    : 'vtx'
  const imuColor = IMU_TAB_COLORS[activeTab]

  return (
    <>
      {/* Top-level tabs — only shown when VTX data exists */}
      {hasVtxData && (
        <div className="mb-4">
          <div className="flex gap-1">
            {TAB_CONFIG.map(tab => {
              // Disable analytics tabs if missing FIT+GPS data
              const disabled = ANALYTICS_TABS.includes(tab.id) && !hasAnalyticsData

              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  disabled={disabled}
                  className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                    activeTab === tab.id
                      ? 'text-primary'
                      : disabled
                        ? 'text-muted-foreground/40 cursor-not-allowed'
                        : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                  {activeTab === tab.id && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
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
              imuTimeRanges={imuTimeRanges}
              imuColor={imuColor}
              samples={samples}
              loading={loading}
              error={error}
              mapMode={mapMode}
              efficiencySamples={efficiencySamples}
              efficiencyLoading={efficiencyLoading}
              positionSamples={positionSamples}
              positionLoading={positionLoading}
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

      {/* Chart content — controlled by active tab, only when VTX data exists */}
      {hasVtxData && (
        <div className="mb-8">
          {isImuTab && (
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
          )}

          {isAnalyticsTab && hasAnalyticsData && (
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
                />
              </CardContent>
            </Card>
          )}

          {isAnalyticsTab && !hasAnalyticsData && (
            <Card>
              <CardContent className="h-[200px] flex items-center justify-center">
                <p className="text-muted-foreground">Analytics require both IMU and GPS data</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

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
