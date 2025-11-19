/**
 * Battery Optimization Service
 *
 * Handles battery optimization exemption requests to reduce app kills
 */

import { Platform, Linking, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const EXEMPTION_REQUESTED_KEY = '@vertex_battery_exemption_requested';
const EXEMPTION_GRANTED_KEY = '@vertex_battery_exemption_granted';

class BatteryOptimizationService {
  /**
   * Check if battery optimization is disabled for this app
   * Returns true if app is exempt from battery optimization
   */
  async isExemptFromBatteryOptimization(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return true; // iOS doesn't have this concept
    }

    try {
      // Check if we've cached the result
      const cached = await AsyncStorage.getItem(EXEMPTION_GRANTED_KEY);
      if (cached === 'true') {
        return true;
      }

      // Try to check via native module (requires adding native code)
      // For now, we'll rely on user feedback and cache
      return false;
    } catch (error) {
      console.error('[BatteryOptimization] Error checking exemption:', error);
      return false;
    }
  }

  /**
   * Check if we've already asked user for exemption
   */
  async hasRequestedExemption(): Promise<boolean> {
    try {
      const requested = await AsyncStorage.getItem(EXEMPTION_REQUESTED_KEY);
      return requested === 'true';
    } catch (error) {
      return false;
    }
  }

  /**
   * Mark that we've requested exemption (don't nag user)
   */
  async markExemptionRequested(): Promise<void> {
    try {
      await AsyncStorage.setItem(EXEMPTION_REQUESTED_KEY, 'true');
    } catch (error) {
      console.error('[BatteryOptimization] Failed to mark exemption requested:', error);
    }
  }

  /**
   * Mark that exemption was granted (cache for performance)
   */
  async markExemptionGranted(): Promise<void> {
    try {
      await AsyncStorage.setItem(EXEMPTION_GRANTED_KEY, 'true');
    } catch (error) {
      console.error('[BatteryOptimization] Failed to mark exemption granted:', error);
    }
  }

  /**
   * Open system battery optimization settings
   * Different manufacturers have different paths
   */
  async openBatteryOptimizationSettings(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return false;
    }

    try {
      // Try Android's standard intent for battery optimization settings
      const canOpen = await Linking.canOpenURL('package:com.android.settings');

      if (canOpen) {
        // This opens the battery optimization settings screen
        // User needs to manually find and exempt the app
        await Linking.openSettings();
        return true;
      }

      return false;
    } catch (error) {
      console.error('[BatteryOptimization] Failed to open settings:', error);
      return false;
    }
  }

  /**
   * Get manufacturer-specific instructions
   */
  getManufacturerInstructions(): { manufacturer: string; instructions: string[] } {
    // In a real implementation, you'd detect the manufacturer
    // For now, provide generic instructions

    return {
      manufacturer: 'Generic Android',
      instructions: [
        'Open Settings app',
        'Go to Apps → Special access → Battery optimization',
        'Find "Vertex" in the list',
        'Select "Don\'t optimize"',
        'Tap Done',
      ],
    };
  }

  /**
   * Get Samsung-specific instructions (most common problematic manufacturer)
   */
  getSamsungInstructions(): string[] {
    return [
      'Open Settings app',
      'Go to Device care → Battery',
      'Tap "App power management"',
      'Tap "Apps that won\'t be put to sleep"',
      'Tap "Add apps"',
      'Find and select "Vertex"',
      'Tap "Add"',
    ];
  }

  /**
   * Get Xiaomi/MIUI-specific instructions
   */
  getXiaomiInstructions(): string[] {
    return [
      'Open Settings app',
      'Go to Apps → Manage apps',
      'Find "Vertex"',
      'Tap "Battery saver"',
      'Select "No restrictions"',
      'Also enable "Autostart"',
    ];
  }

  /**
   * Should we show the battery exemption request?
   * Show only if:
   * 1. Android platform
   * 2. Haven't asked before
   * 3. User is starting a recording
   */
  async shouldRequestExemption(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return false;
    }

    const alreadyRequested = await this.hasRequestedExemption();
    const isExempt = await this.isExemptFromBatteryOptimization();

    // Show if we haven't asked AND not already exempt
    return !alreadyRequested && !isExempt;
  }
}

export default new BatteryOptimizationService();
