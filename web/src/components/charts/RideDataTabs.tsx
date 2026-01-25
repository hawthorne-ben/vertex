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
  fitRecordingId?: string | null

  // Time sync
  highlightTime?: number | null

  className?: string
}

/**
 * Tabbed interface for ride data visualizations
 * Separates raw IMU data from computed analytics
 */
export function RideDataTabs({
  vtxRecordings,
  rideId,
  fitRecordingId,
  highlightTime,
  className = ''
}: RideDataTabsProps) {
  const [activeTab, setActiveTab] = useState<'imu' | 'analytics'>('imu')
  const [isTransitioning, setIsTransitioning] = useState(false)

  // Lift zoom state to parent - prevents race conditions
  const [imuZoomRange, setImuZoomRange] = useState<{ start: string; end: string } | null>(null)
  const [analyticsZoomRange, setAnalyticsZoomRange] = useState<{ start: string; end: string } | null>(null)

  const hasVtxData = vtxRecordings.length > 0
  const hasFitData = !!fitRecordingId

  const handleTabChange = (tab: 'imu' | 'analytics') => {
    if (tab === activeTab) return
    setIsTransitioning(true)
    setActiveTab(tab)
    // Clear transition state after animation
    setTimeout(() => setIsTransitioning(false), 100)
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Tab selector */}
      <div className="flex gap-2 border-b border-border">
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
                zoomRange={imuZoomRange}
                onZoomChange={setImuZoomRange}
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
                fitRecordingId={fitRecordingId}
                highlightTime={highlightTime}
                zoomRange={analyticsZoomRange}
                onZoomChange={setAnalyticsZoomRange}
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
