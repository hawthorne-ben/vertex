/**
 * Shared type definitions for recordings
 */

export type RecordingStatus = 'uploaded' | 'parsing' | 'ready' | 'failed'

export type FileType = 'fit' | 'vtx'

export interface Recording {
  id: string
  user_id: string
  filename: string
  file_type: FileType
  file_size_bytes: number
  storage_path: string
  start_time: string | null
  end_time: string | null
  duration_ms: number | null
  sample_rate: number | null
  sample_count: number | null
  status: RecordingStatus
  error_message: string | null
  uploaded_at: string
  parsed_at: string | null
  samples_processed: number | null
  last_checkpoint_at: string | null
  processing_started_at: string | null
  device_info: DeviceInfo | null
  session_metadata: SessionMetadata | null
  analysis_results: RecordingAnalysis | null
}

export interface DeviceInfo {
  device_type?: string
  firmware_version?: string
  hardware_version?: string
  [key: string]: unknown
}

export interface SessionMetadata {
  activity_type?: string
  location?: string
  notes?: string
  [key: string]: unknown
}

export interface RecordingAnalysis {
  avg_sample_rate?: number
  data_quality_score?: number
  [key: string]: unknown
}

export interface VTXRecording {
  id: string
  filename: string
  start_time: string
  end_time: string
  duration_ms: number
  file_size_bytes: number
  status: RecordingStatus
  uploaded_at: string
}

/**
 * Helper type guards
 */
export function isProcessing(recording: Recording): boolean {
  return recording.status === 'uploaded' || recording.status === 'parsing'
}

export function isReady(recording: Recording): boolean {
  return recording.status === 'ready'
}

export function isFailed(recording: Recording): boolean {
  return recording.status === 'failed'
}
