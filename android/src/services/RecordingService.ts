/**
 * Recording Service
 *
 * Manages IMU data recording sessions with robust error handling:
 * - Handles connection interruptions gracefully
 * - Buffers data to prevent loss during file writes
 * - Tracks recording metadata (start time, sample count, etc.)
 * - Auto-recovery on reconnection
 * - Supports both CSV and VTX binary formats
 */

import FileService, { IMUSensorData } from './FileService';
import VTXFileService from './VTXFileService';
import BleService from './BleService';
import { IMURecord, VTXMetadata } from '@vertex/vtx-parser';
import { useDeviceStore } from '../stores/deviceStore';

export type RecordingFormat = 'csv' | 'vtx';

export interface RecordingSession {
  id: string;
  filePath: string;
  fileName: string;
  deviceId: string;
  deviceName: string;
  startTime: Date;
  endTime?: Date; // Time when recording stopped
  sampleCount: number;
  isRecording: boolean;
  isPaused: boolean;
  lastSampleTime?: Date;
  connectionLostTime?: Date;
  zeroPoint?: any; // Zero point calibration applied to this recording
  format: RecordingFormat; // File format (csv or vtx)
  sampleRate: number; // Sample rate for VTX encoding
}

export type RecordingStatusCallback = (session: RecordingSession) => void;
export type RecordingErrorCallback = (error: Error) => void;

class RecordingService {
  private currentSession: RecordingSession | null = null;
  private subscription: any = null;
  private writeBuffer: IMUSensorData[] = [];
  private allRecords: IMUSensorData[] = []; // Store all records for VTX encoding
  private isWriting: boolean = false;
  private statusCallback: RecordingStatusCallback | null = null;
  private errorCallback: RecordingErrorCallback | null = null;
  private writeInterval: NodeJS.Timeout | null = null;
  private zeroPoint: any = null; // Current zero point for offset calculations

  // Debug: Track actual sample rate
  private debugSampleCount: number = 0;
  private debugStartTime: number = 0;
  private debugLastLogTime: number = 0;

  // Buffer configuration
  private readonly BUFFER_SIZE = 50; // Write every 50 samples
  private readonly BUFFER_FLUSH_INTERVAL = 2000; // Flush every 2 seconds minimum
  private readonly DEFAULT_SAMPLE_RATE = 100; // Default sample rate in Hz

  /**
   * Initialize service on app start - clears any stale session state
   */
  initialize(): void {
    console.log('[RecordingService] Initializing - clearing any stale session state');
    this.currentSession = null;
    this.subscription = null;
    this.writeBuffer = [];
    this.allRecords = [];
    this.isWriting = false;
    this.statusCallback = null;
    this.errorCallback = null;
    if (this.writeInterval) {
      clearInterval(this.writeInterval);
      this.writeInterval = null;
    }
  }

  /**
   * Start a new recording session
   */
  async startRecording(
    deviceId: string,
    deviceName: string,
    onStatus?: RecordingStatusCallback,
    onError?: RecordingErrorCallback,
    zeroPoint?: any,
    format: RecordingFormat = 'csv',
    sampleRate: number = this.DEFAULT_SAMPLE_RATE
  ): Promise<RecordingSession> {
    if (this.currentSession?.isRecording) {
      throw new Error('Recording already in progress');
    }

    console.log(`[RecordingService] Starting ${format.toUpperCase()} recording for device: ${deviceName}`);

    // Store callbacks and zero point
    this.statusCallback = onStatus || null;
    this.errorCallback = onError || null;
    this.zeroPoint = zeroPoint || null;

    try {
      // Create new recording file based on format
      let filePath: string;
      let fileName: string;

      if (format === 'vtx') {
        filePath = await VTXFileService.createRecordingFile(deviceName, sampleRate);
        fileName = filePath.split('/').pop() || 'recording.vtx';
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

      // Clear previous recording data
      this.writeBuffer = [];
      this.allRecords = [];

      // Reset debug counters
      this.debugSampleCount = 0;
      this.debugStartTime = Date.now();
      this.debugLastLogTime = Date.now();

      // Start data subscription
      await this.subscribeToData();

      // Start periodic buffer flush (CSV only)
      if (format === 'csv') {
        this.writeInterval = setInterval(() => {
          this.flushBuffer().catch(err => {
            console.error('[RecordingService] Buffer flush error:', err);
          });
        }, this.BUFFER_FLUSH_INTERVAL);
      }

      this.notifyStatus();
      console.log(`[RecordingService] Recording started: ${fileName}`);

      return this.currentSession;
    } catch (error: any) {
      console.error('[RecordingService] Failed to start recording:', error);
      this.cleanup();
      throw new Error(`Failed to start recording: ${error.message}`);
    }
  }

  /**
   * Stop the current recording session
   */
  async stopRecording(): Promise<RecordingSession | null> {
    if (!this.currentSession) {
      return null;
    }

    console.log('[RecordingService] Stopping recording...');

    const session = { ...this.currentSession };
    session.isRecording = false;
    session.endTime = new Date(); // Capture the end time

    try {
      // Handle format-specific finalization
      if (session.format === 'vtx') {
        // For VTX: encode all records at once
        console.log(`[RecordingService] Encoding ${this.allRecords.length} records to VTX format...`);

        // Convert IMUSensorData to IMURecord format
        const imuRecords: IMURecord[] = this.allRecords.map(data => ({
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
        }));

        // Create metadata
        const metadata: VTXMetadata = {
          device: {
            id: session.deviceId,
            name: session.deviceName,
          },
          session: {
            createdAt: session.startTime.toISOString(),
          },
          calibration: session.zeroPoint ? {
            zeroPoint: session.zeroPoint,
            applied: true,
          } : undefined,
        };

        // Write VTX file
        await VTXFileService.writeVTXFile(
          session.filePath,
          imuRecords,
          session.sampleRate,
          metadata,
          {
            includeMag: imuRecords.some(r => r.magX !== undefined),
            includeQuat: imuRecords.some(r => r.quatW !== undefined),
          }
        );

        console.log(`[RecordingService] VTX file written: ${session.filePath}`);
      } else {
        // For CSV: flush any remaining buffered data
        await this.flushBuffer();
      }

      // Unsubscribe from data stream
      if (this.subscription) {
        try {
          this.subscription.remove();
        } catch (err) {
          console.warn('[RecordingService] Error removing subscription:', err);
        }
        this.subscription = null;
      }

      // Clear flush interval
      if (this.writeInterval) {
        clearInterval(this.writeInterval);
        this.writeInterval = null;
      }

      // Log final sample rate
      const totalElapsed = (Date.now() - this.debugStartTime) / 1000;
      const finalHz = this.debugSampleCount / totalElapsed;
      console.log(`[RecordingService] Recording stopped: ${session.sampleCount} samples recorded`);
      console.log(`[RecordingService] Final sample rate: ${finalHz.toFixed(1)} Hz (${this.debugSampleCount} samples in ${totalElapsed.toFixed(1)}s)`);

      // Clear data
      this.writeBuffer = [];
      this.allRecords = [];
      this.currentSession = null;
      this.statusCallback = null;
      this.errorCallback = null;
      this.zeroPoint = null;

      return session;
    } catch (error: any) {
      console.error('[RecordingService] Error stopping recording:', error);
      this.cleanup();
      throw new Error(`Failed to stop recording: ${error.message}`);
    }
  }

  /**
   * Pause recording (stops writing data but keeps session active)
   */
  pauseRecording(): void {
    if (this.currentSession && this.currentSession.isRecording) {
      this.currentSession.isPaused = true;
      console.log('[RecordingService] Recording paused');
      this.notifyStatus();
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
      this.notifyStatus();

      // Clean up any existing subscription first
      if (this.subscription) {
        try {
          console.log('[RecordingService] Cleaning up old subscription before resuming');
          this.subscription.remove();
          this.subscription = null;
        } catch (err) {
          console.warn('[RecordingService] Failed to clean up old subscription:', err);
        }
      }

      // Wait for BLE service discovery to complete (typically ~1.5s)
      console.log('[RecordingService] Waiting for BLE to stabilize...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Re-subscribe to data stream with retry logic
      let retries = 0;
      const maxRetries = 2; // Reduced from 3 to 2 retries
      while (retries < maxRetries) {
        try {
          await this.subscribeToData();
          console.log('[RecordingService] Successfully subscribed to data stream');
          break;
        } catch (error: any) {
          retries++;
          if (retries >= maxRetries) {
            console.error('[RecordingService] Failed to subscribe after retries');
            throw error;
          }
          // Wait 2 seconds between retries instead of 1
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
  }

  /**
   * Get current recording session
   */
  getCurrentSession(): RecordingSession | null {
    return this.currentSession ? { ...this.currentSession } : null;
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.currentSession?.isRecording && !this.currentSession?.isPaused || false;
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

    // Debug: Track actual sample rate
    this.debugSampleCount++;
    const now = Date.now();
    const elapsedSeconds = (now - this.debugStartTime) / 1000;
    const actualHz = this.debugSampleCount / elapsedSeconds;

    // Log every 2 seconds
    if (now - this.debugLastLogTime >= 2000) {
      console.log(`[RecordingService] Sample rate: ${actualHz.toFixed(1)} Hz (${this.debugSampleCount} samples in ${elapsedSeconds.toFixed(1)}s)`);
      this.debugLastLogTime = now;
    }

    try {
      // Update battery voltage in device store
      if (data.batteryVoltage !== undefined) {
        useDeviceStore.getState().setBattery(null, data.batteryVoltage);
      }

      // Apply zero point offset if set
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
          magX: data.magX !== undefined ? (data.magX - (this.zeroPoint.magX || 0)) : undefined,
          magY: data.magY !== undefined ? (data.magY - (this.zeroPoint.magY || 0)) : undefined,
          magZ: data.magZ !== undefined ? (data.magZ - (this.zeroPoint.magZ || 0)) : undefined,
        };
      }

      // Convert BLE data to IMU format (with offsets applied)
      const imuData: IMUSensorData = {
        timestamp: new Date(),
        accel_x: processedData.accelX ?? 0,
        accel_y: processedData.accelY ?? 0,
        accel_z: processedData.accelZ ?? 0,
        gyro_x: processedData.gyroX ?? 0,
        gyro_y: processedData.gyroY ?? 0,
        gyro_z: processedData.gyroZ ?? 0,
        mag_x: processedData.magX,
        mag_y: processedData.magY,
        mag_z: processedData.magZ
        // Note: BNO055 doesn't provide quaternions in current firmware
      };

      // Add to write buffer
      this.writeBuffer.push(imuData);
      this.currentSession.sampleCount++;
      this.currentSession.lastSampleTime = new Date();

      // Store all records for VTX encoding (in-memory during recording)
      if (this.currentSession.format === 'vtx') {
        this.allRecords.push(imuData);
      }

      // Clear connection lost time if recovering
      if (this.currentSession.connectionLostTime) {
        this.currentSession.connectionLostTime = undefined;
      }

      // Notify UI of sample count updates (every 10 samples to avoid excessive updates)
      if (this.currentSession.sampleCount % 10 === 0) {
        this.notifyStatus();
      }

      // Flush buffer if it reaches the threshold (CSV only)
      if (this.currentSession.format === 'csv' && this.writeBuffer.length >= this.BUFFER_SIZE) {
        this.flushBuffer().catch(err => {
          console.error('[RecordingService] Buffer flush error:', err);
        });
      }
    } catch (error: any) {
      console.error('[RecordingService] Error handling data:', error);
      this.notifyError(error);
    }
  }

  /**
   * Handle connection errors
   */
  private handleConnectionError(error: Error): void {
    if (!this.currentSession) {
      return;
    }

    // Only handle if not already paused (prevent duplicate error handling)
    if (this.currentSession.isPaused) {
      return;
    }

    console.error('[RecordingService] Connection error:', error.message);

    // Pause recording but keep session alive for recovery
    this.currentSession.isPaused = true;
    this.currentSession.connectionLostTime = new Date();

    this.notifyStatus();
    this.notifyError(error);

    // Attempt to flush any buffered data
    this.flushBuffer().catch(err => {
      console.error('[RecordingService] Failed to flush buffer after connection error:', err);
    });
  }

  /**
   * Flush write buffer to file
   */
  private async flushBuffer(): Promise<void> {
    if (this.writeBuffer.length === 0 || this.isWriting || !this.currentSession) {
      return;
    }

    this.isWriting = true;
    const dataToWrite = [...this.writeBuffer];
    this.writeBuffer = [];

    try {
      // Write all buffered data
      for (const data of dataToWrite) {
        await FileService.appendIMUData(this.currentSession.filePath, data);
      }

      console.log(`[RecordingService] Flushed ${dataToWrite.length} samples to file`);
      this.notifyStatus();
    } catch (error: any) {
      console.error('[RecordingService] Write error:', error);

      // Put data back in buffer on write failure
      this.writeBuffer.unshift(...dataToWrite);

      this.notifyError(new Error(`Failed to write data: ${error.message}`));
    } finally {
      this.isWriting = false;
    }
  }

  /**
   * Notify status callback
   */
  private notifyStatus(): void {
    if (this.statusCallback && this.currentSession) {
      try {
        this.statusCallback({ ...this.currentSession });
      } catch (error) {
        console.error('[RecordingService] Status callback error:', error);
      }
    }
  }

  /**
   * Notify error callback
   */
  private notifyError(error: Error): void {
    if (this.errorCallback) {
      try {
        this.errorCallback(error);
      } catch (err) {
        console.error('[RecordingService] Error callback error:', err);
      }
    }
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    if (this.subscription) {
      try {
        this.subscription.remove();
      } catch (err) {
        console.warn('[RecordingService] Cleanup subscription error:', err);
      }
      this.subscription = null;
    }

    if (this.writeInterval) {
      clearInterval(this.writeInterval);
      this.writeInterval = null;
    }

    this.writeBuffer = [];
    this.isWriting = false;
    this.currentSession = null;
    this.statusCallback = null;
    this.errorCallback = null;
    this.zeroPoint = null;
  }
}

export default new RecordingService();
