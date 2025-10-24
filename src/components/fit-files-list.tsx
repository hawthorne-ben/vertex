'use client'

import { useState, useEffect } from 'react'
import { FileText, CheckCircle2, AlertCircle, Loader2, Trash2, Clock, MapPin, Zap, Heart, Activity } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast-context'
import { ConfirmationModal } from '@/components/ui/confirmation-modal'
import { Tooltip } from '@/components/ui/tooltip'

interface FitFile {
  id: string
  filename: string
  file_size_bytes: number
  storage_path: string
  status: 'uploaded' | 'parsing' | 'ready' | 'failed'
  error_message: string | null
  uploaded_at: string
  parsed_at: string | null
  processing_started_at: string | null
  
  // Parsed metadata
  start_time: string | null
  end_time: string | null
  duration_seconds: number | null
  distance_meters: number | null
  distance_feet: number | null
  elevation_gain_meters: number | null
  elevation_gain_feet: number | null
  max_speed_ms: number | null
  avg_speed_ms: number | null
  max_speed_mph: number | null
  avg_speed_mph: number | null
  max_power_watts: number | null
  avg_power_watts: number | null
  max_heart_rate: number | null
  avg_heart_rate: number | null
  max_cadence: number | null
  avg_cadence: number | null
  gps_points_count: number | null
  has_gps_data: boolean | null
}

interface FitFilesListProps {
  files: FitFile[]
  onDataChange?: () => void
}

export function FitFilesList({ files: initialFiles, onDataChange }: FitFilesListProps) {
  const [files, setFiles] = useState(initialFiles)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [fileToDelete, setFileToDelete] = useState<FitFile | null>(null)
  const { addToast } = useToast()

  // Poll for status updates on processing files
  useEffect(() => {
    // Check if there are any files currently processing
    const hasProcessingFiles = files.some(f => f.status === 'uploaded' || f.status === 'parsing')
    
    if (!hasProcessingFiles) {
      // No files processing, don't start polling
      return
    }

    // Poll continuously while any files are processing
    const interval = setInterval(async () => {
      const supabase = createClient()
      
      // Get current list of processing files using latest state
      setFiles(currentFiles => {
        const processingFileIds = currentFiles
          .filter(f => f.status === 'uploaded' || f.status === 'parsing')
          .map(f => f.id)
        
        if (processingFileIds.length === 0) return currentFiles

        // Fetch updates asynchronously
        supabase
          .from('fit_files')
          .select('*')
          .in('id', processingFileIds)
          .then(({ data: updatedFiles, error }) => {
            if (error) {
              console.error('Failed to poll FIT file status:', error)
              return
            }

            if (updatedFiles) {
              setFiles(prev => prev.map(file => {
                const updated = updatedFiles.find(f => f.id === file.id)
                if (updated) {
                  // Log status changes
                  if (updated.status !== file.status) {
                    console.log(`🚴‍♂️ FIT file ${file.filename} status changed: ${file.status} → ${updated.status}`)
                    if (updated.status === 'failed' && updated.error_message) {
                      console.error(`❌ FIT file ${file.filename} failed: ${updated.error_message}`)
                    }
                  }
                }
                return updated || file
              }))
            }
          })
        
        return currentFiles
      })
    }, 2000) // Poll every 2 seconds

    return () => clearInterval(interval)
  }, [files])

  const handleDeleteClick = (file: FitFile) => {
    setFileToDelete(file)
    setShowDeleteModal(true)
  }

  const handleDeleteConfirm = async () => {
    if (!fileToDelete || deleting) return

    setDeleting(fileToDelete.id)
    setShowDeleteModal(false)

    try {
      // Use the admin API endpoint for proper deletion
      const response = await fetch('/api/admin/delete-fit-file', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: fileToDelete.id })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Delete failed')
      }

      const result = await response.json()
      console.log('FIT file delete successful:', result.message)

      // Remove from UI
      setFiles(prev => prev.filter(f => f.id !== fileToDelete.id))
      
      // Notify parent component to refresh data
      if (onDataChange) {
        onDataChange()
      }
      
      // Show success toast
      addToast({
        type: 'success',
        title: 'FIT file deleted',
        message: `${fileToDelete.filename} has been successfully deleted.`
      })
    } catch (err) {
      console.error('FIT file delete error:', err)
      
      // Show error toast
      addToast({
        type: 'error',
        title: 'Delete failed',
        message: `Failed to delete FIT file: ${err instanceof Error ? err.message : 'Unknown error'}`
      })
    } finally {
      setDeleting(null)
      setFileToDelete(null)
    }
  }

  const handleDeleteCancel = () => {
    setShowDeleteModal(false)
    setFileToDelete(null)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }

  const formatDuration = (seconds: number) => {
    if (seconds < 60) {
      return `${seconds}s`
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60)
      const remainingSeconds = Math.floor(seconds % 60)
      return `${minutes}m ${remainingSeconds}s`
    } else {
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      return `${hours}h ${minutes}m`
    }
  }

  const formatDistance = (meters: number) => {
    // Convert meters to miles for imperial units
    const miles = meters * 0.000621371
    if (miles < 0.1) {
      // Show feet for short distances
      const feet = meters * 3.28084
      return `${feet.toFixed(0)}ft`
    } else {
      return `${miles.toFixed(2)}mi`
    }
  }

  const formatSpeed = (ms: number) => {
    // Convert m/s to mph for imperial units
    const mph = ms * 2.23694
    return `${mph.toFixed(1)}mph`
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  if (files.length === 0) {
    return (
      <div className="text-center py-12 border-2 border-dashed border-border rounded-lg">
        <FileText className="w-12 h-12 mx-auto mb-4 text-secondary" />
        <h3 className="text-lg font-medium text-primary mb-2">No FIT files yet</h3>
        <p className="text-secondary mb-6">Upload your first cycling computer file to get started</p>
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
      <div className="space-y-4">
        {files.map((file) => (
          <div
            key={file.id}
            className="card-interactive block p-6 rounded-lg"
          >
            <div className="flex items-start gap-4">
              {/* Status icon with tooltip */}
              <div className="flex-shrink-0 mt-1">
                {file.status === 'parsing' && (
                  <Tooltip content="Parsing FIT file" side="right">
                    <Loader2 className="w-6 h-6 text-info animate-spin" />
                  </Tooltip>
                )}
                {file.status === 'ready' && (
                  <Tooltip content="Ready" side="right">
                    <CheckCircle2 className="w-6 h-6 text-success" />
                  </Tooltip>
                )}
                {file.status === 'failed' && (
                  <Tooltip content="Failed" side="right">
                    <AlertCircle className="w-6 h-6 text-error" />
                  </Tooltip>
                )}
                {file.status === 'uploaded' && (
                  <Tooltip content="Uploaded" side="right">
                    <Clock className="w-6 h-6 text-secondary" />
                  </Tooltip>
                )}
              </div>

              {/* File info */}
              <div className="flex-grow min-w-0">
                <div className="flex items-start justify-between mb-2 gap-3">
                  <h3 className="text-lg font-medium text-primary">
                    {file.start_time && file.end_time ? (
                      <>
                        {(() => {
                          try {
                            const startDate = new Date(file.start_time)
                            const endDate = new Date(file.end_time)
                            
                            // Format: "Oct 24, 7:02 PM → 7:06 PM"
                            const dateStr = startDate.toLocaleDateString(undefined, { 
                              month: 'short', 
                              day: 'numeric'
                            })
                            const startTimeStr = startDate.toLocaleTimeString(undefined, {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true
                            })
                            const endTimeStr = endDate.toLocaleTimeString(undefined, {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true
                            })
                            
                            return `${dateStr}, ${startTimeStr} → ${endTimeStr}`
                          } catch (error) {
                            return 'Invalid Date'
                          }
                        })()}
                      </>
                    ) : file.status === 'parsing' ? (
                      <span className="text-secondary">Processing FIT file...</span>
                    ) : (
                      <span className="text-secondary">Processing...</span>
                    )}
                  </h3>
                  <button
                    onClick={() => handleDeleteClick(file)}
                    disabled={deleting === file.id}
                    className="p-2 text-secondary hover:text-error hover:bg-error/10 transition-colors rounded-md disabled:opacity-50 flex-shrink-0"
                    title="Delete FIT file"
                  >
                    {deleting === file.id ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Trash2 className="w-5 h-5" />
                    )}
                  </button>
                </div>

                {/* Metadata grid - only show for completed files */}
                {file.status === 'ready' && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
                    {file.duration_seconds && (
                      <div>
                        <span className="text-secondary block">Duration</span>
                        <span className="text-primary">
                          {formatDuration(file.duration_seconds)}
                        </span>
                      </div>
                    )}

                    {file.distance_meters && (
                      <div>
                        <span className="text-secondary block">Distance</span>
                        <span className="text-primary">
                          {formatDistance(file.distance_meters)}
                        </span>
                      </div>
                    )}

                    {file.elevation_gain_meters && (
                      <div>
                        <span className="text-secondary block">Elevation</span>
                        <span className="text-primary">
                          +{file.elevation_gain_feet ? `${file.elevation_gain_feet}ft` : `${(file.elevation_gain_meters * 3.28084).toFixed(0)}ft`}
                        </span>
                      </div>
                    )}

                    {file.max_speed_ms && (
                      <div>
                        <span className="text-secondary block">Max Speed</span>
                        <span className="text-primary">
                          {file.max_speed_mph ? `${file.max_speed_mph}mph` : `${(file.max_speed_ms * 2.23694).toFixed(1)}mph`}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Performance metrics - only show for completed files */}
                {file.status === 'ready' && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
                    {file.max_power_watts && (
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-secondary" />
                        <div>
                          <span className="text-secondary block">Max Power</span>
                          <span className="text-primary">
                            {file.max_power_watts}W
                          </span>
                        </div>
                      </div>
                    )}

                    {file.max_heart_rate && (
                      <div className="flex items-center gap-2">
                        <Heart className="w-4 h-4 text-secondary" />
                        <div>
                          <span className="text-secondary block">Max HR</span>
                          <span className="text-primary">
                            {file.max_heart_rate} bpm
                          </span>
                        </div>
                      </div>
                    )}

                    {file.max_cadence && (
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-secondary" />
                        <div>
                          <span className="text-secondary block">Max Cadence</span>
                          <span className="text-primary">
                            {file.max_cadence} rpm
                          </span>
                        </div>
                      </div>
                    )}

                    {file.has_gps_data && (
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-secondary" />
                        <div>
                          <span className="text-secondary block">GPS Points</span>
                          <span className="text-primary">
                            {file.gps_points_count?.toLocaleString() || 'Yes'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Processing status */}
                {file.status === 'parsing' && (
                  <div className="mt-4">
                    <div className="text-sm text-secondary mb-2">
                      <strong className="text-info">Parsing FIT file...</strong>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2.5 mb-2 overflow-hidden">
                      <div 
                        className="bg-info h-2.5 rounded-full transition-all duration-1000 animate-pulse"
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div className="text-xs text-secondary">
                      Extracting GPS track, power, heart rate, and other metrics
                    </div>
                  </div>
                )}

                {/* Error message */}
                {file.status === 'failed' && file.error_message && (
                  <div className="mt-3 p-3 bg-error text-error border-error rounded text-sm">
                    {file.error_message}
                  </div>
                )}

                {/* Source file (de-emphasized) */}
                {file.filename && (
                  <div className="mt-3 text-xs text-secondary">
                    Source: {file.filename} ({formatFileSize(file.file_size_bytes)})
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showDeleteModal}
        onClose={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        type="delete"
        title="Delete FIT File"
        message={fileToDelete ? `Are you sure you want to delete ${fileToDelete.filename}? This will permanently remove the FIT file and all associated data points.` : ''}
        confirmText="Delete"
        cancelText="Cancel"
        isLoading={deleting === fileToDelete?.id}
      />
    </>
  )
}
