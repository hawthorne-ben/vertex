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
    // Check file size limits
    const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB limit
    const oversizedFiles = acceptedFiles.filter(file => file.size > MAX_FILE_SIZE)
    
    if (oversizedFiles.length > 0) {
      const fileNames = oversizedFiles.map(f => f.name).join(', ')
      alert(`Files too large (max 50MB): ${fileNames}\n\nPlease reduce file size or contact support for larger files.`)
      return
    }

    const newFiles: FileToUpload[] = acceptedFiles.map(file => ({
      file,
      id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    }))
    
    setSelectedFiles(prev => [...prev, ...newFiles])
    setShowConfirmation(true)
  }, [])

  const uploadFileWithProgress = useCallback((
    file: File, 
    storagePath: string, 
    supabase: any,
    onProgress: (progress: number) => void
  ) => {
    return new Promise<void>(async (resolve, reject) => {
      try {
        // Get upload URL from Supabase
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          reject(new Error('Not authenticated'))
          return
        }
        
        const xhr = new XMLHttpRequest()
        
        // Track upload progress
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const progress = (e.loaded / e.total) * 100
            onProgress(progress)
          }
        }
        
        // Handle completion
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve()
          } else {
            reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`))
          }
        }
        
        // Handle errors
        xhr.onerror = () => {
          reject(new Error('Upload failed: Network error'))
        }
        
        // Build the upload URL
        const uploadUrl = `${supabase.supabaseUrl}/storage/v1/object/uploads/${storagePath}`
        
        // Set up the request
        xhr.open('POST', uploadUrl, true)
        xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`)
        xhr.setRequestHeader('Cache-Control', '3600')
        
        // Send the file
        const formData = new FormData()
        formData.append('file', file)
        xhr.send(formData)
      } catch (error) {
        reject(error)
      }
    })
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
        
        // Calculate base progress for this file
        const fileStartProgress = (i / selectedFiles.length) * 100
        const fileEndProgress = ((i + 1) / selectedFiles.length) * 100
        
        // 1. Upload to Supabase Storage with progress tracking
        const timestamp = Date.now()
        const storagePath = `${user.id}/${timestamp}_${file.name}`
        
        await uploadFileWithProgress(file, storagePath, supabase, (fileProgress) => {
          // Map file progress (0-100) to overall progress range for this file
          const overallProgress = fileStartProgress + (fileProgress / 100) * (fileEndProgress - fileStartProgress)
          setUploadProgress(overallProgress)
        })

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

      // Upload complete - show success briefly then redirect
      setUploadProgress(100)
      
      // Immediate redirect after showing 100% completion
      setShowUploadProgress(false)
      setSelectedFiles([])
      router.push('/data')

    } catch (err) {
      console.error('Upload error:', err)
      setShowUploadProgress(false)
      alert(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }, [selectedFiles, router, uploadFileWithProgress])

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
