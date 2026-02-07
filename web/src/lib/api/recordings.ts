import { createClient } from '@/lib/supabase/client'
import { Recording } from '@/types/recordings'
import { authFetch } from './auth-headers'

/**
 * Custom error class for recordings API operations
 */
export class RecordingsApiError extends Error {
  constructor(message: string, public originalError?: any) {
    super(message)
    this.name = 'RecordingsApiError'
  }
}

/**
 * Recordings API layer
 * Abstracts API calls away from presentation components
 */
export const recordingsApi = {
  /**
   * Fetch processing status for multiple recordings
   */
  async getProcessingStatus(ids: string[]): Promise<Record<string, Recording>> {
    if (ids.length === 0) {
      return {}
    }

    const client = createClient()
    const { data, error } = await client
      .from('recordings')
      .select('*')
      .in('id', ids)

    if (error) {
      throw new RecordingsApiError('Failed to fetch processing status', error)
    }

    return Object.fromEntries((data || []).map((r: Recording) => [r.id, r]))
  },

  /**
   * Delete a single recording
   */
  async delete(id: string): Promise<void> {
    const response = await fetch(`/api/recordings/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new RecordingsApiError(errorData.error || 'Delete failed')
    }
  },

  /**
   * Delete multiple recordings
   */
  async batchDelete(ids: string[]): Promise<{ message: string }> {
    const response = await fetch('/api/recordings/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordingIds: ids })
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new RecordingsApiError(errorData.error || 'Batch delete failed')
    }

    return response.json()
  },

  /**
   * Download a single recording
   */
  async download(recording: Recording): Promise<Blob> {
    const client = createClient()
    const { data, error } = await client.storage
      .from('recordings')
      .download(recording.storage_path)

    if (error || !data) {
      throw new RecordingsApiError(error?.message || 'Failed to download file')
    }

    return data
  },

  /**
   * Download multiple recordings as ZIP
   */
  async batchDownload(ids: string[]): Promise<{ blob: Blob; filename: string }> {
    const response = await authFetch('/api/recordings/batch-download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ recordingIds: ids })
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new RecordingsApiError(errorData.error || 'Batch download failed')
    }

    const blob = await response.blob()
    const filename = response.headers.get('Content-Disposition')
      ?.split('filename=')[1]
      ?.replace(/"/g, '') || 'recordings.zip'

    return { blob, filename }
  },

  /**
   * Merge multiple recordings
   */
  async merge(ids: string[], newFilename: string): Promise<{ filename: string; warnings?: string[] }> {
    const response = await fetch('/api/recordings/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recordingIds: ids,
        newFilename: newFilename.trim()
      })
    })

    const result = await response.json()

    if (!response.ok) {
      throw new RecordingsApiError(result.error || 'Merge failed')
    }

    return result
  },

  /**
   * Check if merged recording exists by filename
   */
  async checkMergeComplete(filename: string): Promise<boolean> {
    const client = createClient()
    const { data } = await client
      .from('recordings')
      .select('id')
      .eq('filename', filename)
      .maybeSingle()

    return !!data
  }
}
