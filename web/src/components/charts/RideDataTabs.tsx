'use client'

import { useState } from 'react'
import { IMUSensorChart } from './IMUSensorChart'
import { DerivedMetricsChart } from './DerivedMetricsChart'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { IMUSample } from './hooks/useIMUData'

export interface RideDataTabsProps {
  // VTX data
  vtxRecordings: Array<{
    id: string
    start_time: string
    end_time: string
  }>

  // Ride data (for derived metrics)
  rideId: string
  rideName?: string
  fitRecordingId?: string | null

  // Time sync
  highlightTime?: number | null

  // Coverage callback
  onCoverageUpdate?: (coverage: Array<{ start: number; end: number }>) => void

  // Shared zoom state (synced with FIT charts)
  zoomRange?: { start: string; end: string } | null
  onZoomChange?: (range: { start: string; end: string } | null) => void

  // Tab change callback (for map overlay sync)
  onTabChange?: (tab: 'imu' | 'analytics') => void

  // Selected metric callback (for map overlay sync)
  onMetricChange?: (metric: string | null) => void

  className?: string
}

/**
 * Tabbed interface for ride data visualizations
 * Separates raw IMU data from computed analytics
 */
export function RideDataTabs({
  vtxRecordings,
  rideId,
  rideName,
  fitRecordingId,
  highlightTime,
  onCoverageUpdate,
  zoomRange: sharedZoomRange,
  onZoomChange: sharedZoomChange,
  onTabChange,
  onMetricChange,
  className = ''
}: RideDataTabsProps) {
  const [activeTab, setActiveTab] = useState<'imu' | 'analytics'>('imu')
  const [isTransitioning, setIsTransitioning] = useState(false)

  // Use shared zoom range for both tabs (synced)
  const currentZoomRange = sharedZoomRange

  const hasVtxData = vtxRecordings.length > 0
  const hasFitData = !!fitRecordingId

  const handleTabChange = (tab: 'imu' | 'analytics') => {
    if (tab === activeTab) return
    setIsTransitioning(true)
    setActiveTab(tab)
    onTabChange?.(tab) // Notify parent for map overlay sync
    // Clear transition state after animation
    setTimeout(() => setIsTransitioning(false), 100)
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Tab selector with reset zoom button */}
      <div className="flex items-center justify-between border-b border-border">
        <div className="flex gap-2">
          <button
            onClick={() => handleTabChange('imu')}
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${
              activeTab === 'imu'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            disabled={isTransitioning}
          >
            IMU Data
            {activeTab === 'imu' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
          <button
            onClick={() => handleTabChange('analytics')}
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${
              activeTab === 'analytics'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            disabled={!hasFitData || isTransitioning}
          >
            Analytics
            {activeTab === 'analytics' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        </div>

        {/* Reset zoom button */}
        {currentZoomRange && sharedZoomChange && (
          <button
            onClick={() => sharedZoomChange(null)}
            className="px-3 py-1.5 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/30 rounded-md transition-colors"
          >
            Reset Zoom
          </button>
        )}
      </div>

      {/* Tab content - Only mount active tab to prevent race conditions */}
      {activeTab === 'imu' ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>
                IMU Data
                {vtxRecordings.length > 1 && (
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    ({vtxRecordings.length} recordings merged)
                  </span>
                )}
              </span>
              {vtxRecordings.length === 1 && (
                <a
                  href={`/recordings/${vtxRecordings[0].id}`}
                  className="px-3 py-1 text-sm bg-muted border border-border rounded hover:bg-muted/80 text-foreground"
                >
                  View Full Detail
                </a>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasVtxData ? (
              <IMUSensorChart
                rideId={rideId}
                recordings={vtxRecordings}
                highlightTime={highlightTime}
                zoomRange={currentZoomRange}
                onZoomChange={sharedZoomChange}
                onCoverageUpdate={onCoverageUpdate}
              />
            ) : (
              <div className="h-[400px] bg-muted rounded-lg flex items-center justify-center">
                <p className="text-muted-foreground">No IMU data available</p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : activeTab === 'analytics' ? (
        <Card>
          <CardHeader>
            <CardTitle>Derived Analytics</CardTitle>
            <div className="text-sm text-muted-foreground">
              Computed metrics from combined IMU and GPS data
            </div>
          </CardHeader>
          <CardContent>
            {hasFitData ? (
              <DerivedMetricsChart
                rideId={rideId}
                rideName={rideName}
                fitRecordingId={fitRecordingId}
                highlightTime={highlightTime}
                zoomRange={currentZoomRange}
                onZoomChange={sharedZoomChange}
                onMetricChange={onMetricChange}
              />
            ) : (
              <div className="h-[400px] bg-muted rounded-lg flex items-center justify-center">
                <p className="text-muted-foreground">Analytics require GPS data (FIT file)</p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
