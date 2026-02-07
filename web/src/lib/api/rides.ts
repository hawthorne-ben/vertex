import { createClient } from '@/lib/supabase/client'
import { authFetch } from './auth-headers'
import { Ride } from '@/types/rides'

/**
 * Custom error class for rides API operations
 */
export class RidesApiError extends Error {
  constructor(message: string, public originalError?: any) {
    super(message)
    this.name = 'RidesApiError'
  }
}

/**
 * Rides API layer
 * Abstracts API calls away from presentation components
 */
export const ridesApi = {
  /**
   * Delete a single ride
   */
  async delete(id: string): Promise<void> {
    const response = await fetch(`/api/rides/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new RidesApiError(errorData.error || 'Delete failed')
    }
  },

  /**
   * Delete multiple rides
   */
  async batchDelete(ids: string[]): Promise<{ message: string }> {
    const response = await fetch('/api/rides/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rideIds: ids })
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new RidesApiError(errorData.error || 'Batch delete failed')
    }

    return response.json()
  },

  /**
   * Download a single ride's FIT file
   */
  async download(storagePath: string, filename: string): Promise<Blob> {
    const client = createClient()
    const { data, error } = await client.storage
      .from('recordings')
      .download(storagePath)

    if (error || !data) {
      throw new RidesApiError(error?.message || 'Failed to download file')
    }

    return data
  },

  /**
   * Download multiple rides as ZIP
   */
  async batchDownload(ids: string[]): Promise<{ blob: Blob; filename: string }> {
    const response = await authFetch('/api/rides/batch-download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ rideIds: ids })
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new RidesApiError(errorData.error || 'Batch download failed')
    }

    const blob = await response.blob()
    const filename = response.headers.get('Content-Disposition')
      ?.split('filename=')[1]
      ?.replace(/"/g, '') || 'rides.zip'

    return { blob, filename }
  },

  /**
   * Associate VTX recordings with a ride
   */
  async associateRecordings(rideId: string, recordingIds: string[]): Promise<{ message: string; added: number }> {
    const response = await fetch(`/api/rides/${rideId}/recordings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordingIds })
    })

    const result = await response.json()

    if (!response.ok) {
      throw new RidesApiError(result.error || 'Failed to associate recordings')
    }

    return result
  }
}
