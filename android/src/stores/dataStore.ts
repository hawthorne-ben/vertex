/**
 * Data Store
 *
 * Global state for recordings and stats
 */

import { create } from 'zustand';
import FileService, { RecordingMetadata } from '../services/FileService';
import VTXFileService from '../services/VTXFileService';

export interface DataStats {
  totalRecordings: number;
  totalHours: number;
  storageUsed: number; // MB
}

export interface DataState {
  // State
  recordings: RecordingMetadata[];
  stats: DataStats;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadRecordings: () => Promise<void>;
  deleteRecording: (fileName: string) => Promise<void>;
  refreshStats: () => void;
  clearError: () => void;
  reset: () => void;
}

const initialState = {
  recordings: [],
  stats: {
    totalRecordings: 0,
    totalHours: 0,
    storageUsed: 0,
  },
  isLoading: false,
  error: null,
};

export const useDataStore = create<DataState>((set, get) => ({
  ...initialState,

  loadRecordings: async () => {
    set({ isLoading: true, error: null });
    try {
      const allRecordings = await FileService.getRecordings();
      set({ recordings: allRecordings, isLoading: false });

      // Automatically calculate stats after loading
      get().refreshStats();
    } catch (error: any) {
      console.error('[dataStore] Error loading recordings:', error);
      set({ error: error.message, isLoading: false });
    }
  },

  deleteRecording: async (fileName: string) => {
    try {
      const recording = get().recordings.find(r => r.fileName === fileName);
      if (!recording) {
        throw new Error('Recording not found');
      }

      // Delete using the appropriate service based on file extension
      if (fileName.endsWith('.vtx')) {
        await VTXFileService.deleteRecording(recording.filePath);
      } else {
        await FileService.deleteRecording(fileName);
      }

      // Remove from state
      const updatedRecordings = get().recordings.filter(r => r.fileName !== fileName);
      set({ recordings: updatedRecordings });

      // Recalculate stats
      get().refreshStats();

      console.log('[dataStore] Recording deleted:', fileName);
    } catch (error: any) {
      console.error('[dataStore] Error deleting recording:', error);
      throw error;
    }
  },

  refreshStats: () => {
    const recordings = get().recordings;

    const totalRecordings = recordings.length;
    let totalDurationSec = 0;
    let totalBytes = 0;

    for (const rec of recordings) {
      totalBytes += rec.fileSize;
      if (rec.startTime && rec.endTime) {
        const durationMs = rec.endTime.getTime() - rec.startTime.getTime();
        const durationSec = durationMs / 1000;
        totalDurationSec += durationSec;
      }
    }

    const totalHours = totalDurationSec / 3600;
    const storageUsedMB = totalBytes / (1024 * 1024);

    set({
      stats: {
        totalRecordings,
        totalHours,
        storageUsed: parseFloat(storageUsedMB.toFixed(1)),
      },
    });

    console.log(`[dataStore] Stats updated - recordings: ${totalRecordings}, duration: ${totalDurationSec}s (${totalHours}h), storage: ${storageUsedMB}MB`);
  },

  clearError: () => set({ error: null }),

  reset: () => set(initialState),
}));
