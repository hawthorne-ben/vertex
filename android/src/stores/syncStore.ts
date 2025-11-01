/**
 * Sync Store
 * Tracks which local files have been uploaded to the cloud
 */

import { create } from 'zustand';
import { createClient } from '../lib/supabase';
import { API_URL } from '@env';

interface SyncStatus {
  synced: boolean;
  recordingId?: string;
  status?: string;
  uploadedAt?: string;
}

interface SyncStore {
  syncStatus: Record<string, SyncStatus>;
  isChecking: boolean;
  lastChecked: Date | null;

  // Actions
  checkSyncStatus: (filenames: string[]) => Promise<void>;
  markAsSynced: (filename: string, recordingId: string) => void;
  isSynced: (filename: string) => boolean;
  clear: () => void;
}

export const useSyncStore = create<SyncStore>((set, get) => ({
  syncStatus: {},
  isChecking: false,
  lastChecked: null,

  checkSyncStatus: async (filenames: string[]) => {
    if (filenames.length === 0) return;

    set({ isChecking: true });

    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        console.warn('[SyncStore] Not authenticated, skipping sync check');
        set({ isChecking: false });
        return;
      }

      if (!API_URL) {
        console.error('[SyncStore] API_URL not configured');
        set({ isChecking: false });
        return;
      }

      const baseUrl = API_URL.startsWith('http') ? API_URL : `https://${API_URL}`;
      const apiUrl = `${baseUrl}/api/recordings/check-sync`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ filenames }),
      });

      if (!response.ok) {
        console.error('[SyncStore] Failed to check sync status:', response.status);
        set({ isChecking: false });
        return;
      }

      const result = await response.json();

      set({
        syncStatus: { ...get().syncStatus, ...result.syncStatus },
        isChecking: false,
        lastChecked: new Date(),
      });

      console.log('[SyncStore] Sync status updated for', filenames.length, 'files');

    } catch (error) {
      console.error('[SyncStore] Error checking sync status:', error);
      set({ isChecking: false });
    }
  },

  markAsSynced: (filename: string, recordingId: string) => {
    set(state => ({
      syncStatus: {
        ...state.syncStatus,
        [filename]: {
          synced: true,
          recordingId,
          status: 'ready',
          uploadedAt: new Date().toISOString(),
        },
      },
    }));
  },

  isSynced: (filename: string) => {
    return get().syncStatus[filename]?.synced || false;
  },

  clear: () => {
    set({
      syncStatus: {},
      isChecking: false,
      lastChecked: null,
    });
  },
}));
