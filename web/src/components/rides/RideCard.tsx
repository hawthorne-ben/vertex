'use client'

import { memo, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Bike, Clock, MapPin, TrendingUp, Check } from 'lucide-react'
import Link from 'next/link'
import { Ride } from '@/types/rides'
import { formatDate, formatDistance, formatElevation, formatDurationSeconds } from '@/lib/utils/formatting'

interface RideCardProps {
  ride: Ride & {
    fit_filename?: string | null
  }
  isSelected: boolean
  onToggleSelection: (id: string, e: React.MouseEvent) => void
  inSelectionMode: boolean
}

/**
 * Individual ride card component
 * Extracted from rides-list-client.tsx
 */
export const RideCard = memo(function RideCard({
  ride,
  isSelected,
  onToggleSelection,
  inSelectionMode
}: RideCardProps) {
  const handleToggle = useCallback((e: React.MouseEvent) => {
    onToggleSelection(ride.id, e)
  }, [ride.id, onToggleSelection])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onToggleSelection(ride.id, e as any)
    }
  }, [ride.id, onToggleSelection])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (inSelectionMode) {
      e.preventDefault()
    }
  }, [inSelectionMode])

  return (
    <div className="relative group">
      {/* Checkbox overlay */}
      <div
        className={`absolute top-4 right-4 z-10 transition-opacity ${
          isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <button
          onClick={handleToggle}
          onKeyDown={handleKeyDown}
          className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all ${
            isSelected
              ? 'bg-primary border-primary'
              : 'bg-background border-border hover:border-primary'
          }`}
          aria-label={`Select ${ride.name}`}
          aria-pressed={isSelected}
        >
          {isSelected && <Check className="w-4 h-4 text-primary-foreground" aria-hidden="true" />}
        </button>
      </div>

      <Card className="hover:shadow-lg transition-shadow">
        <Link href={`/rides/${ride.id}`} onClick={handleClick}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <CardTitle className="flex items-center">
                  <Bike className="h-5 w-5 mr-2" />
                  {ride.name}
                </CardTitle>
                <CardDescription>
                  {formatDate(ride.start_time)}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Link>
        <CardContent>
          {/* Ride Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="flex items-center">
              <MapPin className="h-4 w-4 mr-2 text-gray-500" />
              <div>
                <div className="text-sm text-gray-500">Distance</div>
                <div className="font-semibold">{formatDistance(ride.distance_meters)}</div>
              </div>
            </div>
            <div className="flex items-center">
              <TrendingUp className="h-4 w-4 mr-2 text-gray-500" />
              <div>
                <div className="text-sm text-gray-500">Elevation</div>
                <div className="font-semibold">{formatElevation(ride.elevation_gain_meters)}</div>
              </div>
            </div>
            <div className="flex items-center">
              <Clock className="h-4 w-4 mr-2 text-gray-500" />
              <div>
                <div className="text-sm text-gray-500">Duration</div>
                <div className="font-semibold">{formatDurationSeconds(ride.duration_seconds)}</div>
              </div>
            </div>
            {ride.analysis_results?.avg_speed_mph && (
              <div className="flex items-center">
                <div>
                  <div className="text-sm text-gray-500">Avg Speed</div>
                  <div className="font-semibold">{ride.analysis_results.avg_speed_mph.toFixed(1)} mph</div>
                </div>
              </div>
            )}
          </div>

          {/* Source FIT file */}
          {ride.fit_filename && (
            <div className="text-xs text-gray-500">
              Source: {ride.fit_filename}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
})
