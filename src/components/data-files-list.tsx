'use client'

import { useState, useEffect } from 'react'
import { FileText, CheckCircle2, AlertCircle, Loader2, Trash2, Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/toast-context'
import { ConfirmationModal } from '@/components/ui/confirmation-modal'

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
}

interface DataFilesListProps {
  files: IMUDataFile[]
}

export function DataFilesList({ files: initialFiles }: DataFilesListProps) {
  const [files, setFiles] = useState(initialFiles)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [fileToDelete, setFileToDelete] = useState<IMUDataFile | null>(null)
  const router = useRouter()
  const { addToast } = useToast()

  // Poll for status updates on processing files
  useEffect(() => {
    const processingFiles = files.filter(f => f.status === 'uploaded' || f.status === 'parsing')
    if (processingFiles.length === 0) return

    const interval = setInterval(async () => {
      const supabase = createClient()
      const fileIds = processingFiles.map(f => f.id)

      const { data: updatedFiles, error } = await supabase
        .from('imu_data_files')
        .select('*')
        .in('id', fileIds)

      if (error) {
        console.error('Failed to poll file status:', error)
        return
      }

      if (updatedFiles) {
        setFiles(prev => prev.map(file => {
          const updated = updatedFiles.find(f => f.id === file.id)
          if (updated && updated.status !== file.status) {
            console.log(`📊 File ${file.filename} status changed: ${file.status} → ${updated.status}`)
            if (updated.status === 'failed' && updated.error_message) {
              console.error(`❌ File ${file.filename} failed: ${updated.error_message}`)
            }
          }
          return updated || file
        }))
      }
    }, 3000) // Poll every 3 seconds

    return () => clearInterval(interval)
  }, [files]) // Include files in dependency array

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
        <FileText className="w-12 h-12 mx-auto mb-4 text-tertiary" />
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
            {/* Status icon */}
            <div className="flex-shrink-0 mt-1">
              {file.status === 'parsing' && (
                <Loader2 className="w-6 h-6 text-info animate-spin" />
              )}
              {file.status === 'ready' && (
                <CheckCircle2 className="w-6 h-6 text-success" />
              )}
              {file.status === 'failed' && (
                <AlertCircle className="w-6 h-6 text-error" />
              )}
              {file.status === 'uploaded' && (
                <Clock className="w-6 h-6 text-tertiary" />
              )}
            </div>

            {/* Data segment info */}
            <div className="flex-grow min-w-0">
              <div className="flex items-center justify-between mb-2">
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
                      <span className="text-tertiary">Processing...</span>
                    ) : (
                      <ProcessingTimeDisplay uploadedAt={file.uploaded_at} />
                    )
                  ) : (
                    <span className="text-tertiary">Processing...</span>
                  )}
                </h3>
                <span className={`
                  text-xs px-2 py-1 rounded-full flex-shrink-0
                  ${file.status === 'ready' ? 'status-badge-success' : ''}
                  ${file.status === 'parsing' ? 'status-badge-info' : ''}
                  ${file.status === 'failed' ? 'status-badge-error' : ''}
                  ${file.status === 'uploaded' ? 'bg-muted text-muted-foreground' : ''}
                `}>
                  {file.status === 'parsing' ? 'parsing' : file.status}
                </span>
              </div>

              {/* Metadata grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                {file.sample_count && (
                  <div>
                    <span className="text-tertiary block">Samples</span>
                    <span className="text-primary">{file.sample_count.toLocaleString()}</span>
                  </div>
                )}

                {file.sample_rate && (
                  <div>
                    <span className="text-tertiary block">Sample Rate</span>
                    <span className="text-primary">{file.sample_rate} Hz</span>
                  </div>
                )}

                {file.start_time && file.end_time && (
                  <div>
                    <span className="text-tertiary block">Duration</span>
                    <span className="text-primary">
                      {formatDuration(file.start_time, file.end_time)}
                    </span>
                  </div>
                )}
              </div>

              {/* Source file (de-emphasized) */}
              {file.filename && (
                <div className="mt-3 text-xs text-tertiary">
                  Source: {file.filename} ({formatFileSize(file.file_size_bytes)})
                </div>
              )}

              {/* Processing progress indicator */}
              {file.status === 'parsing' && (
                <div className="mt-4">
                  {file.file_size_bytes && file.file_size_bytes > 10 * 1024 * 1024 ? (
                    // Large file processing (>10MB)
                    <>
                      <div className="text-sm text-tertiary mb-2">
                        Processing large file...
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div 
                          className="bg-info h-2 rounded-full transition-all duration-1000 animate-pulse"
                          style={{ 
                            width: file.file_size_bytes > 50 * 1024 * 1024 ? '60%' : '40%' // Estimate based on file size
                          }}
                        />
                      </div>
                      <div className="text-xs text-tertiary mt-1">
                        Large files may take several minutes to process completely
                      </div>
                    </>
                  ) : (
                    // Small file processing (≤10MB) - explanatory text
                    <div className="text-sm text-tertiary">
                      <div className="mb-2">
                        <strong className="text-info">Processing IMU data...</strong>
                      </div>
                      <div className="text-xs space-y-1">
                        <div>• Parsing sensor readings (accelerometer, gyroscope, magnetometer)</div>
                        <div>• Validating data format and timestamps</div>
                        <div>• Storing samples in database</div>
                        <div className="text-info mt-2">
                          <strong>Expected time:</strong> 30-60 seconds for files under 10MB
                        </div>
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

            {/* Actions */}
            <div className="flex-shrink-0">
              <button
                onClick={(e) => {
                  e.preventDefault()
                  handleDeleteClick(file)
                }}
                disabled={deleting === file.id}
                className="p-2 text-tertiary hover:text-error hover:bg-error/10 transition-colors rounded-md disabled:opacity-50"
                title="Delete segment"
              >
                {deleting === file.id ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Trash2 className="w-5 h-5" />
                )}
              </button>
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

