'use client'

import { useState, useEffect } from 'react'
import { FileText, CheckCircle2, AlertCircle, Loader2, Trash2, Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

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
  const router = useRouter()

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
          return updated || file
        }))
      }
    }, 3000) // Poll every 3 seconds

    return () => clearInterval(interval)
  }, []) // Empty dependency array - only run once on mount

  const handleDelete = async (fileId: string) => {
    if (!confirm('Are you sure you want to delete this data segment? This will permanently remove all samples in this time range.')) {
      return
    }

    setDeleting(fileId)

    try {
      // Use the admin API endpoint for proper deletion
      const response = await fetch('/api/admin/delete-file', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Delete failed')
      }

      const result = await response.json()
      console.log('Delete successful:', result.message)

      // Remove from UI
      setFiles(prev => prev.filter(f => f.id !== fileId))
    } catch (err) {
      console.error('Delete error:', err)
      alert(`Failed to delete data segment: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setDeleting(null)
    }
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
                <div className="relative">
                  <Loader2 className="w-6 h-6 text-info animate-spin" />
                  {/* Show warning if processing for more than 5 minutes */}
                  {(() => {
                    try {
                      const uploadTime = new Date(file.uploaded_at)
                      const processingTime = new Date().getTime() - uploadTime.getTime()
                      return processingTime > 5 * 60 * 1000 ? (
                        <div className="absolute -top-1 -right-1 w-3 h-3 bg-warning rounded-full animate-pulse" title="Processing longer than expected" />
                      ) : null
                    } catch (error) {
                      return null
                    }
                  })()}
                </div>
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
              <div className="flex items-baseline gap-3 mb-2">
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
                  {file.status}
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
                  handleDelete(file.id)
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
  )
}

