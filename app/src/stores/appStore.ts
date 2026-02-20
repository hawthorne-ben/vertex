/**
 * App Store
 *
 * Global state for app-level settings and preferences
 */

import { create } from 'zustand';

export interface AppState {
  // Recording preferences
  selectedBike: string;
  selectedPosition: string;

  // Actions
  setSelectedBike: (bike: string) => void;
  setSelectedPosition: (position: string) => void;
  reset: () => void;
}

const initialState = {
  selectedBike: 'Bike 1',
  selectedPosition: 'Body',
};

export const useAppStore = create<AppState>((set) => ({
  ...initialState,

  setSelectedBike: (bike) =>
    set({ selectedBike: bike }),

  setSelectedPosition: (position) =>
    set({ selectedPosition: position }),

  reset: () =>
    set(initialState),
}));
