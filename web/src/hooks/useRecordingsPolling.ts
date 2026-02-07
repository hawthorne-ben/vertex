import { useState, useEffect, useMemo } from 'react'
import { Recording, isProcessing } from '@/types/recordings'
import { recordingsApi } from '@/lib/api/recordings'

/**
 * Hook to poll for processing status updates
 * Replaces the complex polling logic from data-files-list.tsx
 *
 * Fixes issues:
 * - No more async calls inside setState callbacks
 * - Proper cleanup with AbortController
 * - Stable dependency array
 * - Separates polling logic from UI concerns
 */
export function useRecordingsPolling(recordings: Recording[]): Recording[] {
  const [updates, setUpdates] = useState<Record<string, Recording>>({})

  // Get stable list of processing IDs
  const processingIds = useMemo(
    () => recordings.filter(isProcessing).map(r => r.id),
    [recordings]
  )

  // Stable string for dependency array
  const processingIdsKey = processingIds.join(',')

  useEffect(() => {
    if (processingIds.length === 0) {
      // No files processing, don't poll
      return
    }

    const controller = new AbortController()

    const poll = async () => {
      try {
        const updated = await recordingsApi.getProcessingStatus(processingIds)

        // Log status changes
        Object.values(updated).forEach(newRecording => {
          const oldRecording = recordings.find(r => r.id === newRecording.id)
          if (oldRecording && updated[newRecording.id].status !== oldRecording.status) {
            console.log(`📊 File ${newRecording.filename} status changed: ${oldRecording.status} → ${newRecording.status}`)
            if (newRecording.status === 'failed' && newRecording.error_message) {
              console.error(`❌ File ${newRecording.filename} failed: ${newRecording.error_message}`)
            }
          }
          if (oldRecording && newRecording.samples_processed !== oldRecording.samples_processed && newRecording.samples_processed) {
            console.log(`📈 File ${newRecording.filename} progress: ${newRecording.samples_processed.toLocaleString()} samples`)
          }
        })

        setUpdates(updated)
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error('Polling error:', err)
        }
      }
    }

    // Poll immediately
    poll()

    // Then poll every 3 seconds
    const interval = setInterval(poll, 3000)

    return () => {
      controller.abort()
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processingIdsKey]) // Stable string dependency

  // Merge updates with original recordings
  return useMemo(() => {
    return recordings.map(recording => {
      const update = updates[recording.id]
      return update || recording
    })
  }, [recordings, updates])
}
