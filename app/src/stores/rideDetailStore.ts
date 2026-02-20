/**
 * Ride Detail Store
 *
 * Fetches and caches ride detail data: samples, pedaling efficiency, riding position.
 * Polls for derived metrics until they reach a terminal status.
 */

import { create } from 'zustand';
import { apiFetch } from '../lib/api';

// --- Types ---

export interface FitSample {
  timestamp: string;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  speed_ms: number | null;
  power_watts: number | null;
  heart_rate: number | null;
  cadence: number | null;
  temperature: number | null;
  grade: number | null;
}

export interface SamplesMetadata {
  totalSamples: number;
  originalSamples: number;
  gpsPointsCount: number;
  hasGps: boolean;
  hasPower: boolean;
  hasHeartRate: boolean;
  hasCadence: boolean;
  startTime: string | null;
  endTime: string | null;
}

export type DerivedStatus = 'not_started' | 'pending' | 'processing' | 'completed' | 'failed';

export interface DerivedMetricResult<T> {
  status: DerivedStatus;
  samples: T[];
  metadata: any;
}

export interface PedalingEfficiencySample {
  timestamp: string;
  efficiency: number | null;
  efficiencyPercent: number | null;
  isPedaling: boolean;
  cadence: number | null;
}

export interface RidingPositionSample {
  timestamp: string;
  position: 'standing' | 'seated' | null;
  rockingMagnitude: number;
  cadence: number | null;
}

export interface ComparisonData {
  value: number;
  average: number;
}

export interface RideComparisons {
  efficiency: ComparisonData | null;
  standing: ComparisonData | null;
  avgHr: ComparisonData | null;
  avgPower: ComparisonData | null;
}

// --- Store ---

interface RideDetailState {
  // Samples
  samples: FitSample[];
  samplesMetadata: SamplesMetadata | null;
  samplesLoading: boolean;
  samplesError: string | null;

  // Comparisons (trends)
  comparisons: RideComparisons | null;
  comparisonsLoading: boolean;

  // Pedaling efficiency
  efficiency: DerivedMetricResult<PedalingEfficiencySample> | null;
  efficiencyLoading: boolean;

  // Riding position
  position: DerivedMetricResult<RidingPositionSample> | null;
  positionLoading: boolean;

  // Polling
  _pollingTimer: ReturnType<typeof setInterval> | null;
  _currentRideId: string | null;

  // Actions
  loadRideDetail: (rideId: string) => Promise<void>;
  startPolling: (rideId: string) => void;
  stopPolling: () => void;
  reset: () => void;
}

const initialState = {
  samples: [],
  samplesMetadata: null,
  samplesLoading: false,
  samplesError: null,
  comparisons: null,
  comparisonsLoading: false,
  efficiency: null,
  efficiencyLoading: false,
  position: null,
  positionLoading: false,
  _pollingTimer: null,
  _currentRideId: null,
};

export const useRideDetailStore = create<RideDetailState>((set, get) => ({
  ...initialState,

  loadRideDetail: async (rideId: string) => {
    const state = get();
    // Reset if switching rides
    if (state._currentRideId !== rideId) {
      state.stopPolling();
      set({ ...initialState, _currentRideId: rideId });
    }

    set({ samplesLoading: true, comparisonsLoading: true, efficiencyLoading: true, positionLoading: true });

    // Fetch samples + comparisons in parallel
    const samplesPromise = apiFetch<{ samples: FitSample[]; metadata: SamplesMetadata }>(
      `/api/rides/${rideId}/samples`
    ).then(data => {
      set({ samples: data.samples, samplesMetadata: data.metadata, samplesLoading: false });
    }).catch((error: any) => {
      console.error('[rideDetailStore] Error loading samples:', error);
      set({ samplesError: error.message, samplesLoading: false });
    });

    const comparisonsPromise = apiFetch<{ comparisons: RideComparisons | null }>(
      `/api/rides/${rideId}/comparisons`
    ).then(data => {
      set({ comparisons: data.comparisons, comparisonsLoading: false });
    }).catch((error: any) => {
      console.error('[rideDetailStore] Error loading comparisons:', error);
      set({ comparisonsLoading: false });
    });

    await Promise.all([samplesPromise, comparisonsPromise]);

    // Fetch derived metrics (these may be pending)
    await Promise.all([
      fetchDerivedMetric(rideId, 'pedaling-efficiency', 'efficiency', 'efficiencyLoading'),
      fetchDerivedMetric(rideId, 'riding-position', 'position', 'positionLoading'),
    ]);

    // Start polling if any derived metric is still processing
    const updated = get();
    const needsPolling =
      updated.efficiency?.status === 'pending' ||
      updated.efficiency?.status === 'processing' ||
      updated.position?.status === 'pending' ||
      updated.position?.status === 'processing';

    if (needsPolling) {
      get().startPolling(rideId);
    }
  },

  startPolling: (rideId: string) => {
    const { _pollingTimer } = get();
    if (_pollingTimer) return; // Already polling

    const timer = setInterval(async () => {
      const state = get();
      if (state._currentRideId !== rideId) {
        state.stopPolling();
        return;
      }

      const promises: Promise<void>[] = [];
      if (state.efficiency?.status === 'pending' || state.efficiency?.status === 'processing') {
        promises.push(fetchDerivedMetric(rideId, 'pedaling-efficiency', 'efficiency', 'efficiencyLoading'));
      }
      if (state.position?.status === 'pending' || state.position?.status === 'processing') {
        promises.push(fetchDerivedMetric(rideId, 'riding-position', 'position', 'positionLoading'));
      }

      if (promises.length === 0) {
        state.stopPolling();
        return;
      }

      await Promise.all(promises);

      // Check again after fetch
      const after = get();
      const stillPending =
        after.efficiency?.status === 'pending' ||
        after.efficiency?.status === 'processing' ||
        after.position?.status === 'pending' ||
        after.position?.status === 'processing';
      if (!stillPending) {
        after.stopPolling();
      }
    }, 3000);

    set({ _pollingTimer: timer });
  },

  stopPolling: () => {
    const { _pollingTimer } = get();
    if (_pollingTimer) {
      clearInterval(_pollingTimer);
      set({ _pollingTimer: null });
    }
  },

  reset: () => {
    get().stopPolling();
    set(initialState);
  },
}));

// Helper to fetch a derived metric endpoint
async function fetchDerivedMetric(
  rideId: string,
  endpoint: string,
  stateKey: 'efficiency' | 'position',
  loadingKey: 'efficiencyLoading' | 'positionLoading',
) {
  try {
    const data = await apiFetch<DerivedMetricResult<any>>(
      `/api/rides/${rideId}/${endpoint}?fields=metadata`
    );
    useRideDetailStore.setState({ [stateKey]: data, [loadingKey]: false });
  } catch (error: any) {
    // 202 responses come back as errors from our apiFetch (non-ok status)
    // but the API returns 200 with status field for pending/processing
    console.error(`[rideDetailStore] Error fetching ${endpoint}:`, error);
    useRideDetailStore.setState({
      [stateKey]: { status: 'failed' as DerivedStatus, samples: [], metadata: null },
      [loadingKey]: false,
    });
  }
}
