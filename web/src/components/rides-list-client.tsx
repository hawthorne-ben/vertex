'use client'

import { useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Bike } from 'lucide-react'
import Link from 'next/link'
import { useSelection } from '@/hooks/useSelection'
import { ridesApi } from '@/lib/api/rides'
import { useToast } from '@/components/ui/toast-context'
import { BatchOperationModal } from '@/components/ui/batch-operation-modal'
import { RideCard } from '@/components/rides/RideCard'
import { RidesHeader } from '@/components/rides/RidesHeader'
import { Ride } from '@/types/rides'
import { ErrorBoundary, RideCardError } from '@/components/ui/error-boundary'

interface RideWithFitFile extends Ride {
  fit_filename: string | null
  fit_storage_path: string | null
}

interface RidesListClientProps {
  rides: RideWithFitFile[]
}

export function RidesListClient({ rides: initialRides }: RidesListClientProps) {
  const { addToast } = useToast()
  const [rides, setRides] = useState(initialRides)

  // Use selection hook
  const selection = useSelection(rides)

  // Operation states
  const [batchOperating, setBatchOperating] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  // Batch delete handler
  const handleBatchDelete = useCallback(async () => {
    if (selection.count === 0 || batchOperating) return

    setBatchOperating(true)

    try {
      const result = await ridesApi.batchDelete(Array.from(selection.selectedIds))

      setRides(prev => prev.filter(r => !selection.selectedIds.has(r.id)))
      selection.clear()

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
  }, [selection, batchOperating, addToast])

  // Batch download handler
  const handleBatchDownload = useCallback(async () => {
    if (selection.count === 0 || batchOperating) return

    setBatchOperating(true)

    try {
      const { blob, filename } = await ridesApi.batchDownload(Array.from(selection.selectedIds))

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      selection.clear()

      addToast({
        type: 'success',
        title: 'Download started',
        message: `Downloading ${selection.count} ride${selection.count > 1 ? 's' : ''}`
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
  }, [selection, batchOperating, addToast])

  // Empty state
  if (rides.length === 0) {
    return (
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
    )
  }

  return (
    <>
      {/* Header with selection state and batch actions */}
      <RidesHeader
        selectedCount={selection.count}
        batchOperating={batchOperating}
        onBatchDownload={handleBatchDownload}
        onBatchDelete={() => setShowDeleteModal(true)}
      />

      {/* Grid of ride cards */}
      <div className="grid gap-6">
        {rides.map((ride) => (
          <ErrorBoundary key={ride.id} fallback={<RideCardError />}>
            <RideCard
              ride={ride}
              isSelected={selection.isSelected(ride.id)}
              onToggleSelection={selection.toggle}
              inSelectionMode={selection.count > 0}
            />
          </ErrorBoundary>
        ))}
      </div>

      {/* Batch Operation Modal */}
      <BatchOperationModal
        isOpen={showDeleteModal && selection.count > 0}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleBatchDelete}
        files={selection.selected.map(r => ({
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
