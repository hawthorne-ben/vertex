'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Bike, Clock, MapPin, TrendingUp, Trash2, Download, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast-context'
import { ConfirmationModal } from '@/components/ui/confirmation-modal'
import { formatDurationFromSeconds } from '@/lib/utils/format-duration'

interface Ride {
  id: string
  name: string
  start_time: string
  end_time: string
  duration_seconds: number
  distance_meters: number | null
  elevation_gain_meters: number | null
  created_at: string
  fit_recording_id: string | null
  fit_filename: string | null
  fit_storage_path: string | null
  analysis_results: any
}

interface RidesListClientProps {
  rides: Ride[]
}

export function RidesListClient({ rides: initialRides }: RidesListClientProps) {
  const [rides, setRides] = useState(initialRides)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [rideToDelete, setRideToDelete] = useState<Ride | null>(null)
  const { addToast } = useToast()

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatDistance = (meters: number | null) => {
    if (!meters) return 'N/A'
    const miles = meters * 0.000621371
    return `${miles.toFixed(1)} mi`
  }

  const formatElevation = (meters: number | null) => {
    if (!meters) return 'N/A'
    const feet = meters * 3.28084
    return `${feet.toFixed(0)} ft`
  }

  const handleDeleteClick = (ride: Ride, event: React.MouseEvent) => {
    event.preventDefault()
    setRideToDelete(ride)
    setShowDeleteModal(true)
  }

  const handleDeleteConfirm = async () => {
    if (!rideToDelete || deleting) return

    setDeleting(rideToDelete.id)
    setShowDeleteModal(false)

    try {
      const response = await fetch(`/api/rides/${rideToDelete.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Delete failed')
      }

      // Remove from UI
      setRides(prev => prev.filter(r => r.id !== rideToDelete.id))

      addToast({
        type: 'success',
        title: 'Ride deleted',
        message: `${rideToDelete.name} has been successfully deleted.`
      })
    } catch (err) {
      console.error('Delete error:', err)
      addToast({
        type: 'error',
        title: 'Delete failed',
        message: `Failed to delete ride: ${err instanceof Error ? err.message : 'Unknown error'}`
      })
    } finally {
      setDeleting(null)
      setRideToDelete(null)
    }
  }

  const handleDeleteCancel = () => {
    setShowDeleteModal(false)
    setRideToDelete(null)
  }

  const handleDownload = async (ride: Ride, event: React.MouseEvent) => {
    event.preventDefault()

    if (downloading || !ride.fit_storage_path) return

    setDownloading(ride.id)

    try {
      const supabase = createClient()

      const { data, error } = await supabase.storage
        .from('recordings')
        .download(ride.fit_storage_path)

      if (error || !data) {
        throw new Error(error?.message || 'Failed to download file')
      }

      const url = URL.createObjectURL(data)
      const a = document.createElement('a')
      a.href = url
      a.download = ride.fit_filename || 'ride.fit'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      addToast({
        type: 'success',
        title: 'Download started',
        message: `Downloading ${ride.fit_filename}`
      })
    } catch (err) {
      console.error('Download error:', err)
      addToast({
        type: 'error',
        title: 'Download failed',
        message: `Failed to download file: ${err instanceof Error ? err.message : 'Unknown error'}`
      })
    } finally {
      setDownloading(null)
    }
  }

  return (
    <>
      {rides && rides.length > 0 ? (
        <div className="grid gap-6">
          {rides.map((ride) => (
            <Card key={ride.id} className="hover:shadow-lg transition-shadow">
              <Link href={`/rides/${ride.id}`}>
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
                    <div className="flex gap-2" onClick={(e) => e.preventDefault()}>
                      {ride.fit_storage_path && (
                        <button
                          onClick={(e) => handleDownload(ride, e)}
                          disabled={downloading === ride.id}
                          className="p-2 text-secondary hover:text-primary hover:bg-primary/10 transition-colors rounded-md disabled:opacity-50 flex-shrink-0"
                          title="Download FIT file"
                        >
                          {downloading === ride.id ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <Download className="h-5 w-5" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={(e) => handleDeleteClick(ride, e)}
                        disabled={deleting === ride.id}
                        className="p-2 text-secondary hover:text-error hover:bg-error/10 transition-colors rounded-md disabled:opacity-50 flex-shrink-0"
                        title="Delete ride"
                      >
                        {deleting === ride.id ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Trash2 className="h-5 w-5" />
                        )}
                      </button>
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
                      <div className="font-semibold">{formatDurationFromSeconds(ride.duration_seconds)}</div>
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
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="text-center py-12">
            <Bike className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Rides Yet</h3>
            <p className="text-gray-600 mb-6">
              Upload a FIT file to create your first ride.
            </p>
            <Link href="/upload">
              <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">
                Upload FIT File
              </button>
            </Link>
          </CardContent>
        </Card>
      )}

      <ConfirmationModal
        isOpen={showDeleteModal}
        onClose={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        type="delete"
        title="Delete Ride"
        message={rideToDelete ? `Are you sure you want to delete "${rideToDelete.name}"? This will permanently delete the ride and its associated FIT file from storage.` : ''}
        confirmText="Delete Ride"
      />
    </>
  )
}
