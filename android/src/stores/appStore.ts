/**
 * App Store
 *
 * Global state for app-level settings and preferences
 */

import { create } from 'zustand';
import { RecordingFormat } from '../services/RecordingService';

export interface AppState {
  // Recording preferences
  selectedBike: string;
  selectedPosition: string;
  recordingFormat: RecordingFormat;

  // Actions
  setSelectedBike: (bike: string) => void;
  setSelectedPosition: (position: string) => void;
  setRecordingFormat: (format: RecordingFormat) => void;
  reset: () => void;
}

const initialState = {
  selectedBike: 'Bike 1',
  selectedPosition: 'Body',
  recordingFormat: 'vtx' as RecordingFormat,
};

export const useAppStore = create<AppState>((set) => ({
  ...initialState,

  setSelectedBike: (bike) =>
    set({ selectedBike: bike }),

  setSelectedPosition: (position) =>
    set({ selectedPosition: position }),

  setRecordingFormat: (format) =>
    set({ recordingFormat: format }),

  reset: () =>
    set(initialState),
}));
