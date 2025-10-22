'use client'

import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Upload, FileText } from 'lucide-react'
import { ConfirmationModal, UploadProgressModal } from '@/components/upload-modals'

interface FileToUpload {
  file: File
  id: string
}

export default function UploadPage() {
  const [selectedFiles, setSelectedFiles] = useState<FileToUpload[]>([])
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [showUploadProgress, setShowUploadProgress] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [currentFileIndex, setCurrentFileIndex] = useState(0)
  const [currentFileName, setCurrentFileName] = useState('')
  const router = useRouter()

  const handleFileSelection = useCallback((acceptedFiles: File[]) => {
    const newFiles: FileToUpload[] = acceptedFiles.map(file => ({
      file,
      id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    }))
    
    setSelectedFiles(prev => [...prev, ...newFiles])
    setShowConfirmation(true)
  }, [])

  const handleConfirmUpload = useCallback(async () => {
    if (selectedFiles.length === 0) return

    setShowConfirmation(false)
    setShowUploadProgress(true)
    setUploadProgress(0)
    setCurrentFileIndex(0)

    const supabase = createClient()
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      console.error('Not authenticated:', authError)
      setShowUploadProgress(false)
      return
    }

    const uploadedFileIds: string[] = []

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const fileToUpload = selectedFiles[i]
        const file = fileToUpload.file
        
        setCurrentFileIndex(i)
        setCurrentFileName(file.name)
        setUploadProgress((i / selectedFiles.length) * 100)

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

        uploadedFileIds.push(fileRecord.id)

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
      }

      // Upload complete
      setUploadProgress(100)
      
      // Wait a moment to show completion, then redirect
      setTimeout(() => {
        setShowUploadProgress(false)
        setSelectedFiles([])
        router.push('/data')
      }, 1000)

    } catch (err) {
      console.error('Upload error:', err)
      setShowUploadProgress(false)
      alert(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }, [selectedFiles, router])

  const handleCancelUpload = useCallback(() => {
    setShowConfirmation(false)
    setSelectedFiles([])
  }, [])

  const handleRemoveFile = useCallback((id: string) => {
    setSelectedFiles(prev => prev.filter(f => f.id !== id))
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleFileSelection,
    accept: {
      'text/csv': ['.csv']
    },
    multiple: true,
    disabled: showUploadProgress
  })

  return (
    <div className="container mx-auto px-4 md:px-6 py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-normal text-primary mb-2">Upload IMU Data</h1>
        <p className="text-secondary">
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
            ? 'border-primary bg-muted' 
            : 'border-border hover-border hover-bg'
          }
          ${showUploadProgress ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} />
        
        <Upload className="w-12 h-12 mx-auto mb-4 text-tertiary" />
        
        {isDragActive ? (
          <p className="text-lg text-primary">Drop CSV files here...</p>
        ) : (
          <>
            <p className="text-lg text-primary mb-2">
              Drag and drop CSV files here, or click to select
            </p>
            <p className="text-sm text-secondary">
              Supports CSV files with IMU sensor data (accelerometer, gyroscope, magnetometer)
            </p>
          </>
        )}
      </div>

      {/* Modals */}
      <ConfirmationModal
        files={selectedFiles}
        isOpen={showConfirmation}
        onConfirm={handleConfirmUpload}
        onCancel={handleCancelUpload}
        onRemoveFile={handleRemoveFile}
      />

      <UploadProgressModal
        isOpen={showUploadProgress}
        currentFile={currentFileName}
        progress={uploadProgress}
        totalFiles={selectedFiles.length}
        currentFileIndex={currentFileIndex}
      />

      {/* Help section */}
      <div className="mt-12 p-6 bg-muted rounded-lg border border-border">
        <h3 className="text-sm font-medium text-primary mb-2">CSV Format Requirements</h3>
        <ul className="text-sm text-secondary space-y-1">
          <li>• First row must contain column headers</li>
          <li>• Required columns: <code className="text-xs bg-background px-1 py-0.5 rounded">timestamp_ms, accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z</code></li>
          <li>• Optional columns: <code className="text-xs bg-background px-1 py-0.5 rounded">mag_x, mag_y, mag_z, quat_w, quat_x, quat_y, quat_z</code></li>
          <li>• Timestamps should be in milliseconds (Unix epoch)</li>
          <li>• Accelerometer units: m/s²</li>
          <li>• Gyroscope units: rad/s</li>
          <li>• Magnetometer units: µT (microtesla)</li>
        </ul>
      </div>
    </div>
  )
}
