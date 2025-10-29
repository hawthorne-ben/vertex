/**
 * Recording Store
 *
 * Global state for recording sessions and stats
 */

import { create } from 'zustand';
import { RecordingSession, RecordingFormat } from '../services/RecordingService';

export interface RecordingStats {
  duration: number; // milliseconds
  sampleCount: number;
  fileSize: number; // bytes
  droppedSamples: number;
}

export interface RecordingState {
  // Session
  session: RecordingSession | null;

  // Real-time stats
  stats: RecordingStats;

  // UI state
  isStarting: boolean;
  isStopping: boolean;
  isPaused: boolean;
  error: string | null;

  // Zero point calibration
  zeroPoint: any | null;
  isZeroing: boolean;

  // Actions
  setSession: (session: RecordingSession | null) => void;
  updateStats: (stats: Partial<RecordingStats>) => void;
  incrementSampleCount: () => void;
  setIsStarting: (isStarting: boolean) => void;
  setIsStopping: (isStopping: boolean) => void;
  setIsPaused: (isPaused: boolean) => void;
  setError: (error: string | null) => void;
  setZeroPoint: (zeroPoint: any | null) => void;
  setIsZeroing: (isZeroing: boolean) => void;
  reset: () => void;
}

const initialStats: RecordingStats = {
  duration: 0,
  sampleCount: 0,
  fileSize: 0,
  droppedSamples: 0,
};

export const useRecordingStore = create<RecordingState>((set) => ({
  session: null,
  stats: initialStats,
  isStarting: false,
  isStopping: false,
  isPaused: false,
  error: null,
  zeroPoint: null,
  isZeroing: false,

  setSession: (session) =>
    set({ session }),

  updateStats: (statsUpdate) =>
    set((state) => ({
      stats: { ...state.stats, ...statsUpdate },
    })),

  incrementSampleCount: () =>
    set((state) => ({
      stats: { ...state.stats, sampleCount: state.stats.sampleCount + 1 },
    })),

  setIsStarting: (isStarting) =>
    set({ isStarting }),

  setIsStopping: (isStopping) =>
    set({ isStopping }),

  setIsPaused: (isPaused) =>
    set({ isPaused }),

  setError: (error) =>
    set({ error }),

  setZeroPoint: (zeroPoint) =>
    set({ zeroPoint }),

  setIsZeroing: (isZeroing) =>
    set({ isZeroing }),

  reset: () =>
    set({
      session: null,
      stats: initialStats,
      isStarting: false,
      isStopping: false,
      isPaused: false,
      error: null,
      zeroPoint: null,
      isZeroing: false,
    }),
}));
