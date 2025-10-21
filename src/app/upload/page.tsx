'use client'

import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { createClient } from '@/lib/supabase/client'
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

type UploadStatus = 'idle' | 'uploading' | 'parsing' | 'success' | 'error'

interface UploadedFile {
  id: string
  filename: string
  size: number
  status: UploadStatus
  error?: string
  sampleCount?: number
  duration?: number
}

export default function UploadPage() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [uploading, setUploading] = useState(false)

  const handleUpload = useCallback(async (acceptedFiles: File[]) => {
    const supabase = createClient()
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      console.error('Not authenticated:', authError)
      return
    }

    for (const file of acceptedFiles) {
      // Add file to UI with uploading status
      const tempId = `temp-${Date.now()}-${file.name}`
      setFiles(prev => [...prev, {
        id: tempId,
        filename: file.name,
        size: file.size,
        status: 'uploading'
      }])

      try {
        setUploading(true)

        // 1. Upload to Supabase Storage
        const timestamp = Date.now()
        const storagePath = `${user.id}/${timestamp}_${file.name}`
        
        const { error: uploadError } = await supabase.storage
          .from('uploads')
          .upload(storagePath, file, {
            cacheControl: '3600',
            upsert: false
          })

        if (uploadError) {
          throw new Error(`Storage upload failed: ${uploadError.message}`)
        }

        // 2. Create metadata record in database
        const { data: fileRecord, error: dbError } = await supabase
          .from('imu_data_files')
          .insert({
            user_id: user.id,
            filename: file.name,
            storage_path: storagePath,
            file_size_bytes: file.size,
            status: 'uploaded'
          })
          .select()
          .single()

        if (dbError) {
          throw new Error(`Database insert failed: ${dbError.message}`)
        }

        // Update UI with parsing status
        setFiles(prev => prev.map(f => 
          f.id === tempId 
            ? { ...f, id: fileRecord.id, status: 'parsing' as UploadStatus }
            : f
        ))

        // 3. Trigger parse job
        const response = await fetch('/api/imu/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId: fileRecord.id })
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(`Parse trigger failed: ${errorData.error || response.statusText}`)
        }

        // Update UI with success
        setFiles(prev => prev.map(f => 
          f.id === fileRecord.id 
            ? { ...f, status: 'success' as UploadStatus }
            : f
        ))

      } catch (err) {
        console.error('Upload error:', err)
        setFiles(prev => prev.map(f => 
          f.id === tempId 
            ? { 
                ...f, 
                status: 'error' as UploadStatus, 
                error: err instanceof Error ? err.message : 'Unknown error'
              }
            : f
        ))
      } finally {
        setUploading(false)
      }
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleUpload,
    accept: {
      'text/csv': ['.csv']
    },
    multiple: true,
    disabled: uploading
  })

  return (
    <div className="container mx-auto px-4 md:px-6 py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-normal text-stone-900 mb-2">Upload IMU Data</h1>
        <p className="text-stone-600">
          Upload CSV files from your IMU sensor. Files will be automatically parsed and processed.
        </p>
      </div>

      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg p-12 text-center cursor-pointer
          transition-colors
          ${isDragActive 
            ? 'border-stone-900 bg-stone-50' 
            : 'border-stone-300 hover:border-stone-400 hover:bg-stone-50'
          }
          ${uploading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} />
        
        <Upload className="w-12 h-12 mx-auto mb-4 text-stone-400" />
        
        {isDragActive ? (
          <p className="text-lg text-stone-700">Drop CSV files here...</p>
        ) : (
          <>
            <p className="text-lg text-stone-700 mb-2">
              Drag and drop CSV files here, or click to select
            </p>
            <p className="text-sm text-stone-500">
              Supports CSV files with IMU sensor data (accelerometer, gyroscope, magnetometer)
            </p>
          </>
        )}
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xl font-normal text-stone-900 mb-4">Uploaded Files</h2>
          
          <div className="space-y-3">
            {files.map((file) => (
              <div
                key={file.id}
                className="border border-stone-200 rounded-lg p-4 bg-white"
              >
                <div className="flex items-start gap-3">
                  {/* Status icon */}
                  <div className="flex-shrink-0 mt-1">
                    {file.status === 'uploading' && (
                      <Loader2 className="w-5 h-5 text-stone-400 animate-spin" />
                    )}
                    {file.status === 'parsing' && (
                      <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                    )}
                    {file.status === 'success' && (
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                    )}
                    {file.status === 'error' && (
                      <AlertCircle className="w-5 h-5 text-red-600" />
                    )}
                    {file.status === 'idle' && (
                      <FileText className="w-5 h-5 text-stone-400" />
                    )}
                  </div>

                  {/* File info */}
                  <div className="flex-grow min-w-0">
                    <div className="flex items-baseline gap-3 mb-1">
                      <h3 className="text-sm font-medium text-stone-900 truncate">
                        {file.filename}
                      </h3>
                      <span className="text-xs text-stone-500 flex-shrink-0">
                        {(file.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                    
                    {/* Status text */}
                    <p className="text-xs text-stone-600">
                      {file.status === 'uploading' && 'Uploading to storage...'}
                      {file.status === 'parsing' && 'Parsing CSV data...'}
                      {file.status === 'success' && (
                        <>
                          Ready
                          {file.sampleCount && ` • ${file.sampleCount.toLocaleString()} samples`}
                          {file.duration && ` • ${file.duration.toFixed(1)}s`}
                        </>
                      )}
                      {file.status === 'error' && (
                        <span className="text-red-600">Error: {file.error}</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Help section */}
      <div className="mt-12 p-6 bg-stone-50 rounded-lg border border-stone-200">
        <h3 className="text-sm font-medium text-stone-900 mb-2">CSV Format Requirements</h3>
        <ul className="text-sm text-stone-600 space-y-1">
          <li>• First row must contain column headers</li>
          <li>• Required columns: <code className="text-xs bg-white px-1 py-0.5 rounded">timestamp_ms, accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z</code></li>
          <li>• Optional columns: <code className="text-xs bg-white px-1 py-0.5 rounded">mag_x, mag_y, mag_z, quat_w, quat_x, quat_y, quat_z</code></li>
          <li>• Timestamps should be in milliseconds (Unix epoch)</li>
          <li>• Accelerometer units: m/s²</li>
          <li>• Gyroscope units: rad/s</li>
          <li>• Magnetometer units: µT (microtesla)</li>
        </ul>
      </div>
    </div>
  )
}
