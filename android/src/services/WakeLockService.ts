/**
 * Wake Lock Service
 *
 * Prevents CPU from sleeping during recording
 * Uses react-native-keep-awake
 */

import KeepAwake from 'react-native-keep-awake';

class WakeLockService {
  private isActive: boolean = false;

  /**
   * Acquire wake lock - keeps CPU running during recording
   */
  async acquire(): Promise<void> {
    if (this.isActive) {
      console.log('[WakeLock] Already active');
      return;
    }

    try {
      KeepAwake.activate();
      console.log('[WakeLock] Wake lock acquired');
      this.isActive = true;
    } catch (error) {
      console.error('[WakeLock] Failed to acquire wake lock:', error);
    }
  }

  /**
   * Release wake lock - allows CPU to sleep again
   */
  async release(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    try {
      KeepAwake.deactivate();
      console.log('[WakeLock] Wake lock released');
      this.isActive = false;
    } catch (error) {
      console.error('[WakeLock] Failed to release wake lock:', error);
    }
  }

  /**
   * Check if wake lock is active
   */
  isWakeLockActive(): boolean {
    return this.isActive;
  }
}

export default new WakeLockService();
