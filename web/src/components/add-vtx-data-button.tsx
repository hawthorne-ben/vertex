'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Loader2, Plus, CheckCircle } from 'lucide-react'
import { useToast } from '@/components/ui/toast-context'
import { formatDurationFromMilliseconds } from '@/lib/utils/formatting'

interface VtxRecording {
  id: string
  filename: string
  start_time: string
  end_time: string
  duration_ms: number
  file_size_bytes: number
  uploaded_at: string
}

interface AddVtxDataButtonProps {
  rideId: string
}

export function AddVtxDataButton({ rideId }: AddVtxDataButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [vtxFiles, setVtxFiles] = useState<VtxRecording[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const { addToast } = useToast()

  const fetchVtxFiles = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) return

      const { data, error } = await supabase
        .from('recordings')
        .select('id, filename, start_time, end_time, duration_ms, file_size_bytes, uploaded_at')
        .eq('user_id', user.id)
        .eq('file_type', 'vtx')
        .eq('status', 'ready')
        .order('start_time', { ascending: false })

      if (error) {
        console.error('Failed to fetch VTX files:', error)
        addToast({
          type: 'error',
          title: 'Failed to load VTX files',
          message: error.message
        })
        return
      }

      setVtxFiles(data || [])
    } catch (error) {
      console.error('Error fetching VTX files:', error)
    } finally {
      setLoading(false)
    }
  }, [addToast])

  // Fetch VTX files when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchVtxFiles()
    }
  }, [isOpen, fetchVtxFiles])

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const handleSubmit = async () => {
    if (selectedIds.size === 0) return

    setSubmitting(true)

    try {
      const response = await fetch(`/api/rides/${rideId}/recordings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          recordingIds: Array.from(selectedIds)
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to associate recordings')
      }

      // Show success toast
      addToast({
        type: 'success',
        title: 'VTX data associated',
        message: result.message || `${result.added} recording(s) added to ride`
      })

      // Close modal and reset
      setIsOpen(false)
      setSelectedIds(new Set())

      // Reload page to show new associations
      window.location.reload()

    } catch (error) {
      console.error('Failed to associate recordings:', error)
      addToast({
        type: 'error',
        title: 'Association failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      setSubmitting(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }

  const formatDuration = formatDurationFromMilliseconds

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <>
      <Button onClick={() => setIsOpen(true)} className="w-full md:w-auto">
        <Plus className="h-4 w-4 mr-2" />
        Add Vertex IMU Data
      </Button>

      {/* Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg max-w-3xl w-full max-h-[80vh] flex flex-col border border-border">
            {/* Header */}
            <div className="p-6 border-b border-border">
              <h2 className="text-2xl font-bold text-primary">Select VTX Data</h2>
              <p className="text-secondary mt-2">
                Choose one or more VTX IMU recordings to associate with this ride
              </p>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-secondary" />
                </div>
              ) : vtxFiles.length === 0 ? (
                <div className="text-center py-12 text-secondary">
                  No VTX files available. Upload VTX data first.
                </div>
              ) : (
                <div className="space-y-3">
                  {vtxFiles.map((vtx) => {
                    const isSelected = selectedIds.has(vtx.id)
                    return (
                      <button
                        key={vtx.id}
                        onClick={() => toggleSelection(vtx.id)}
                        className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                          isSelected
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:border-primary/50 hover:bg-muted'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="font-medium mb-1 text-primary">{vtx.filename}</div>
                            <div className="text-sm text-secondary space-y-1">
                              <div>{formatDate(vtx.start_time)} • {formatDuration(vtx.duration_ms)}</div>
                              <div>{formatFileSize(vtx.file_size_bytes)}</div>
                            </div>
                          </div>
                          {isSelected && (
                            <CheckCircle className="h-6 w-6 text-primary flex-shrink-0 ml-2" />
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-border flex justify-between items-center">
              <div className="text-sm text-secondary">
                {selectedIds.size} file{selectedIds.size !== 1 ? 's' : ''} selected
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsOpen(false)
                    setSelectedIds(new Set())
                  }}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={selectedIds.size === 0 || submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    'Add Selected'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
