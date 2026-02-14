/**
 * Recording Service - Foreground with Optimized Buffering
 *
 * Architecture:
 * - BLE subscription on main thread (required by BLE stack)
 * - Large buffers (1000 samples = 10 seconds @ 100Hz)
 * - Async file writes that yield to event loop
 * - Handles connection interruptions gracefully
 * - Supports both CSV and VTX binary formats
 */

import FileService, { IMUSensorData } from './FileService';
import VTXFileService from './VTXFileService';
import BleService from './BleService';
import GPSService from './GPSService';
import { IMURecord, GPSRecord, VTXMetadata, VTXStreamEncoder } from '@vertex-pkg/vtx-parser';
import { useDeviceStore } from '../stores/deviceStore';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NotificationService from './NotificationService';

export type RecordingFormat = 'csv' | 'vtx';

export interface RecordingSession {
  id: string;
  filePath: string;
  fileName: string;
  deviceId: string;
  deviceName: string;
  startTime: Date;
  endTime?: Date;
  sampleCount: number;
  isRecording: boolean;
  isPaused: boolean;
  lastSampleTime?: Date;
  connectionLostTime?: Date;
  zeroPoint?: any;
  format: RecordingFormat;
  sampleRate: number;
}

const ACTIVE_SESSION_KEY = '@vertex_active_recording_session';

class RecordingService {
  private currentSession: RecordingSession | null = null;
  private zeroPoint: any = null;

  // BLE subscription
  private subscription: any = null;

  // Buffering with larger size for better performance
  private writeBuffer: IMUSensorData[] = [];
  private readonly BUFFER_SIZE = 250; // 2.5 seconds at 100Hz
  private isWriting: boolean = false;
  private isStopping: boolean = false; // Flag to prevent new flushes during stop
  private flushPending: boolean = false;

  // GPS tracking
  private gpsBuffer: GPSRecord[] = [];
  private readonly GPS_BUFFER_SIZE = 100; // ~100 seconds at 1Hz
  private isGPSEnabled: boolean = false;

  // VTX stream encoder
  private vtxStreamEncoder: VTXStreamEncoder | null = null;

  // Timestamp synchronization (firmware timestamp → absolute time)
  private baseTimestamp: number | null = null;  // Android Date.now() at recording start
  private baseOffset: number | null = null;      // First firmware timestamp

  // Debug tracking
  private debugSampleCount = 0;
  private debugStartTime = Date.now();
  private debugLastLogTime = Date.now();

  private readonly DEFAULT_SAMPLE_RATE = 100;

  /**
   * Initialize service
   */
  initialize(): void {
    console.log('[RecordingService] Initializing');
    this.cleanup();
  }

  /**
   * Check for interrupted recording session on app startup
   * Returns session if found, null otherwise
   */
  async checkForInterruptedSession(): Promise<RecordingSession | null> {
    try {
      const sessionJson = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
      if (!sessionJson) {
        return null;
      }

      const session: RecordingSession = JSON.parse(sessionJson);

      // Convert date strings back to Date objects
      session.startTime = new Date(session.startTime);
      if (session.endTime) {
        session.endTime = new Date(session.endTime);
      }
      if (session.lastSampleTime) {
        session.lastSampleTime = new Date(session.lastSampleTime);
      }
      if (session.connectionLostTime) {
        session.connectionLostTime = new Date(session.connectionLostTime);
      }

      console.log('[RecordingService] Found interrupted session:', session.id);
      return session;
    } catch (error) {
      console.error('[RecordingService] Error checking for interrupted session:', error);
      return null;
    }
  }

  /**
   * Persist current session to storage (survives app crash)
   */
  private async persistSession(): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    try {
      const sessionJson = JSON.stringify(this.currentSession);
      await AsyncStorage.setItem(ACTIVE_SESSION_KEY, sessionJson);
    } catch (error) {
      console.error('[RecordingService] Failed to persist session:', error);
    }
  }

  /**
   * Clear persisted session from storage (public for recovery flow)
   */
  async clearPersistedSession(): Promise<void> {
    try {
      await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch (error) {
      console.error('[RecordingService] Failed to clear persisted session:', error);
    }
  }

  /**
   * Start recording session
   */
  async startRecording(
    deviceId: string,
    deviceName: string,
    zeroPoint?: any,
    format: RecordingFormat = 'vtx',
    sampleRate: number = this.DEFAULT_SAMPLE_RATE
  ): Promise<RecordingSession> {
    if (this.currentSession?.isRecording) {
      throw new Error('Recording already in progress');
    }

    console.log(`[RecordingService] Starting ${format.toUpperCase()} recording for device: ${deviceName}`);

    this.zeroPoint = zeroPoint || null;

    try {
      // Create file
      let filePath: string;
      let fileName: string;

      if (format === 'vtx') {
        filePath = await VTXFileService.createRecordingFile(deviceName, sampleRate);
        fileName = filePath.split('/').pop() || 'recording.vtx';

        // Initialize VTX stream encoder
        const writeCallback = async (chunk: Uint8Array) => {
          let binary = '';
          for (let i = 0; i < chunk.byteLength; i++) {
            binary += String.fromCharCode(chunk[i]);
          }
          const base64 = btoa(binary);
          await RNFS.appendFile(filePath, base64, 'base64');
        };

        const vtxMetadata: VTXMetadata = {
          device: {
            id: deviceId,
            name: deviceName,
          },
          session: {
            createdAt: new Date().toISOString(),
          },
          calibration: this.zeroPoint ? {
            zeroPoint: this.zeroPoint,
            applied: true,
          } : undefined,
        };

        this.vtxStreamEncoder = new VTXStreamEncoder({
          sampleRate,
          includeMag: false,  // Magnetometer removed - using 6DoF mode
          includeQuat: false,
          includeEuler: true,  // Enable Euler angles (roll, pitch, yaw)
          includeGPS: true,    // Enable GPS tracking
          metadata: vtxMetadata,
          writeCallback,
        });

        await this.vtxStreamEncoder.initialize();
        console.log('[RecordingService] VTX stream encoder initialized');
      } else {
        const result = await FileService.createRecordingFile(deviceName);
        filePath = result.filePath;
        fileName = result.fileName;
      }

      // Initialize session
      this.currentSession = {
        id: `${Date.now()}_${deviceId}`,
        filePath,
        fileName,
        deviceId,
        deviceName,
        startTime: new Date(),
        sampleCount: 0,
        isRecording: true,
        isPaused: false,
        zeroPoint: this.zeroPoint,
        format,
        sampleRate
      };

      // Reset debug tracking
      this.debugSampleCount = 0;
      this.debugStartTime = Date.now();
      this.debugLastLogTime = Date.now();

      // Reset timestamp synchronization
      this.baseTimestamp = null;
      this.baseOffset = null;

      // Subscribe to BLE data stream
      await this.subscribeToData();

      // Start GPS tracking (only for VTX format)
      if (format === 'vtx') {
        await this.startGPSTracking();
      }

      // Start foreground service via notification (prevents OS from killing app)
      await NotificationService.showRecordingNotification(
        true,
        deviceName,
        '00:00',
        0,
        deviceId,
      );

      // Persist session to survive crashes
      await this.persistSession();

      console.log(`[RecordingService] Recording started: ${fileName}`);

      return this.currentSession;
    } catch (error: any) {
      console.error('[RecordingService] Failed to start recording:', error);
      this.cleanup();
      throw new Error(`Failed to start recording: ${error.message}`);
    }
  }

  /**
   * Stop recording session
   */
  async stopRecording(): Promise<RecordingSession | null> {
    if (!this.currentSession) {
      return null;
    }

    console.log('[RecordingService] Stopping recording...');
    this.isStopping = true; // Set flag to prevent new background flushes

    const session = { ...this.currentSession };
    session.isRecording = false;
    session.endTime = new Date();

    try {
      // Unsubscribe from BLE
      if (this.subscription) {
        this.subscription.remove();
        this.subscription = null;
      }

      // Stop GPS tracking
      this.stopGPSTracking();

      // Wait a moment for any pending setImmediate callbacks to see isStopping flag
      await new Promise(resolve => setTimeout(resolve, 100));

      // Flush any remaining buffered data
      await this.flushBuffer();

      // Flush any remaining GPS data
      await this.flushGPSBuffer();

      // Header is already kept up-to-date by periodic updates in flushBuffer(),
      // so no full-file rewrite is needed here.
      if (session.format === 'vtx' && this.vtxStreamEncoder) {
        console.log('[RecordingService] VTX file finalized (header already current)');
      }

      console.log(`[RecordingService] Recording stopped: ${session.sampleCount} samples recorded`);

      // Stop foreground service (Android) or just hide notification (iOS)
      if (Platform.OS === 'android') {
        await NotificationService.stopForegroundService();
        (global as any).__stopForegroundService?.();
      } else {
        await NotificationService.hideRecordingNotification();
      }

      // Clear persisted session (recording complete)
      await this.clearPersistedSession();

      this.cleanup();

      return session;
    } catch (error: any) {
      console.error('[RecordingService] Error stopping recording:', error);
      this.cleanup();
      throw new Error(`Failed to stop recording: ${error.message}`);
    }
  }

  /**
   * Pause recording
   */
  pauseRecording(): void {
    if (this.currentSession && this.currentSession.isRecording) {
      this.currentSession.isPaused = true;
      console.log('[RecordingService] Recording paused');
    }
  }

  /**
   * Resume recording
   */
  async resumeRecording(): Promise<void> {
    if (this.currentSession && this.currentSession.isPaused) {
      this.currentSession.isPaused = false;
      this.currentSession.connectionLostTime = undefined;
      console.log('[RecordingService] Recording resumed');

      // Clean up old subscription
      if (this.subscription) {
        try {
          this.subscription.remove();
          this.subscription = null;
        } catch (err) {
          console.warn('[RecordingService] Failed to clean up old subscription:', err);
        }
      }

      // Wait for BLE to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Re-subscribe with retry
      let retries = 0;
      const maxRetries = 2;
      while (retries < maxRetries) {
        try {
          await this.subscribeToData();
          console.log('[RecordingService] Successfully subscribed to data stream');
          break;
        } catch (error: any) {
          retries++;
          if (retries >= maxRetries) {
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
  }

  /**
   * Get current session
   */
  getCurrentSession(): RecordingSession | null {
    return this.currentSession ? { ...this.currentSession } : null;
  }

  /**
   * Check if recording
   */
  isRecording(): boolean {
    return (this.currentSession?.isRecording && !this.currentSession?.isPaused) || false;
  }

  /**
   * Subscribe to BLE data stream
   */
  private async subscribeToData(): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    try {
      this.subscription = await BleService.subscribeToIMUStream(
        (data) => {
          this.handleDataReceived(data);
        },
        (error) => {
          this.handleConnectionError(error);
        }
      );
    } catch (error: any) {
      console.error('[RecordingService] Subscription error:', error);
      this.handleConnectionError(error);
      throw error;
    }
  }

  /**
   * Handle incoming IMU data
   */
  private handleDataReceived(data: any): void {
    if (!this.currentSession || !this.currentSession.isRecording || this.currentSession.isPaused) {
      return;
    }

    // Track actual sample rate
    this.debugSampleCount++;
    const now = Date.now();
    const elapsedSeconds = (now - this.debugStartTime) / 1000;
    const actualHz = this.debugSampleCount / elapsedSeconds;

    // Log every 5 seconds (reduced logging frequency)
    if (now - this.debugLastLogTime >= 5000) {
      console.log(`[RecordingService] Sample rate: ${actualHz.toFixed(1)} Hz | Buffer: ${this.writeBuffer.length}/${this.BUFFER_SIZE}`);
      this.debugLastLogTime = now;
    }

    try {
      // Initialize timestamp synchronization on first sample
      if (this.baseTimestamp === null && data.timestamp !== undefined) {
        this.baseTimestamp = Date.now();
        this.baseOffset = data.timestamp;
        console.log(`[RecordingService] Timestamp sync initialized: base=${this.baseTimestamp}, offset=${this.baseOffset}`);
      }

      // Calculate absolute timestamp from firmware timestamp
      let absoluteTime: number;
      if (this.baseTimestamp !== null && this.baseOffset !== null && data.timestamp !== undefined) {
        // Firmware timestamp (ms since boot) + offset = absolute time
        absoluteTime = this.baseTimestamp + (data.timestamp - this.baseOffset);
      } else {
        // Fallback to Android time if firmware timestamp unavailable
        absoluteTime = Date.now();
      }

      // Update battery voltage ONLY once every 10 samples (once per second @ 10Hz)
      if (data.batteryVoltage !== undefined && this.currentSession.sampleCount % 10 === 0) {
        useDeviceStore.getState().setBattery(null, data.batteryVoltage);
      }

      // Apply zero point offset (reuse data object instead of spread for performance)
      let processedData = data;
      if (this.zeroPoint) {
        processedData = {
          ...data,
          accelX: (data.accelX ?? 0) - (this.zeroPoint.accelX || 0),
          accelY: (data.accelY ?? 0) - (this.zeroPoint.accelY || 0),
          accelZ: (data.accelZ ?? 0) - (this.zeroPoint.accelZ || 0),
          gyroX: (data.gyroX ?? 0) - (this.zeroPoint.gyroX || 0),
          gyroY: (data.gyroY ?? 0) - (this.zeroPoint.gyroY || 0),
          gyroZ: (data.gyroZ ?? 0) - (this.zeroPoint.gyroZ || 0),
          // Magnetometer removed - using 6DoF mode
        };
      }

      // Convert to IMU format with firmware-based timestamp
      const imuData: IMUSensorData = {
        timestamp: new Date(absoluteTime),  // Use firmware timestamp + offset
        accel_x: processedData.accelX ?? 0,
        accel_y: processedData.accelY ?? 0,
        accel_z: processedData.accelZ ?? 0,
        gyro_x: processedData.gyroX ?? 0,
        gyro_y: processedData.gyroY ?? 0,
        gyro_z: processedData.gyroZ ?? 0,
        // Magnetometer removed - using 6DoF mode
        // Add Euler angles from BLE data (fused orientation from BNO055)
        roll: processedData.roll,
        pitch: processedData.pitch,
        yaw: processedData.yaw
      };

      // Add to buffer
      this.writeBuffer.push(imuData);
      this.currentSession.sampleCount++;
      this.currentSession.lastSampleTime = new Date();

      // Clear connection lost time
      if (this.currentSession.connectionLostTime) {
        this.currentSession.connectionLostTime = undefined;
      }

      // Don't notify on every sample - let UI poll getCurrentSession() instead
      // This prevents forcing React re-renders on a callback schedule

      // Flush buffer when it reaches threshold
      if (this.writeBuffer.length >= this.BUFFER_SIZE && !this.isStopping) {
        // Use setImmediate to yield to event loop
        setImmediate(() => {
          // Double-check we're not stopping before flushing
          if (!this.isStopping) {
            this.flushBuffer().catch(err => {
              console.error('[RecordingService] Buffer flush error:', err);
            });
          }
        });
      }

      // Periodically persist session state (every 1000 samples = ~10 seconds at 100Hz)
      if (this.currentSession.sampleCount % 1000 === 0) {
        this.persistSession().catch(err => {
          console.error('[RecordingService] Failed to persist session:', err);
        });
      }
    } catch (error: any) {
      console.error('[RecordingService] Error handling data:', error);
    }
  }

  /**
   * Handle connection errors
   */
  private handleConnectionError(error: Error): void {
    if (!this.currentSession || this.currentSession.isPaused) {
      return;
    }

    console.error('[RecordingService] Connection error:', error.message);

    // Pause recording
    this.currentSession.isPaused = true;
    this.currentSession.connectionLostTime = new Date();

    // Flush any buffered data
    this.flushBuffer().catch(err => {
      console.error('[RecordingService] Failed to flush buffer after connection error:', err);
    });
  }

  /**
   * Flush write buffer to file (async, non-blocking)
   */
  private async flushBuffer(): Promise<void> {
    if (this.writeBuffer.length === 0 || !this.currentSession) {
      return;
    }

    if (this.isWriting) {
      this.flushPending = true;
      return;
    }

    this.isWriting = true;
    const dataToWrite = [...this.writeBuffer];
    this.writeBuffer = [];

    try {
      if (this.currentSession.format === 'vtx' && this.vtxStreamEncoder) {
        // Write to VTX stream in chunks to avoid blocking
        const CHUNK_SIZE = 100;
        const encoder = this.vtxStreamEncoder; // Cache reference to avoid null check issues

        for (let i = 0; i < dataToWrite.length; i += CHUNK_SIZE) {
          // Check if session still exists (recording might have stopped during async operation)
          if (!this.currentSession) {
            console.log('[RecordingService] Session was stopped, aborting flush');
            break;
          }

          const chunk = dataToWrite.slice(i, i + CHUNK_SIZE);

          for (const data of chunk) {
            const imuRecord: IMURecord = {
              timestamp: data.timestamp.getTime(),
              accelX: data.accel_x,
              accelY: data.accel_y,
              accelZ: data.accel_z,
              gyroX: data.gyro_x,
              gyroY: data.gyro_y,
              gyroZ: data.gyro_z,
              magX: data.mag_x,
              magY: data.mag_y,
              magZ: data.mag_z,
              quatW: data.quat_w,
              quatX: data.quat_x,
              quatY: data.quat_y,
              quatZ: data.quat_z,
              roll: data.roll,
              pitch: data.pitch,
              yaw: data.yaw,
            };
            await encoder.addRecord(imuRecord);
          }

          // Yield to event loop every chunk
          if (i + CHUNK_SIZE < dataToWrite.length) {
            await new Promise(resolve => setImmediate(resolve));
          }
        }
      } else {
        // CSV: Write in chunks
        const CHUNK_SIZE = 100;
        for (let i = 0; i < dataToWrite.length; i += CHUNK_SIZE) {
          const chunk = dataToWrite.slice(i, i + CHUNK_SIZE);

          for (const data of chunk) {
            await FileService.appendIMUData(this.currentSession.filePath, data);
          }

          // Yield to event loop every chunk
          if (i + CHUNK_SIZE < dataToWrite.length) {
            await new Promise(resolve => setImmediate(resolve));
          }
        }
      }

      // Periodic header update: keep VTX header current so file is valid if app is killed
      if (this.currentSession.format === 'vtx' && this.vtxStreamEncoder && this.currentSession.sampleCount > 0) {
        try {
          const header = this.vtxStreamEncoder.finalize();
          let binary = '';
          for (let i = 0; i < header.byteLength; i++) {
            binary += String.fromCharCode(header[i]);
          }
          const headerBase64 = btoa(binary);
          await RNFS.write(this.currentSession.filePath, headerBase64, 0, 'base64');
        } catch (headerErr) {
          console.warn('[RecordingService] Failed to update header:', headerErr);
        }
      }

      console.log(`[RecordingService] Flushed ${dataToWrite.length} samples to ${this.currentSession.format} file`);
    } catch (error: any) {
      console.error('[RecordingService] Write error:', error);

      // Put data back in buffer on error
      this.writeBuffer.unshift(...dataToWrite);
    } finally {
      this.isWriting = false;

      // Flush queue: if data arrived while we were writing, flush again
      if (this.flushPending) {
        this.flushPending = false;
        this.flushBuffer().catch(err => {
          console.error('[RecordingService] Queued flush error:', err);
        });
      }
    }
  }

  /**
   * Start GPS tracking
   */
  private async startGPSTracking(): Promise<void> {
    try {
      // Check/request permissions
      const hasPermission = await GPSService.hasPermissions();
      if (!hasPermission) {
        const granted = await GPSService.requestPermissions();
        if (!granted) {
          console.warn('[RecordingService] GPS permissions not granted, continuing without GPS');
          return;
        }
      }

      // Start tracking with 1 second interval
      await GPSService.startTracking(
        (record) => {
          this.handleGPSReceived(record);
        },
        (error) => {
          console.error('[RecordingService] GPS error:', error);
        },
        {
          interval: 1000,        // 1 second updates
          fastestInterval: 500,  // Accept updates as fast as 500ms
          accuracy: 'high',      // High accuracy mode
        }
      );

      this.isGPSEnabled = true;
      console.log('[RecordingService] GPS tracking started');
    } catch (error: any) {
      console.error('[RecordingService] Failed to start GPS tracking:', error);
      console.warn('[RecordingService] Continuing without GPS');
    }
  }

  /**
   * Stop GPS tracking
   */
  private stopGPSTracking(): void {
    if (!this.isGPSEnabled) {
      return;
    }

    GPSService.stopTracking();
    this.isGPSEnabled = false;
    console.log('[RecordingService] GPS tracking stopped');
  }

  /**
   * Handle incoming GPS data
   */
  private handleGPSReceived(record: GPSRecord): void {
    if (!this.currentSession || !this.currentSession.isRecording || this.currentSession.isPaused) {
      return;
    }

    try {
      // Add to GPS buffer
      this.gpsBuffer.push(record);

      // Flush GPS buffer when it reaches threshold
      if (this.gpsBuffer.length >= this.GPS_BUFFER_SIZE && !this.isStopping) {
        setImmediate(() => {
          if (!this.isStopping) {
            this.flushGPSBuffer().catch(err => {
              console.error('[RecordingService] GPS buffer flush error:', err);
            });
          }
        });
      }
    } catch (error: any) {
      console.error('[RecordingService] Error handling GPS data:', error);
    }
  }

  /**
   * Flush GPS buffer to VTX stream
   */
  private async flushGPSBuffer(): Promise<void> {
    if (this.gpsBuffer.length === 0 || !this.currentSession || !this.vtxStreamEncoder) {
      return;
    }

    const dataToWrite = [...this.gpsBuffer];
    this.gpsBuffer = [];

    try {
      for (const record of dataToWrite) {
        await this.vtxStreamEncoder.addGPSRecord(record);
      }

      console.log(`[RecordingService] Flushed ${dataToWrite.length} GPS records to VTX file`);
    } catch (error: any) {
      console.error('[RecordingService] GPS write error:', error);

      // Put data back in buffer on error
      this.gpsBuffer.unshift(...dataToWrite);
    }
  }

  /**
   * Cleanup
   */
  private cleanup(): void {
    if (this.subscription) {
      try {
        this.subscription.remove();
      } catch (err) {
        console.warn('[RecordingService] Error removing subscription:', err);
      }
      this.subscription = null;
    }

    // Stop GPS tracking if active
    if (this.isGPSEnabled) {
      this.stopGPSTracking();
    }

    this.currentSession = null;
    this.zeroPoint = null;
    this.writeBuffer = [];
    this.gpsBuffer = [];
    this.isWriting = false;
    this.isStopping = false;
    this.flushPending = false;
    this.isGPSEnabled = false;
    this.vtxStreamEncoder = null;
    this.baseTimestamp = null;
    this.baseOffset = null;
    this.debugSampleCount = 0;
    this.debugStartTime = Date.now();
    this.debugLastLogTime = Date.now();
  }
}

export default new RecordingService();
