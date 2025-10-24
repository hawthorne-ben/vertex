'use client'

import { useState, useEffect, useRef } from 'react'
import { FileText, CheckCircle2, AlertCircle, Loader2, Trash2, Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast-context'
import { ConfirmationModal } from '@/components/ui/confirmation-modal'
import { Tooltip } from '@/components/ui/tooltip'

// Client-side component for dynamic time display to prevent hydration issues
function ProcessingTimeDisplay({ uploadedAt }: { uploadedAt: string }) {
  const [timeElapsed, setTimeElapsed] = useState('Processing...')

  useEffect(() => {
    const updateTime = () => {
      try {
        const uploadTime = new Date(uploadedAt)
        const processingTime = new Date().getTime() - uploadTime.getTime()
        const minutes = Math.floor(processingTime / 60000)
        const seconds = Math.floor((processingTime % 60000) / 1000)
        setTimeElapsed(`Processing... (${minutes}m ${seconds}s)`)
      } catch (error) {
        setTimeElapsed('Processing...')
      }
    }

    // Update immediately
    updateTime()
    
    // Update every second
    const interval = setInterval(updateTime, 1000)
    
    return () => clearInterval(interval)
  }, [uploadedAt])

  return <span className="text-info">{timeElapsed}</span>
}

// Client-side component for progress bar time display
function ProgressTimeDisplay({ uploadedAt }: { uploadedAt: string }) {
  const [timeElapsed, setTimeElapsed] = useState('Processing...')

  useEffect(() => {
    const updateTime = () => {
      try {
        const uploadTime = new Date(uploadedAt)
        const processingTime = new Date().getTime() - uploadTime.getTime()
        const minutes = Math.floor(processingTime / 60000)
        setTimeElapsed(`${minutes}m elapsed`)
      } catch (error) {
        setTimeElapsed('Processing...')
      }
    }

    // Update immediately
    updateTime()
    
    // Update every second
    const interval = setInterval(updateTime, 1000)
    
    return () => clearInterval(interval)
  }, [uploadedAt])

  return <span className="text-info">{timeElapsed}</span>
}

// Client-side component for elapsed time display (prevents hydration mismatch)
function ElapsedTimeDisplay({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState('Downloading and parsing CSV...')

  useEffect(() => {
    const updateElapsed = () => {
      try {
        const start = new Date(startTime).getTime()
        const elapsedSeconds = Math.floor((Date.now() - start) / 1000)
        setElapsed(`Downloading and parsing CSV... (${elapsedSeconds}s elapsed)`)
      } catch (error) {
        setElapsed('Downloading and parsing CSV...')
      }
    }

    // Update immediately
    updateElapsed()
    
    // Update every second
    const interval = setInterval(updateElapsed, 1000)
    
    return () => clearInterval(interval)
  }, [startTime])

  return <span>{elapsed}</span>
}

interface IMUDataFile {
  id: string
  user_id: string
  filename: string
  file_size_bytes: number
  storage_path: string
  start_time: string | null
  end_time: string | null
  sample_rate: number | null
  sample_count: number | null
  status: 'uploaded' | 'parsing' | 'ready' | 'failed'
  error_message: string | null
  uploaded_at: string
  parsed_at: string | null
  samples_processed: number | null
  last_checkpoint_at: string | null
  processing_started_at: string | null
}

interface DataFilesListProps {
  files: IMUDataFile[]
}

export function DataFilesList({ files: initialFiles }: DataFilesListProps) {
  const [files, setFiles] = useState(initialFiles)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [fileToDelete, setFileToDelete] = useState<IMUDataFile | null>(null)
  const timeEstimatesRef = useRef<Record<string, number[]>>({}) // Use ref to avoid render-time state updates
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
          .from('imu_data_files')
          .select('*')
          .in('id', processingFileIds)
          .then(({ data: updatedFiles, error }) => {
            if (error) {
              console.error('Failed to poll file status:', error)
              return
            }

            if (updatedFiles) {
              setFiles(prev => prev.map(file => {
                const updated = updatedFiles.find(f => f.id === file.id)
                if (updated) {
                  // Log status changes
                  if (updated.status !== file.status) {
                    console.log(`📊 File ${file.filename} status changed: ${file.status} → ${updated.status}`)
                    if (updated.status === 'failed' && updated.error_message) {
                      console.error(`❌ File ${file.filename} failed: ${updated.error_message}`)
                    }
                  }
                  // Log progress updates
                  if (updated.samples_processed !== file.samples_processed && updated.samples_processed) {
                    console.log(`📈 File ${file.filename} progress: ${updated.samples_processed.toLocaleString()} samples`)
                  }
                }
                return updated || file
              }))
            }
          })
        
        return currentFiles
      })
    }, 2000) // Poll every 2 seconds for more responsive progress updates

    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.length, files.some(f => f.status === 'uploaded' || f.status === 'parsing')]) // Restart when files are added or processing status changes

  const handleDeleteClick = (file: IMUDataFile) => {
    setFileToDelete(file)
    setShowDeleteModal(true)
  }

  const handleDeleteConfirm = async () => {
    if (!fileToDelete || deleting) return

    setDeleting(fileToDelete.id)
    setShowDeleteModal(false)

    try {
      // Use the admin API endpoint for proper deletion
      const response = await fetch('/api/admin/delete-file', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: fileToDelete.id })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Delete failed')
      }

      const result = await response.json()
      console.log('Delete successful:', result.message)

      // Remove from UI
      setFiles(prev => prev.filter(f => f.id !== fileToDelete.id))
      
      // Show success toast
      addToast({
        type: 'success',
        title: 'File deleted',
        message: `${fileToDelete.filename} has been successfully deleted.`
      })
    } catch (err) {
      console.error('Delete error:', err)
      
      // Show error toast
      addToast({
        type: 'error',
        title: 'Delete failed',
        message: `Failed to delete file: ${err instanceof Error ? err.message : 'Unknown error'}`
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

  const formatDuration = (startTime: string, endTime: string) => {
    const start = new Date(startTime).getTime()
    const end = new Date(endTime).getTime()
    const durationSeconds = (end - start) / 1000
    
    if (durationSeconds < 60) {
      return `${durationSeconds.toFixed(1)}s`
    } else if (durationSeconds < 3600) {
      const minutes = Math.floor(durationSeconds / 60)
      const seconds = Math.floor(durationSeconds % 60)
      return `${minutes}m ${seconds}s`
    } else {
      const hours = Math.floor(durationSeconds / 3600)
      const minutes = Math.floor((durationSeconds % 3600) / 60)
      return `${hours}h ${minutes}m`
    }
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
      <div className="space-y-4">
        {files.map((file) => (
        <a
          key={file.id}
          href={`/data/${file.id}`}
          className="card-interactive block p-6 rounded-lg"
        >
          <div className="flex items-start gap-4">
            {/* Status icon with tooltip */}
            <div className="flex-shrink-0 mt-1">
              {file.status === 'parsing' && (
                <Tooltip content="Parsing" side="right">
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

            {/* Data segment info */}
            <div className="flex-grow min-w-0">
              <div className="flex items-start justify-between mb-2 gap-3">
                <h3 className="text-lg font-medium text-primary">
                  {file.start_time && file.end_time ? (
                    <>
                      {(() => {
                        try {
                          return new Date(file.start_time).toLocaleDateString('en-US', { 
                            month: 'short', 
                            day: 'numeric', 
                            year: 'numeric'
                          })
                        } catch (error) {
                          return 'Invalid Date'
                        }
                      })()}
                      {' → '}
                      {(() => {
                        try {
                          return new Date(file.end_time).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit'
                          })
                        } catch (error) {
                          return 'Invalid Time'
                        }
                      })()}
                    </>
                  ) : file.status === 'parsing' ? (
                    // For small files, show simple processing text (detailed progress shown below)
                    file.file_size_bytes && file.file_size_bytes <= 10 * 1024 * 1024 ? (
                      <span className="text-secondary">Processing...</span>
                    ) : (
                      <ProcessingTimeDisplay uploadedAt={file.uploaded_at} />
                    )
                  ) : (
                    <span className="text-secondary">Processing...</span>
                  )}
                </h3>
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    handleDeleteClick(file)
                  }}
                  disabled={deleting === file.id}
                  className="p-2 text-secondary hover:text-error hover:bg-error/10 transition-colors rounded-md disabled:opacity-50 flex-shrink-0"
                  title="Delete segment"
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
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  {file.sample_count && (
                    <div>
                      <span className="text-secondary block">Samples</span>
                      <span className="text-primary">
                        {file.sample_count.toLocaleString()}
                      </span>
                    </div>
                  )}

                  {file.sample_rate && (
                    <div>
                      <span className="text-secondary block">Sample Rate</span>
                      <span className="text-primary">
                        {file.sample_rate} Hz
                      </span>
                    </div>
                  )}

                  {file.start_time && file.end_time && (
                    <div>
                      <span className="text-secondary block">Duration</span>
                      <span className="text-primary">
                        {formatDuration(file.start_time, file.end_time)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Source file (de-emphasized) */}
              {file.filename && (
                <div className="mt-3 text-xs text-secondary">
                  Source: {file.filename} ({formatFileSize(file.file_size_bytes)})
                </div>
              )}

              {/* Processing progress indicator */}
              {file.status === 'parsing' && (
                <div className="mt-4">
                  {file.samples_processed != null && file.samples_processed > 0 && file.sample_count && file.sample_count > 0 ? (
                    // Real progress tracking available (batch processing has started)
                    <>
                      <div className="flex justify-between items-center text-sm mb-2">
                        <span className="text-secondary">Processing samples...</span>
                        <span className="text-primary font-mono font-semibold">
                          {Math.min(100, Math.round((file.samples_processed / file.sample_count) * 100))}%
                        </span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2.5 mb-2">
                        <div 
                          className="bg-info h-2.5 rounded-full transition-all duration-500"
                          style={{ 
                            width: `${Math.min(100, (file.samples_processed / file.sample_count) * 100)}%` 
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-secondary">
                        <span>
                          {file.samples_processed.toLocaleString()} / {file.sample_count.toLocaleString()} samples
                        </span>
                        {file.processing_started_at && (
                          <span className="font-mono">
                            {(() => {
                              try {
                                const startTime = new Date(file.processing_started_at).getTime()
                                const now = Date.now()
                                const elapsedSeconds = (now - startTime) / 1000
                                
                                // Calculate actual processing rate (samples per second)
                                const samplesPerSecond = file.samples_processed / elapsedSeconds
                                
                                // Calculate remaining based on actual samples left
                                const remainingSamples = file.sample_count - file.samples_processed
                                const estimatedSecondsRemaining = remainingSamples / samplesPerSecond
                                
                                // Buffer estimates for smoothing using ref (no state update during render)
                                const currentEstimates = timeEstimatesRef.current[file.id] || []
                                const updatedEstimates = [...currentEstimates, estimatedSecondsRemaining].slice(-4) // Keep last 4 estimates
                                timeEstimatesRef.current[file.id] = updatedEstimates
                                
                                // Wait for at least 3 updates before showing estimate
                                if (updatedEstimates.length < 3) {
                                  return 'Computing time remaining...'
                                }
                                
                                // Use average of buffered estimates for smoothing
                                const avgEstimate = updatedEstimates.reduce((a, b) => a + b, 0) / updatedEstimates.length
                                
                                if (avgEstimate < 60) {
                                  return `~${Math.round(avgEstimate)}s remaining`
                                } else {
                                  const minutes = Math.round(avgEstimate / 60)
                                  return `~${minutes}m remaining`
                                }
                              } catch (error) {
                                return 'Calculating...'
                              }
                            })()}
                          </span>
                        )}
                      </div>
                    </>
                  ) : file.processing_started_at ? (
                    // Processing has started but no batch progress yet (downloading/parsing CSV)
                    <>
                      <div className="text-sm text-secondary mb-2">
                        <strong className="text-info">Processing started...</strong>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2.5 mb-2 overflow-hidden">
                        <div 
                          className="bg-info h-2.5 rounded-full transition-all duration-1000 animate-pulse"
                          style={{ width: '100%' }}
                        />
                      </div>
                      <div className="text-xs text-secondary">
                        <ElapsedTimeDisplay startTime={file.processing_started_at} />
                      </div>
                    </>
                  ) : (
                    // Queued but not started yet
                    <div className="text-sm text-secondary">
                      <div className="mb-2">
                        <strong className="text-info">Queued for processing...</strong>
                      </div>
                      <div className="text-xs text-secondary">
                        Job will start momentarily
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Error message */}
              {file.status === 'failed' && file.error_message && (
                <div className="mt-3 p-3 bg-error text-error border-error rounded text-sm">
                  {file.error_message}
                </div>
              )}
            </div>
          </div>
        </a>
      ))}
      </div>
      
      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showDeleteModal}
        onClose={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        type="delete"
        title="Delete Data Segment"
        message={fileToDelete ? (() => {
          if (fileToDelete.start_time && fileToDelete.end_time) {
            const startDate = new Date(fileToDelete.start_time).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit'
            })
            const endDate = new Date(fileToDelete.end_time).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit'
            })
            return `Are you sure you want to delete sensor data from ${startDate} to ${endDate}? This will permanently remove all samples in this time range.`
          } else {
            return `Are you sure you want to delete this sensor data? This will permanently remove all samples.`
          }
        })() : ''}
        confirmText="Delete"
        cancelText="Cancel"
        isLoading={deleting === fileToDelete?.id}
      />
    </>
  )
}

