'use client'

import { useState, useCallback } from 'react'
import { FileText } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Recording } from '@/types/recordings'
import { useSelection } from '@/hooks/useSelection'
import { useRecordingsPolling } from '@/hooks/useRecordingsPolling'
import { recordingsApi } from '@/lib/api/recordings'
import { useToast } from '@/components/ui/toast-context'
import { ConfirmationModal } from '@/components/ui/confirmation-modal'
import { BatchOperationModal } from '@/components/ui/batch-operation-modal'
import { RecordingCard } from '@/components/recordings/RecordingCard'
import { RecordingsHeader } from '@/components/recordings/RecordingsHeader'
import { generateMergedFilename } from '@/lib/vtx/filename-utils'
import { ErrorBoundary, RecordingCardError } from '@/components/ui/error-boundary'

interface DataFilesListProps {
  files: Recording[]
  onDataChange?: () => void
}

export function DataFilesList({ files: initialFiles, onDataChange }: DataFilesListProps) {
  const router = useRouter()
  const { addToast } = useToast()

  // Use polling hook to keep processing files updated
  const files = useRecordingsPolling(initialFiles)

  // Use selection hook
  const selection = useSelection(files)

  // Operation states
  const [batchOperating, setBatchOperating] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [mergeFilename, setMergeFilename] = useState('')
  const [merging, setMerging] = useState(false)

  // Navigation handler
  const handleNavigate = useCallback((id: string) => {
    router.push(`/recordings/${id}`)
  }, [router])

  // Batch delete handler
  const handleBatchDelete = useCallback(async () => {
    if (selection.count === 0 || batchOperating) return

    setBatchOperating(true)

    try {
      const result = await recordingsApi.batchDelete(Array.from(selection.selectedIds))

      selection.clear()

      addToast({
        type: 'success',
        title: 'Files deleted',
        message: result.message
      })

      if (onDataChange) {
        onDataChange()
      }
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
  }, [selection, batchOperating, addToast, onDataChange])

  // Batch download handler
  const handleBatchDownload = useCallback(async () => {
    if (selection.count === 0 || batchOperating) return

    setBatchOperating(true)

    try {
      const { blob, filename } = await recordingsApi.batchDownload(Array.from(selection.selectedIds))

      // Create download link
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
        message: `Downloading ${selection.count} recording${selection.count > 1 ? 's' : ''}`
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

  // Merge handler
  const handleMerge = useCallback(async () => {
    if (selection.count === 0 || !mergeFilename.trim() || merging) return

    setMerging(true)

    try {
      const result = await recordingsApi.merge(
        Array.from(selection.selectedIds),
        mergeFilename.trim()
      )

      // Show warnings if any
      if (result.warnings && result.warnings.length > 0) {
        console.warn('Merge warnings:', result.warnings)
      }

      addToast({
        type: 'info',
        title: 'Merge started',
        message: 'Files are being merged in the background. Page will refresh when complete.'
      })

      // Start polling for completion (every 3 seconds)
      const pollInterval = setInterval(async () => {
        if (onDataChange) {
          onDataChange()
        }

        // Check if merge is complete
        const isComplete = await recordingsApi.checkMergeComplete(result.filename)

        if (isComplete) {
          // Merge complete, stop polling and refresh
          clearInterval(pollInterval)
          setMerging(false)
          setShowMergeModal(false)
          selection.clear()
          setMergeFilename('')

          addToast({
            type: 'success',
            title: 'Merge complete',
            message: `Created ${result.filename}`
          })

          // Refresh page to show new merged file
          window.location.reload()
        }
      }, 3000)

      // Stop polling after 5 minutes (timeout)
      setTimeout(() => {
        clearInterval(pollInterval)
        if (merging) {
          setMerging(false)
          addToast({
            type: 'warning',
            title: 'Merge timeout',
            message: 'Merge is taking longer than expected. Please refresh the page.'
          })
        }
      }, 300000)

    } catch (err) {
      console.error('Merge error:', err)
      addToast({
        type: 'error',
        title: 'Merge failed',
        message: err instanceof Error ? err.message : 'Unknown error'
      })
      setMerging(false)
      setShowMergeModal(false)
    }
  }, [selection, mergeFilename, merging, addToast, onDataChange])

  // Show merge modal with auto-generated filename
  const showMergeModalHandler = useCallback(() => {
    if (selection.selected.length < 2) return

    // Sort by start time
    const sorted = [...selection.selected].sort((a, b) =>
      (a.start_time || '').localeCompare(b.start_time || '')
    )

    const firstStart = sorted[0].start_time
    const lastEnd = sorted[sorted.length - 1].end_time

    if (firstStart && lastEnd) {
      const suggestedName = generateMergedFilename(firstStart, lastEnd)
      setMergeFilename(suggestedName.replace('.vtx', '')) // Remove extension for input
    } else {
      setMergeFilename('merged')
    }

    setShowMergeModal(true)
  }, [selection.selected])

  // Check if merge is available (all selected are VTX and ready)
  const canMerge = selection.count >= 2 &&
    selection.count <= 10 &&
    selection.selected.every(f => f.status === 'ready')

  // Empty state
  if (files.length === 0) {
    return (
      <div className="text-center py-12 border-2 border-dashed border-border rounded-lg">
        <FileText className="w-12 h-12 mx-auto mb-4 text-secondary" />
        <h3 className="text-lg font-medium text-primary mb-2">No IMU data yet</h3>
        <p className="text-secondary mb-6">Upload your first sensor data to get started</p>
        <a
          href="/upload"
          className="inline-block px-6 py-2 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors rounded-md"
        >
          Upload Data
        </a>
      </div>
    )
  }

  return (
    <>
      {/* Header with selection state and batch actions */}
      <RecordingsHeader
        selectedCount={selection.count}
        selectedFiles={selection.selected}
        canMerge={canMerge}
        batchOperating={batchOperating}
        merging={merging}
        onBatchDownload={handleBatchDownload}
        onBatchDelete={() => setShowDeleteModal(true)}
        onMerge={showMergeModalHandler}
      />

      {/* List of recording cards */}
      <div className="space-y-4">
        {files.map((file) => (
          <ErrorBoundary key={file.id} fallback={<RecordingCardError />}>
            <RecordingCard
              recording={file}
              isSelected={selection.isSelected(file.id)}
              onToggleSelection={selection.toggle}
              onNavigate={handleNavigate}
              inSelectionMode={selection.count > 0}
            />
          </ErrorBoundary>
        ))}
      </div>

      {/* Batch Operation Modals */}
      <BatchOperationModal
        isOpen={showDeleteModal && selection.count > 0}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleBatchDelete}
        files={selection.selected.map(f => ({
          id: f.id,
          filename: f.filename,
          start_time: f.start_time,
          end_time: f.end_time,
          file_size_bytes: f.file_size_bytes
        }))}
        operation="delete"
        isLoading={batchOperating}
      />

      <BatchOperationModal
        isOpen={showMergeModal}
        onClose={() => {
          setShowMergeModal(false)
          setMergeFilename('')
        }}
        onConfirm={handleMerge}
        files={selection.selected.map(f => ({
          id: f.id,
          filename: f.filename,
          start_time: f.start_time,
          end_time: f.end_time,
          file_size_bytes: f.file_size_bytes
        }))}
        operation="merge"
        isLoading={merging}
        filename={mergeFilename}
        onFilenameChange={setMergeFilename}
      />
    </>
  )
}
