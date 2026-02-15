'use client'

import { useState, useCallback, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Upload, FileText } from 'lucide-react'
import { ConfirmationModal, UploadProgressModal, UploadPhase } from '@/components/upload-modals'
import { TusUploader } from '@/lib/upload/tus-uploader'
import { useToast } from '@/components/ui/toast-context'
import { authFetch } from '@/lib/api/auth-headers'
import { recordingsApi } from '@/lib/api/recordings'

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
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('uploading')
  const [uploadError, setUploadError] = useState<string | undefined>()
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
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

  /**
   * Upload file using TUS resumable protocol
   * Returns storage path on success
   */
  const uploadFile = useCallback(async (
    file: File,
    onProgress: (progress: number) => void
  ): Promise<string> => {
    console.log(`📤 Starting TUS upload for ${file.name} (${TusUploader.formatBytes(file.size)})`)

    // Upload via TUS (direct to Supabase Storage)
    const storagePath = await TusUploader.upload(file, 'recordings', {
      onProgress: (bytesUploaded, bytesTotal) => {
        const percent = (bytesUploaded / bytesTotal) * 100
        onProgress(percent)
      },
      onError: (error) => {
        console.error('TUS upload error:', error)
      }
    })

    console.log(`✅ TUS upload completed: ${storagePath}`)
    return storagePath
  }, [])

  const handleConfirmUpload = useCallback(async () => {
    if (selectedFiles.length === 0) return

    console.log(`🚀 Starting upload for ${selectedFiles.length} files`)
    setShowConfirmation(false)
    setShowUploadProgress(true)
    setUploadPhase('uploading')
    setUploadError(undefined)
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
    const fitRecordings: { recordingId: string; filename: string }[] = []

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

        // Reserve progress: 0-90% for upload, 90-100% for server processing
        const uploadProgressEnd = fileStartProgress + (fileEndProgress - fileStartProgress) * 0.9
        const processingProgressEnd = fileEndProgress

        // Upload file via TUS (0-90% of this file's range)
        const storagePath = await uploadFile(file, (fileProgress) => {
          // Map file upload progress (0-100) to 0-90% of this file's range
          const overallProgress = fileStartProgress + (fileProgress / 100) * (uploadProgressEnd - fileStartProgress)

          // Always update progress if it's greater than the last progress
          if (overallProgress > lastProgress) {
            setUploadProgress(overallProgress)
            setLastProgress(overallProgress)
          }
        })

        // Track file type
        const fileName = file?.name || ''
        const fileNameLower = fileName.toLowerCase()

        // Update progress to 90% (upload complete, starting server processing)
        if (uploadProgressEnd > lastProgress) {
          setUploadProgress(uploadProgressEnd)
          setLastProgress(uploadProgressEnd)
        }

        // Notify server to create DB record and parse metadata (90-100% of this file's range)
        const response = await authFetch('/api/upload/recording', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fileName: file?.name || 'unknown',
            fileSize: file?.size || 0,
            storagePath,
            mimeType: file?.type || 'application/octet-stream'
          })
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(`Recording upload failed: ${errorData.error || response.statusText}`)
        }

        const recordingData = await response.json()
        uploadedFileIds.push(recordingData.recordingId)

        // Track FIT recordings for post-upload polling
        if (fileNameLower.endsWith('.fit')) {
          fitRecordings.push({ recordingId: recordingData.recordingId, filename: fileName })
        }

        // Update progress to 100% for this file (processing complete)
        if (processingProgressEnd > lastProgress) {
          setUploadProgress(processingProgressEnd)
          setLastProgress(processingProgressEnd)
        }
      }

      // Upload phase complete
      setUploadProgress(100)
      setLastProgress(100)
      setSelectedFiles([])

      // If no FIT files, redirect to /recordings immediately (VTX only)
      if (fitRecordings.length === 0) {
        setShowUploadProgress(false)
        router.push('/recordings')
        return
      }

      // FIT files exist — switch to processing phase and poll
      setUploadPhase('processing')

      const fitRecordingIds = fitRecordings.map(r => r.recordingId)
      const startTime = Date.now()
      const TIMEOUT_MS = 60_000

      const pollProcessingStatus = async () => {
        try {
          // Check timeout
          if (Date.now() - startTime > TIMEOUT_MS) {
            if (pollingRef.current) clearInterval(pollingRef.current)
            setUploadPhase('error')
            setUploadError('Processing is taking longer than expected. Your ride will appear on the rides page once processing completes.')
            return
          }

          const statuses = await recordingsApi.getProcessingStatus(fitRecordingIds)

          // Check if any failed
          const failedRecording = Object.values(statuses).find(r => r.status === 'failed')
          if (failedRecording) {
            if (pollingRef.current) clearInterval(pollingRef.current)
            setUploadPhase('error')
            setUploadError(failedRecording.error_message || 'Processing failed for one or more files.')
            return
          }

          // Check if all are ready
          const allReady = fitRecordingIds.every(id => statuses[id]?.status === 'ready')
          if (!allReady) return

          // All ready — determine redirect target
          if (pollingRef.current) clearInterval(pollingRef.current)

          // Pick target: single FIT → that one; multiple → earliest filename alphabetically
          let targetRecordingId: string
          if (fitRecordings.length === 1) {
            targetRecordingId = fitRecordings[0].recordingId
          } else {
            const sorted = [...fitRecordings].sort((a, b) => a.filename.localeCompare(b.filename))
            targetRecordingId = sorted[0].recordingId
          }

          // Look up the ride ID for this recording
          const rideId = await recordingsApi.getRideForRecording(targetRecordingId)

          setUploadPhase('complete')

          // Keep modal visible during navigation — it will unmount when the page changes.
          // Brief delay so the user sees the success state before navigation begins.
          setTimeout(() => {
            if (rideId) {
              router.push(`/rides/${rideId}`)
            } else {
              router.push('/rides')
            }
          }, 800)
        } catch (err) {
          console.error('Polling error:', err)
          // Don't stop polling on transient errors, let timeout handle it
        }
      }

      // Start polling every 2 seconds
      pollingRef.current = setInterval(pollProcessingStatus, 2000)
      // Also run immediately
      pollProcessingStatus()

    } catch (err) {
      console.error('Upload error:', err)
      setUploadPhase('error')
      setUploadError(err instanceof Error ? err.message : 'Unknown error occurred during upload')
    }
  }, [selectedFiles, router, uploadFile, lastProgress, addToast])

  const handleCancelUpload = useCallback(() => {
    setShowConfirmation(false)
    setSelectedFiles([])
  }, [])

  const handleDismissError = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    setShowUploadProgress(false)
    setUploadPhase('uploading')
    setUploadError(undefined)
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
        phase={uploadPhase}
        errorMessage={uploadError}
        onDismiss={handleDismissError}
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
