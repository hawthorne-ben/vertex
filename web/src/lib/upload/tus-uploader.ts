/**
 * TUS (Resumable Upload Protocol) wrapper for Supabase Storage
 *
 * Provides direct client-to-storage uploads with automatic chunking,
 * retry logic, and progress tracking. Eliminates server-side file processing.
 *
 * @see https://tus.io/protocols/resumable-upload.html
 * @see https://supabase.com/docs/guides/storage/uploads/resumable-uploads
 */

import * as tus from 'tus-js-client'
import { createClient } from '@/lib/supabase/client'

export interface TusUploadOptions {
  /**
   * Progress callback (bytesUploaded, bytesTotal)
   */
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void

  /**
   * Success callback with upload URL
   */
  onSuccess?: (uploadUrl: string) => void

  /**
   * Error callback
   */
  onError?: (error: Error) => void

  /**
   * Custom storage path (overrides default timestamp-based path)
   */
  customPath?: string
}

export class TusUploader {
  /**
   * Chunk size: 6MB (Supabase recommended size for optimal performance)
   */
  private static readonly CHUNK_SIZE = 6 * 1024 * 1024

  /**
   * Retry delays in milliseconds (exponential backoff)
   */
  private static readonly RETRY_DELAYS = [0, 1000, 3000, 5000, 10000]

  /**
   * Upload file using TUS resumable protocol
   *
   * @param file - File to upload
   * @param bucketName - Supabase storage bucket name (default: 'recordings')
   * @param options - Upload options (progress, success, error callbacks)
   * @returns Promise<string> - Storage path of uploaded file
   *
   * @example
   * const path = await TusUploader.upload(file, 'recordings', {
   *   onProgress: (uploaded, total) => {
   *     console.log(`${(uploaded/total*100).toFixed(1)}%`)
   *   }
   * })
   */
  static async upload(
    file: File,
    bucketName: string = 'recordings',
    options: TusUploadOptions = {}
  ): Promise<string> {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      throw new Error('Not authenticated - please log in to upload files')
    }

    // Generate storage path (user_id/timestamp_filename)
    const timestamp = Date.now()
    const storagePath = options.customPath || `${session.user.id}/${timestamp}_${file.name}`

    return new Promise((resolve, reject) => {
      const upload = new tus.Upload(file, {
        // Supabase TUS endpoint
        endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,

        // Retry configuration
        retryDelays: this.RETRY_DELAYS,

        // Authentication and headers
        // NOTE: TUS protocol requires direct token access for storage uploads
        // This is an acceptable exception to the "no session tokens in components" rule
        headers: {
          authorization: `Bearer ${session.access_token}`,
          'x-upsert': 'false', // Don't overwrite existing files
        },

        // Upload configuration
        uploadDataDuringCreation: true, // Start upload immediately
        removeFingerprintOnSuccess: true, // Clean up after success

        // File metadata
        metadata: {
          bucketName,
          objectName: storagePath,
          contentType: file.type || 'application/octet-stream',
          cacheControl: '3600',
        },

        // Chunk size (6MB optimized for Supabase)
        chunkSize: this.CHUNK_SIZE,

        // Event handlers
        onError: (error) => {
          console.error('TUS upload error:', error)
          options.onError?.(error)
          reject(error)
        },

        onProgress: (bytesUploaded, bytesTotal) => {
          options.onProgress?.(bytesUploaded, bytesTotal)
        },

        onSuccess: () => {
          const uploadUrl = upload.url || ''
          console.log('TUS upload completed:', storagePath)
          options.onSuccess?.(uploadUrl)
          resolve(storagePath)
        },
      })

      // Start the upload
      upload.start()
    })
  }

  /**
   * Check if file should use TUS upload
   * (Always returns true - all files use TUS now)
   *
   * @deprecated This method exists for API compatibility but always returns true
   */
  static shouldUseTus(_file: File): boolean {
    return true
  }

  /**
   * Estimate upload time based on file size and connection speed
   *
   * @param fileSize - File size in bytes
   * @param uploadSpeedMbps - Estimated upload speed in Mbps (default: 10)
   * @returns Estimated time in seconds
   */
  static estimateUploadTime(fileSize: number, uploadSpeedMbps: number = 10): number {
    const fileSizeMb = fileSize / (1024 * 1024)
    const timeSeconds = (fileSizeMb * 8) / uploadSpeedMbps
    return Math.ceil(timeSeconds)
  }

  /**
   * Format bytes to human-readable string
   *
   * @param bytes - Byte count
   * @returns Formatted string (e.g., "15.2 MB")
   */
  static formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
}
