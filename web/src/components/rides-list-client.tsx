'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Bike, Clock, MapPin, TrendingUp, Trash2, Download, Loader2, Check } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast-context'
import { BatchOperationModal } from '@/components/ui/batch-operation-modal'
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [batchOperating, setBatchOperating] = useState(false)
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

  // Selection handlers
  const toggleSelection = (id: string, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()

    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  // Batch operations
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0 || batchOperating) return

    setBatchOperating(true)

    try {
      const response = await fetch('/api/rides/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rideIds: Array.from(selectedIds) })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Delete failed')
      }

      const result = await response.json()

      setRides(prev => prev.filter(r => !selectedIds.has(r.id)))
      setSelectedIds(new Set())

      addToast({
        type: 'success',
        title: 'Rides deleted',
        message: result.message
      })
    } catch (err) {
      console.error('Batch delete error:', err)
      addToast({
        type: 'error',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setBatchOperating(false)
      setShowDeleteModal(false)
    }
  }

  const handleBatchDownload = async () => {
    if (selectedIds.size === 0 || batchOperating) return

    setBatchOperating(true)

    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        throw new Error('Not authenticated')
      }

      const response = await fetch('/api/rides/batch-download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ rideIds: Array.from(selectedIds) })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Download failed')
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'rides.zip'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setSelectedIds(new Set())

      addToast({
        type: 'success',
        title: 'Download started',
        message: `Downloading ${selectedIds.size} ride${selectedIds.size > 1 ? 's' : ''}`
      })
    } catch (err) {
      console.error('Batch download error:', err)
      addToast({
        type: 'error',
        title: 'Download failed',
        message: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setBatchOperating(false)
    }
  }

  const selectedRides = rides.filter(r => selectedIds.has(r.id))

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
      {/* Page header with sticky selection bar */}
      <div className="sticky top-[100px] z-40 -mx-4 md:-mx-6 px-4 md:px-6 pt-4 pb-4 mb-4 glass-header">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-normal text-primary mb-2">Rides</h1>

          {/* Selection bar or subtitle */}
          {selectedIds.size > 0 ? (
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm text-secondary">
                {selectedIds.size} ride{selectedIds.size !== 1 ? 's' : ''} selected
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={handleBatchDownload}
                  disabled={batchOperating}
                  className="px-3 py-1.5 bg-background hover:bg-muted transition-colors rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-none"
                >
                  <Download className="w-4 h-4" />
                  Download ({selectedIds.size})
                </button>
                <button
                  onClick={() => setShowDeleteModal(true)}
                  disabled={batchOperating}
                  className="px-3 py-1.5 bg-background hover:bg-error/10 hover:text-error transition-colors rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-none"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete ({selectedIds.size})
                </button>
              </div>
            </div>
          ) : (
            <p className="text-secondary">
              View and analyze your cycling activities from FIT files
            </p>
          )}
        </div>
      </div>

      {rides && rides.length > 0 ? (
        <div className="grid gap-6">
          {rides.map((ride) => (
            <div key={ride.id} className="relative group">
              {/* Checkbox overlay */}
              <div
                className={`absolute top-4 right-4 z-10 transition-opacity ${
                  selectedIds.has(ride.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <button
                  onClick={(e) => toggleSelection(ride.id, e)}
                  className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all ${
                    selectedIds.has(ride.id)
                      ? 'bg-primary border-primary'
                      : 'bg-background border-border hover:border-primary'
                  }`}
                >
                  {selectedIds.has(ride.id) && (
                    <Check className="w-4 h-4 text-primary-foreground" />
                  )}
                </button>
              </div>

              <Card className="hover:shadow-lg transition-shadow">
                <Link
                  href={`/rides/${ride.id}`}
                  onClick={(e) => {
                    if (selectedIds.size > 0) {
                      e.preventDefault()
                    }
                  }}
                >
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
          </div>
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

      {/* Batch Operation Modal */}
      <BatchOperationModal
        isOpen={showDeleteModal && selectedIds.size > 0}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleBatchDelete}
        files={selectedRides.map(r => ({
          id: r.id,
          filename: r.name,
          start_time: r.start_time,
          end_time: r.end_time,
          file_size_bytes: 0
        }))}
        operation="delete"
        isLoading={batchOperating}
      />
    </>
  )
}
