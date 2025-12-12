/**
 * GPS Service - Location tracking for recording sessions
 *
 * Uses react-native-geolocation-service which wraps Android's
 * Fused Location Provider for optimal battery life and accuracy
 */

import Geolocation from 'react-native-geolocation-service';
import { PermissionsAndroid, Platform } from 'react-native';
import { GPSRecord } from '@vertex-pkg/vtx-parser';

export interface GPSServiceOptions {
  /** Update interval in milliseconds (default: 1000ms = 1 second) */
  interval?: number;
  /** Fastest update interval in milliseconds (default: 500ms) */
  fastestInterval?: number;
  /** Desired accuracy (default: high accuracy) */
  accuracy?: 'high' | 'balanced' | 'low';
}

class GPSService {
  private watchId: number | null = null;
  private isTracking: boolean = false;
  private locationCallback: ((record: GPSRecord) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;

  /**
   * Request location permissions
   */
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return false;
    }

    try {
      const fineLocation = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'Vertex needs access to your location to record GPS data during rides.',
          buttonPositive: 'OK',
        }
      );

      if (fineLocation !== PermissionsAndroid.RESULTS.GRANTED) {
        console.log('[GPSService] Fine location permission denied');
        return false;
      }

      // On Android 10+ (API 29+), request background location permission
      if (Platform.Version >= 29) {
        const backgroundLocation = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
          {
            title: 'Background Location Permission',
            message: 'Vertex needs background location access to record GPS during rides.',
            buttonPositive: 'OK',
          }
        );

        if (backgroundLocation !== PermissionsAndroid.RESULTS.GRANTED) {
          console.log('[GPSService] Background location permission denied');
          return false;
        }
      }

      console.log('[GPSService] Location permissions granted');
      return true;
    } catch (error) {
      console.error('[GPSService] Error requesting permissions:', error);
      return false;
    }
  }

  /**
   * Check if location permissions are granted
   */
  async hasPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return false;
    }

    try {
      const granted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      return granted;
    } catch (error) {
      console.error('[GPSService] Error checking permissions:', error);
      return false;
    }
  }

  /**
   * Start GPS tracking
   */
  async startTracking(
    onLocation: (record: GPSRecord) => void,
    onError: (error: Error) => void,
    options: GPSServiceOptions = {}
  ): Promise<void> {
    if (this.isTracking) {
      console.warn('[GPSService] Already tracking');
      return;
    }

    // Check permissions
    const hasPermission = await this.hasPermissions();
    if (!hasPermission) {
      const granted = await this.requestPermissions();
      if (!granted) {
        throw new Error('Location permissions not granted');
      }
    }

    this.locationCallback = onLocation;
    this.errorCallback = onError;

    const {
      interval = 1000,
      fastestInterval = 500,
      accuracy = 'high',
    } = options;

    // Map accuracy to Geolocation options
    let enableHighAccuracy = true;
    let distanceFilter = 0;

    if (accuracy === 'balanced') {
      enableHighAccuracy = false;
      distanceFilter = 5; // 5 meters
    } else if (accuracy === 'low') {
      enableHighAccuracy = false;
      distanceFilter = 10; // 10 meters
    }

    console.log('[GPSService] Starting GPS tracking with options:', {
      interval,
      fastestInterval,
      accuracy,
      enableHighAccuracy,
      distanceFilter,
    });

    this.watchId = Geolocation.watchPosition(
      (position) => {
        try {
          const record: GPSRecord = {
            timestamp: position.timestamp,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            altitude: position.coords.altitude,
            speed: position.coords.speed,
            bearing: position.coords.heading,
            accuracy: position.coords.accuracy,
          };

          this.locationCallback?.(record);
        } catch (error: any) {
          console.error('[GPSService] Error processing location:', error);
          this.errorCallback?.(error);
        }
      },
      (error) => {
        console.error('[GPSService] Location error:', error);
        this.errorCallback?.(new Error(`GPS error: ${error.message} (code: ${error.code})`));
      },
      {
        enableHighAccuracy,
        distanceFilter,
        interval,
        fastestInterval,
        forceRequestLocation: true,
        showLocationDialog: true,
        useSignificantChanges: false,
      }
    );

    this.isTracking = true;
    console.log('[GPSService] GPS tracking started');
  }

  /**
   * Stop GPS tracking
   */
  stopTracking(): void {
    if (!this.isTracking || this.watchId === null) {
      return;
    }

    Geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.isTracking = false;
    this.locationCallback = null;
    this.errorCallback = null;

    console.log('[GPSService] GPS tracking stopped');
  }

  /**
   * Check if currently tracking
   */
  isCurrentlyTracking(): boolean {
    return this.isTracking;
  }

  /**
   * Get current location (one-time)
   */
  async getCurrentLocation(): Promise<GPSRecord> {
    return new Promise((resolve, reject) => {
      Geolocation.getCurrentPosition(
        (position) => {
          const record: GPSRecord = {
            timestamp: position.timestamp,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            altitude: position.coords.altitude,
            speed: position.coords.speed,
            bearing: position.coords.heading,
            accuracy: position.coords.accuracy,
          };
          resolve(record);
        },
        (error) => {
          reject(new Error(`GPS error: ${error.message} (code: ${error.code})`));
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 10000,
        }
      );
    });
  }
}

export default new GPSService();
