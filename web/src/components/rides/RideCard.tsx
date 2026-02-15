'use client'

import { memo, useCallback } from 'react'
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

      <Link href={`/rides/${ride.id}`} onClick={handleClick} className="block card-interactive rounded-lg p-6">
        <div className="flex items-center mb-2">
          <Bike className="h-5 w-5 mr-2 text-primary" />
          <h3 className="text-lg font-medium text-primary">{ride.name}</h3>
        </div>
        <div className="text-sm text-secondary mb-4">
          {formatDate(ride.start_time)}
        </div>

        {/* Ride Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="flex items-center">
            <MapPin className="h-4 w-4 mr-2 text-secondary" />
            <div>
              <div className="text-sm text-secondary">Distance</div>
              <div className="font-semibold text-primary">{formatDistance(ride.distance_meters)}</div>
            </div>
          </div>
          <div className="flex items-center">
            <TrendingUp className="h-4 w-4 mr-2 text-secondary" />
            <div>
              <div className="text-sm text-secondary">Elevation</div>
              <div className="font-semibold text-primary">{formatElevation(ride.elevation_gain_meters)}</div>
            </div>
          </div>
          <div className="flex items-center">
            <Clock className="h-4 w-4 mr-2 text-secondary" />
            <div>
              <div className="text-sm text-secondary">Duration</div>
              <div className="font-semibold text-primary">{formatDurationSeconds(ride.duration_seconds)}</div>
            </div>
          </div>
          {ride.analysis_results?.avg_speed_mph && (
            <div className="flex items-center">
              <div>
                <div className="text-sm text-secondary">Avg Speed</div>
                <div className="font-semibold text-primary">{ride.analysis_results.avg_speed_mph.toFixed(1)} mph</div>
              </div>
            </div>
          )}
        </div>

        {/* Source FIT file */}
        {ride.fit_filename && (
          <div className="text-xs text-secondary">
            Source: {ride.fit_filename}
          </div>
        )}
      </Link>
    </div>
  )
})
