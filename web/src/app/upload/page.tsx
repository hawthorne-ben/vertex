'use client'

import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Upload, FileText } from 'lucide-react'
import { ConfirmationModal, UploadProgressModal } from '@/components/upload-modals'
import { FileChunker } from '@/lib/upload/chunking'
import { useToast } from '@/components/ui/toast-context'

interface FileToUpload {
  file: File
  id: string
}

export default function UploadPage() {
  const [selectedFiles, setSelectedFiles] = useState<FileToUpload[]>([])
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [showUploadProgress, setShowUploadProgress] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [lastProgress, setLastProgress] = useState(0)
  const [currentFileIndex, setCurrentFileIndex] = useState(0)
  const [currentFileName, setCurrentFileName] = useState('')
  const router = useRouter()
  const { addToast } = useToast()

  const handleFileSelection = useCallback((acceptedFiles: File[]) => {
    // Check file size limits - now support up to 200MB with chunking
    const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB limit
    const oversizedFiles = acceptedFiles.filter(file => file.size > MAX_FILE_SIZE)
    
    if (oversizedFiles.length > 0) {
      const fileNames = oversizedFiles.map(f => f.name).join(', ')
      alert(`Files too large (max 200MB): ${fileNames}\n\nPlease reduce file size or contact support for larger files.`)
      return
    }

    const newFiles: FileToUpload[] = acceptedFiles.map(file => ({
      file,
      id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    }))
    
    setSelectedFiles(prev => [...prev, ...newFiles])
    setShowConfirmation(true)
  }, [])

  const uploadFileDirect = useCallback(async (
    file: File,
    onProgress: (progress: number) => void
  ) => {
    // Original direct upload method for small files
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      throw new Error('Not authenticated')
    }

    const timestamp = Date.now()
    const storagePath = `${session.user.id}/${timestamp}_${file.name}`

    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const progress = (e.loaded / e.total) * 100
          onProgress(progress)
        }
      }
      
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(storagePath)
        } else {
          reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`))
        }
      }
      
      xhr.onerror = () => {
        reject(new Error('Upload failed: Network error'))
      }
      
      const uploadUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/recordings/${storagePath}`
      
      xhr.open('POST', uploadUrl, true)
      xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`)
      xhr.setRequestHeader('Cache-Control', '3600')
      
      const formData = new FormData()
      formData.append('file', file)
      xhr.send(formData)
    })
  }, [])

  const uploadFileChunked = useCallback(async (
    file: File,
    onProgress: (progress: number) => void,
    onChunkComplete?: (chunkIndex: number, success: boolean) => void
  ) => {
    try {
      // Check if file needs chunking
      if (!FileChunker.shouldChunk(file)) {
        // Small file - use original upload method
        return await uploadFileDirect(file, onProgress)
      }

      // Large file - use chunked upload
      console.log(`📦 File ${file.name} (${Math.round(file.size / 1024 / 1024)}MB) requires chunking`)
      
      // Create chunks
      const { chunks, metadata } = await FileChunker.createChunks(file)
      console.log(`📦 Created ${chunks.length} chunks for ${file.name}`)

      // Upload chunks sequentially
      await FileChunker.uploadChunks(
        chunks,
        metadata,
        onProgress,
        onChunkComplete
      )

      // Complete the chunked upload
      await FileChunker.completeChunkedUpload(metadata)
      
      console.log(`✅ Chunked upload completed for ${file.name}`)
      return metadata.fileId

    } catch (error) {
      console.error('Chunked upload failed:', error)
      throw error
    }
  }, [uploadFileDirect])

  const handleConfirmUpload = useCallback(async () => {
    if (selectedFiles.length === 0) return

    console.log(`🚀 Starting upload for ${selectedFiles.length} files`)
    setShowConfirmation(false)
    setShowUploadProgress(true)
    setUploadProgress(0)
    setLastProgress(0)
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
        setCurrentFileName(file?.name || 'Unknown file')
        
        // Calculate base progress for this file
        const fileStartProgress = (i / selectedFiles.length) * 100
        const fileEndProgress = ((i + 1) / selectedFiles.length) * 100
        
        console.log(`📁 Processing file ${i + 1}/${selectedFiles.length}: ${file?.name || 'Unknown file'}`)
        console.log(`📁 File progress range: ${fileStartProgress.toFixed(1)}% - ${fileEndProgress.toFixed(1)}%`)
        
        // Upload file (chunked or direct)
        const uploadResult = await uploadFileChunked(file, (fileProgress) => {
          // Map file progress (0-100) to overall progress range for this file
          const overallProgress = fileStartProgress + (fileProgress / 100) * (fileEndProgress - fileStartProgress)
          
          console.log(`📊 Progress Update:`)
          console.log(`  File: ${file?.name || 'Unknown file'}`)
          console.log(`  File Progress: ${fileProgress.toFixed(1)}%`)
          console.log(`  Overall Progress: ${overallProgress.toFixed(1)}%`)
          console.log(`  Last Progress: ${lastProgress.toFixed(1)}%`)
          
          // Always update progress if it's greater than the last progress
          if (overallProgress > lastProgress) {
            console.log(`✅ Updating progress from ${lastProgress.toFixed(1)}% to ${overallProgress.toFixed(1)}%`)
            setUploadProgress(overallProgress)
            setLastProgress(overallProgress)
          } else {
            console.log(`⏭️ Skipping progress update: ${overallProgress.toFixed(1)}% <= ${lastProgress.toFixed(1)}%`)
          }
        })

        // For chunked uploads, the fileId is returned directly
        // For direct uploads, call the recording API to process the file
        if (typeof uploadResult === 'string' && uploadResult.startsWith('file_')) {
          // Chunked upload - fileId returned (already processed by /api/upload/complete-chunked)
          uploadedFileIds.push(uploadResult)
        } else {
          // Direct upload - process via recording API
          const storagePath = uploadResult as string
          const { data: { session } } = await supabase.auth.getSession()

          if (!session) {
            throw new Error('Not authenticated')
          }

          const response = await fetch('/api/upload/recording', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
              fileName: file?.name || 'unknown',
              fileSize: file?.size || 0,
              storagePath
            })
          })

          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(`Recording upload failed: ${errorData.error || response.statusText}`)
          }

          const recordingData = await response.json()
          uploadedFileIds.push(recordingData.recordingId)
        }
      }

      // Upload complete - close modal and redirect immediately
      setUploadProgress(100)
      setLastProgress(100)
      setShowUploadProgress(false)

      setSelectedFiles([])

      // Use setTimeout to ensure state updates are flushed before navigation
      setTimeout(() => {
        // Redirect to data page to view recordings
        router.push('/data')
      }, 0)

    } catch (err) {
      console.error('Upload error:', err)
      setShowUploadProgress(false)
      
      // Show error toast
      addToast({
        type: 'error',
        title: 'Upload failed',
        message: err instanceof Error ? err.message : 'Unknown error occurred during upload'
      })
    }
  }, [selectedFiles, router, uploadFileChunked, lastProgress, addToast])

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
      'application/octet-stream': ['.vtx', '.fit']
    },
    multiple: true,
    disabled: showUploadProgress
  })

  return (
    <div className="container mx-auto px-4 md:px-6 py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-normal text-primary mb-2">Upload Recordings</h1>
        <p className="text-secondary">
          Upload VTX recordings from your IMU sensor or FIT files from your cycling computer. Files will be automatically processed and analyzed.
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
        
        <Upload className="w-12 h-12 mx-auto mb-4 text-secondary" />
        
        {isDragActive ? (
          <p className="text-lg text-primary">Drop files here...</p>
        ) : (
          <>
            <p className="text-lg text-primary mb-2">
              Drag and drop VTX or FIT files here, or click to select
            </p>
            <p className="text-sm text-secondary">
              Supports VTX recordings with IMU sensor data and FIT files from cycling computers
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
      <div className="mt-12 space-y-6">
        {/* VTX Format */}
        <div className="p-6 bg-muted rounded-lg border border-border">
          <h3 className="text-sm font-medium text-primary mb-2">VTX Recording Format</h3>
          <ul className="text-sm text-secondary space-y-1">
            <li>• Binary format with efficient compression (60-70% smaller than CSV)</li>
            <li>• Contains IMU sensor data: accelerometer, gyroscope, magnetometer, quaternions</li>
            <li>• Embeds device metadata, calibration data, and session information</li>
            <li>• Automatically detects and tracks data gaps in recording</li>
            <li>• O(1) timestamp indexing enables fast time-range queries</li>
            <li>• <strong>File size limit: 500MB</strong> (supports multi-hour recordings)</li>
            <li>• Instant processing - metadata extracted during upload</li>
            <li>• Ready for analysis immediately after upload</li>
          </ul>
        </div>

        {/* FIT Format */}
        <div className="p-6 bg-muted rounded-lg border border-border">
          <h3 className="text-sm font-medium text-primary mb-2">FIT File Support</h3>
          <ul className="text-sm text-secondary space-y-1">
            <li>• Compatible with Garmin, Wahoo, and other cycling computers</li>
            <li>• Extracts GPS track, power, heart rate, cadence, and speed data</li>
            <li>• Automatically calculates ride metadata (distance, duration, elevation)</li>
            <li>• <strong>File size limit: 500MB</strong> (supports ultra-endurance events)</li>
            <li>• Processing typically completes in under 10 seconds</li>
            <li>• Data will be available for ride creation and analysis</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
