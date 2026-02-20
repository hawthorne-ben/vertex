/**
 * Ride Store
 *
 * Manages ride list and detail data from the web API.
 * Caches data locally via AsyncStorage for offline viewing.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from '../lib/api';

// --- Types ---

export interface RideAnalysis {
  avg_speed_mph?: number;
  max_speed_mph?: number;
  has_gps_data?: boolean;
  has_power?: boolean;
  has_heart_rate?: boolean;
  has_cadence?: boolean;
  has_elevation?: boolean;
  total_gps_points?: number;
}

export interface RideSummary {
  avg_efficiency_percent?: number | null;
  smooth_percent?: number | null;
  rough_percent?: number | null;
  standing_percent?: number | null;
  seated_percent?: number | null;
  avg_heart_rate?: number | null;
  avg_power_watts?: number | null;
  avg_cadence?: number | null;
  max_heart_rate?: number | null;
  max_power_watts?: number | null;
  max_cadence?: number | null;
  avg_cadence_standing?: number | null;
  avg_cadence_seated?: number | null;
}

export interface Ride {
  id: string;
  user_id: string;
  name: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  distance_meters: number | null;
  elevation_gain_meters: number | null;
  created_at: string;
  updated_at: string;
  bike_type: string | null;
  conditions: string | null;
  notes: string | null;
  fit_recording_id: string | null;
  fit_filename: string | null;
  fit_storage_path: string | null;
  analysis_results: RideAnalysis | null;
  summary: RideSummary | null;
}

// --- Store ---

const CACHE_KEY = '@vertex_rides_cache';

interface RideState {
  rides: Ride[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  lastFetched: number | null;

  loadRides: () => Promise<void>;
  refreshRides: () => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

const initialState = {
  rides: [],
  isLoading: false,
  isRefreshing: false,
  error: null,
  lastFetched: null,
};

export const useRideStore = create<RideState>((set, get) => ({
  ...initialState,

  loadRides: async () => {
    // If already loaded recently (within 30s), skip
    const { lastFetched, isLoading } = get();
    if (isLoading) return;
    if (lastFetched && Date.now() - lastFetched < 30_000) return;

    set({ isLoading: true, error: null });

    // Load from cache first for instant display
    try {
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      if (cached) {
        const { rides } = JSON.parse(cached);
        if (rides?.length > 0 && get().rides.length === 0) {
          set({ rides });
        }
      }
    } catch {
      // Cache miss is fine
    }

    // Fetch fresh data
    try {
      const data = await apiFetch<{ rides: Ride[] }>('/api/rides');
      set({
        rides: data.rides,
        isLoading: false,
        lastFetched: Date.now(),
      });

      // Persist to cache
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ rides: data.rides })).catch(() => {});
    } catch (error: any) {
      console.error('[rideStore] Error loading rides:', error);
      set({
        error: error.message,
        isLoading: false,
      });
    }
  },

  refreshRides: async () => {
    set({ isRefreshing: true, error: null });

    try {
      const data = await apiFetch<{ rides: Ride[] }>('/api/rides');
      set({
        rides: data.rides,
        isRefreshing: false,
        lastFetched: Date.now(),
      });

      AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ rides: data.rides })).catch(() => {});
    } catch (error: any) {
      console.error('[rideStore] Error refreshing rides:', error);
      set({
        error: error.message,
        isRefreshing: false,
      });
    }
  },

  clearError: () => set({ error: null }),

  reset: () => {
    set(initialState);
    AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
  },
}));
