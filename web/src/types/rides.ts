/**
 * Shared type definitions for rides
 */

export interface Ride {
  id: string
  user_id: string
  name: string
  start_time: string
  end_time: string
  duration_seconds: number
  distance_meters: number | null
  elevation_gain_meters: number | null
  created_at: string
  updated_at: string
  fit_recording_id: string | null
  bike_type: string | null
  conditions: string | null
  notes: string | null
  analysis_results: RideAnalysis | null
}

export interface RideAnalysis {
  avg_speed_mph?: number
  max_speed_mph?: number
  has_gps_data?: boolean
  has_power?: boolean
  has_heart_rate?: boolean
  has_cadence?: boolean
  has_elevation?: boolean
  total_gps_points?: number
  riding_time_seconds?: number // Computed moving time (stops excluded)
  stationary_time_seconds?: number
  [key: string]: unknown // Allow additional analysis fields
}

export interface RideWithRecordings extends Ride {
  fit_filename: string | null
  fit_storage_path: string | null
  vtx_recordings: Array<{
    id: string
    filename: string
    start_time: string
    end_time: string
  }>
}

/**
 * Sample data types
 */
export interface RideSample {
  timestamp: string
  latitude?: number | null
  longitude?: number | null
  altitude?: number | null
  speed_ms?: number | null
  power_watts?: number | null
  heart_rate?: number | null
  cadence?: number | null
  temperature?: number | null
  grade?: number | null
}
