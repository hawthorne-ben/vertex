/**
 * Recording Service
 *
 * Manages IMU data recording sessions with robust error handling:
 * - Handles connection interruptions gracefully
 * - Buffers data to prevent loss during file writes
 * - Tracks recording metadata (start time, sample count, etc.)
 * - Auto-recovery on reconnection
 */

import FileService, { IMUSensorData } from './FileService';
import BleService from './BleService';

export interface RecordingSession {
  id: string;
  filePath: string;
  fileName: string;
  deviceId: string;
  deviceName: string;
  startTime: Date;
  sampleCount: number;
  isRecording: boolean;
  isPaused: boolean;
  lastSampleTime?: Date;
  connectionLostTime?: Date;
  zeroPoint?: any; // Zero point calibration applied to this recording
}

export type RecordingStatusCallback = (session: RecordingSession) => void;
export type RecordingErrorCallback = (error: Error) => void;

class RecordingService {
  private currentSession: RecordingSession | null = null;
  private subscription: any = null;
  private writeBuffer: IMUSensorData[] = [];
  private isWriting: boolean = false;
  private statusCallback: RecordingStatusCallback | null = null;
  private errorCallback: RecordingErrorCallback | null = null;
  private writeInterval: NodeJS.Timeout | null = null;
  private zeroPoint: any = null; // Current zero point for offset calculations

  // Buffer configuration
  private readonly BUFFER_SIZE = 50; // Write every 50 samples
  private readonly BUFFER_FLUSH_INTERVAL = 2000; // Flush every 2 seconds minimum

  /**
   * Start a new recording session
   */
  async startRecording(
    deviceId: string,
    deviceName: string,
    onStatus?: RecordingStatusCallback,
    onError?: RecordingErrorCallback,
    zeroPoint?: any
  ): Promise<RecordingSession> {
    if (this.currentSession?.isRecording) {
      throw new Error('Recording already in progress');
    }

    console.log(`[RecordingService] Starting recording for device: ${deviceName}`);

    // Store callbacks and zero point
    this.statusCallback = onStatus || null;
    this.errorCallback = onError || null;
    this.zeroPoint = zeroPoint || null;

    try {
      // Create new recording file
      const { filePath, fileName } = await FileService.createRecordingFile(deviceName);

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
        zeroPoint: this.zeroPoint
      };

      // Start data subscription
      await this.subscribeToData();

      // Start periodic buffer flush
      this.writeInterval = setInterval(() => {
        this.flushBuffer().catch(err => {
          console.error('[RecordingService] Buffer flush error:', err);
        });
      }, this.BUFFER_FLUSH_INTERVAL);

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

    try {
      // Flush any remaining buffered data
      await this.flushBuffer();

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

      console.log(`[RecordingService] Recording stopped: ${session.sampleCount} samples recorded`);

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

      // Re-subscribe if needed
      if (!this.subscription) {
        await this.subscribeToData();
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

    try {
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

      // Clear connection lost time if recovering
      if (this.currentSession.connectionLostTime) {
        this.currentSession.connectionLostTime = undefined;
        this.notifyStatus();
      }

      // Flush buffer if it reaches the threshold
      if (this.writeBuffer.length >= this.BUFFER_SIZE) {
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
