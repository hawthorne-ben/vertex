/**
 * Client-side file chunking utilities for large IMU data uploads
 * Handles splitting large files into 50MB chunks for reliable upload
 */

export interface ChunkMetadata {
  chunkIndex: number;
  totalChunks: number;
  chunkSize: number;
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export interface ChunkUploadResult {
  chunkIndex: number;
  success: boolean;
  error?: string;
  uploadUrl?: string;
}

export class FileChunker {
  private static readonly CHUNK_SIZE = 50 * 1024 * 1024; // 50MB
  private static readonly MIN_CHUNK_SIZE = 1024 * 1024; // 1MB minimum

  /**
   * Split a file into chunks for upload
   */
  static async createChunks(file: File): Promise<{ chunks: Blob[], metadata: ChunkMetadata }> {
    const fileSize = file.size;
    const totalChunks = Math.ceil(fileSize / this.CHUNK_SIZE);
    
    // Generate unique file ID for this upload
    const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const metadata: ChunkMetadata = {
      chunkIndex: 0,
      totalChunks,
      chunkSize: this.CHUNK_SIZE,
      fileId,
      fileName: file.name,
      fileSize,
      mimeType: file.type
    };

    const chunks: Blob[] = [];
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * this.CHUNK_SIZE;
      const end = Math.min(start + this.CHUNK_SIZE, fileSize);
      
      // Ensure minimum chunk size (except for last chunk)
      if (i < totalChunks - 1 && (end - start) < this.MIN_CHUNK_SIZE) {
        // Merge with previous chunk if too small
        if (chunks.length > 0) {
          const lastChunk = chunks[chunks.length - 1];
          const mergedSize = lastChunk.size + (end - start);
          
          if (mergedSize <= this.CHUNK_SIZE * 1.5) { // Allow 50% overage
            // Merge chunks
            const mergedBlob = new Blob([lastChunk, file.slice(start, end)], { type: file.type });
            chunks[chunks.length - 1] = mergedBlob;
            continue;
          }
        }
      }
      
      const chunk = file.slice(start, end);
      chunks.push(chunk);
    }

    // Update metadata with actual chunk count
    metadata.totalChunks = chunks.length;

    return { chunks, metadata };
  }

  /**
   * Upload chunks sequentially with progress tracking
   */
  static async uploadChunks(
    chunks: Blob[],
    metadata: ChunkMetadata,
    onProgress?: (progress: number) => void,
    onChunkComplete?: (chunkIndex: number, success: boolean) => void
  ): Promise<ChunkUploadResult[]> {
    const results: ChunkUploadResult[] = [];
    const totalFileSize = metadata.fileSize;
    
    for (let i = 0; i < chunks.length; i++) {
      try {
        // Get presigned URL for this chunk
        const uploadUrl = await this.getChunkUploadUrl(metadata, i);
        
        // Upload chunk with real-time progress tracking
        await this.uploadChunkWithProgress(
          chunks[i], 
          uploadUrl, 
          (chunkProgress) => {
            // Calculate overall progress: previous chunks + current chunk progress
            const previousChunksBytes = i * this.CHUNK_SIZE;
            const currentChunkBytes = chunks[i].size;
            const currentChunkUploaded = (chunkProgress / 100) * currentChunkBytes;
            
            const overallBytesUploaded = previousChunksBytes + currentChunkUploaded;
            const overallProgress = (overallBytesUploaded / totalFileSize) * 100;
            
            console.log(`📦 Chunk ${i + 1}/${chunks.length} progress: ${chunkProgress.toFixed(1)}% (Overall: ${overallProgress.toFixed(1)}%)`);
            onProgress?.(overallProgress);
          }
        );
        
        results.push({
          chunkIndex: i,
          success: true,
          uploadUrl
        });
        
        onChunkComplete?.(i, true);
        
        // Update progress to 100% for this chunk
        const chunkEndProgress = ((i + 1) * this.CHUNK_SIZE) / totalFileSize * 100;
        const finalProgress = Math.min(chunkEndProgress, 100);
        console.log(`📦 Chunk ${i + 1}/${chunks.length} completed. Overall progress: ${finalProgress.toFixed(1)}%`);
        onProgress?.(finalProgress);
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        results.push({
          chunkIndex: i,
          success: false,
          error: errorMessage
        });
        
        onChunkComplete?.(i, false);
        
        // Stop on first failure
        throw new Error(`Chunk ${i} upload failed: ${errorMessage}`);
      }
    }
    
    return results;
  }

  /**
   * Get presigned URL for chunk upload
   */
  private static async getChunkUploadUrl(metadata: ChunkMetadata, chunkIndex: number): Promise<string> {
    const response = await fetch('/api/upload/chunk-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileId: metadata.fileId,
        chunkIndex,
        totalChunks: metadata.totalChunks,
        fileName: metadata.fileName,
        fileSize: metadata.fileSize,
        mimeType: metadata.mimeType
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to get upload URL: ${response.statusText}`);
    }

    const data = await response.json();
    return data.uploadUrl;
  }

  /**
   * Upload a single chunk to storage with real-time progress tracking
   */
  private static async uploadChunkWithProgress(
    chunk: Blob, 
    uploadUrl: string, 
    onProgress?: (progress: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          const progress = (e.loaded / e.total) * 100;
          onProgress(progress);
        }
      };
      
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Chunk upload failed: ${xhr.status} ${xhr.statusText}`));
        }
      };
      
      xhr.onerror = () => {
        reject(new Error('Chunk upload failed: Network error'));
      };
      
      xhr.open('PUT', uploadUrl, true);
      xhr.setRequestHeader('Content-Type', chunk.type || 'application/octet-stream');
      
      xhr.send(chunk);
    });
  }

  /**
   * Upload a single chunk to storage (legacy method without progress)
   */
  private static async uploadChunk(chunk: Blob, uploadUrl: string): Promise<void> {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      body: chunk,
      headers: {
        'Content-Type': chunk.type || 'application/octet-stream'
      }
    });

    if (!response.ok) {
      throw new Error(`Chunk upload failed: ${response.statusText}`);
    }
  }

  /**
   * Complete the chunked upload process
   */
  static async completeChunkedUpload(metadata: ChunkMetadata): Promise<void> {
    // Get the current session token
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session) {
      throw new Error('Not authenticated')
    }

    const response = await fetch('/api/upload/complete-chunked', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        fileId: metadata.fileId,
        fileName: metadata.fileName,
        fileSize: metadata.fileSize,
        totalChunks: metadata.totalChunks,
        mimeType: metadata.mimeType
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to complete upload: ${response.statusText}`);
    }
  }

  /**
   * Check if file needs chunking
   */
  static shouldChunk(file: File): boolean {
    return file.size > this.CHUNK_SIZE;
  }

  /**
   * Get estimated upload time
   */
  static getEstimatedUploadTime(fileSize: number, uploadSpeedMbps: number = 10): number {
    const totalChunks = Math.ceil(fileSize / this.CHUNK_SIZE);
    const timePerChunk = (this.CHUNK_SIZE * 8) / (uploadSpeedMbps * 1024 * 1024); // seconds
    return totalChunks * timePerChunk;
  }
}
