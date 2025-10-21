'use client'

import { useState } from 'react'
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
  status: 'uploaded' | 'parsing' | 'ready' | 'error'
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

  const handleDelete = async (fileId: string) => {
    if (!confirm('Are you sure you want to delete this data segment? This will permanently remove all samples in this time range.')) {
      return
    }

    setDeleting(fileId)
    const supabase = createClient()

    try {
      // Delete the record (CASCADE will delete samples)
      const { error: dbError } = await supabase
        .from('imu_data_files')
        .delete()
        .eq('id', fileId)

      if (dbError) throw dbError

      // Get storage path before removing from state
      const file = files.find(f => f.id === fileId)
      if (file && file.storage_path) {
        // Delete from storage (original upload file)
        const { error: storageError } = await supabase.storage
          .from('uploads')
          .remove([file.storage_path])
        
        if (storageError) {
          console.warn('Storage deletion failed (non-critical):', storageError)
        }
      }

      // Remove from UI
      setFiles(prev => prev.filter(f => f.id !== fileId))
    } catch (err) {
      console.error('Delete error:', err)
      alert('Failed to delete data segment')
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
      <div className="text-center py-12 border-2 border-dashed border-stone-200 rounded-lg">
        <FileText className="w-12 h-12 mx-auto mb-4 text-stone-400" />
        <h3 className="text-lg font-medium text-stone-900 mb-2">No IMU data yet</h3>
        <p className="text-stone-600 mb-6">Upload your first sensor data to get started</p>
        <a
          href="/upload"
          className="inline-block px-6 py-2 bg-stone-900 text-white hover:bg-stone-800 transition-colors rounded-md"
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
          className="block border border-stone-200 rounded-lg p-6 bg-white hover:shadow-md hover:border-stone-300 transition-all cursor-pointer"
        >
          <div className="flex items-start gap-4">
            {/* Status icon */}
            <div className="flex-shrink-0 mt-1">
              {file.status === 'parsing' && (
                <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
              )}
              {file.status === 'ready' && (
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              )}
              {file.status === 'error' && (
                <AlertCircle className="w-6 h-6 text-red-600" />
              )}
              {file.status === 'uploaded' && (
                <Clock className="w-6 h-6 text-stone-400" />
              )}
            </div>

            {/* Data segment info */}
            <div className="flex-grow min-w-0">
              <div className="flex items-baseline gap-3 mb-2">
                <h3 className="text-lg font-medium text-stone-900">
                  {file.start_time && file.end_time ? (
                    <>
                      {new Date(file.start_time).toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric', 
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit'
                      })}
                      {' → '}
                      {new Date(file.end_time).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit'
                      })}
                    </>
                  ) : (
                    <span className="text-stone-500">Processing...</span>
                  )}
                </h3>
                <span className={`
                  text-xs px-2 py-1 rounded-full flex-shrink-0
                  ${file.status === 'ready' ? 'bg-green-50 text-green-700' : ''}
                  ${file.status === 'parsing' ? 'bg-blue-50 text-blue-700' : ''}
                  ${file.status === 'error' ? 'bg-red-50 text-red-700' : ''}
                  ${file.status === 'uploaded' ? 'bg-stone-50 text-stone-700' : ''}
                `}>
                  {file.status}
                </span>
              </div>

              {/* Metadata grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                {file.sample_count && (
                  <div>
                    <span className="text-stone-500 block">Samples</span>
                    <span className="text-stone-900">{file.sample_count.toLocaleString()}</span>
                  </div>
                )}

                {file.sample_rate && (
                  <div>
                    <span className="text-stone-500 block">Sample Rate</span>
                    <span className="text-stone-900">{file.sample_rate} Hz</span>
                  </div>
                )}

                {file.start_time && file.end_time && (
                  <div>
                    <span className="text-stone-500 block">Duration</span>
                    <span className="text-stone-900">
                      {formatDuration(file.start_time, file.end_time)}
                    </span>
                  </div>
                )}
              </div>

              {/* Source file (de-emphasized) */}
              {file.filename && (
                <div className="mt-3 text-xs text-stone-400">
                  Source: {file.filename} ({formatFileSize(file.file_size_bytes)})
                </div>
              )}

              {/* Error message */}
              {file.status === 'error' && file.error_message && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
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
                className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors rounded-md disabled:opacity-50"
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

