/**
 * Background Recording Task
 *
 * Runs recording in a separate JS thread using react-native-background-actions
 * This keeps the UI responsive during high-frequency sensor data recording
 */

import BackgroundService from 'react-native-background-actions';
import { BleManager, Device, Subscription } from 'react-native-ble-plx';
import RNFS from 'react-native-fs';
import { VTXStreamEncoder, IMURecord, VTXMetadata } from '@vertex-pkg/vtx-parser';

interface RecordingConfig {
  deviceId: string;
  deviceName: string;
  filePath: string;
  sampleRate: number;
  format: 'csv' | 'vtx';
  metadata?: VTXMetadata;
  includeMag: boolean;
  includeQuat: boolean;
}

interface SensorData {
  accelX: number;
  accelY: number;
  accelZ: number;
  gyroX: number;
  gyroY: number;
  gyroZ: number;
  magX?: number;
  magY?: number;
  magZ?: number;
  quatW?: number;
  quatX?: number;
  quatY?: number;
  quatZ?: number;
  batteryVoltage?: number;
}

let bleManager: BleManager | null = null;
let bleSubscription: Subscription | null = null;
let vtxEncoder: VTXStreamEncoder | null = null;
let sampleCount = 0;
let writeBuffer: Array<{ timestamp: Date; data: SensorData }> = [];
let config: RecordingConfig | null = null;

const BUFFER_SIZE = 100; // Larger buffer for background task
const STATUS_UPDATE_INTERVAL = 1000; // Update UI every 1 second
let lastStatusUpdate = Date.now();

/**
 * Background task that handles BLE data collection and file writing
 */
const recordingTask = async (taskDataArguments: any) => {
  const { config: taskConfig } = taskDataArguments;
  config = taskConfig;

  console.log('[BackgroundRecordingTask] Starting background recording');

  // Initialize BLE manager
  bleManager = new BleManager();

  // Initialize VTX encoder if needed
  if (config.format === 'vtx') {
    await initializeVTXEncoder();
  }

  // Subscribe to BLE notifications
  await subscribeToBLE();

  // Keep task running
  await new Promise((resolve) => {
    // Task runs until stopped externally
    BackgroundService.updateNotification({
      taskDesc: `Recording: ${config?.deviceName || 'Device'} - ${sampleCount} samples`,
    });
  });
};

/**
 * Initialize VTX stream encoder
 */
async function initializeVTXEncoder() {
  if (!config) return;

  const writeCallback = async (chunk: Uint8Array) => {
    // Convert Uint8Array to base64
    let binary = '';
    for (let i = 0; i < chunk.byteLength; i++) {
      binary += String.fromCharCode(chunk[i]);
    }
    const base64 = btoa(binary);

    // Append to file
    await RNFS.appendFile(config.filePath, base64, 'base64');
  };

  vtxEncoder = new VTXStreamEncoder({
    sampleRate: config.sampleRate,
    includeMag: config.includeMag,
    includeQuat: config.includeQuat,
    metadata: config.metadata || {},
    writeCallback,
  });

  await vtxEncoder.initialize();
  console.log('[BackgroundRecordingTask] VTX encoder initialized');
}

/**
 * Subscribe to BLE characteristic for sensor data
 */
async function subscribeToBLE() {
  if (!config || !bleManager) return;

  try {
    // Connect to device if not connected
    const device = await bleManager.connectToDevice(config.deviceId);
    await device.discoverAllServicesAndCharacteristics();

    // BNO055 service and characteristic UUIDs
    const SERVICE_UUID = '00001234-0000-1000-8000-00805f9b34fb';
    const CHAR_UUID = '00001235-0000-1000-8000-00805f9b34fb';

    // Subscribe to notifications
    bleSubscription = device.monitorCharacteristicForService(
      SERVICE_UUID,
      CHAR_UUID,
      async (error, characteristic) => {
        if (error) {
          console.error('[BackgroundRecordingTask] BLE error:', error);
          return;
        }

        if (characteristic?.value) {
          await handleSensorData(characteristic.value);
        }
      }
    );

    console.log('[BackgroundRecordingTask] BLE subscription active');
  } catch (error) {
    console.error('[BackgroundRecordingTask] Failed to subscribe to BLE:', error);
  }
}

/**
 * Parse and handle incoming sensor data
 */
async function handleSensorData(base64Data: string) {
  try {
    // Decode base64 to ArrayBuffer
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const buffer = bytes.buffer;
    const view = new DataView(buffer);

    // Parse BNO055 data (adjust based on your firmware format)
    const data: SensorData = {
      accelX: view.getFloat32(0, true),
      accelY: view.getFloat32(4, true),
      accelZ: view.getFloat32(8, true),
      gyroX: view.getFloat32(12, true),
      gyroY: view.getFloat32(16, true),
      gyroZ: view.getFloat32(20, true),
      magX: view.getFloat32(24, true),
      magY: view.getFloat32(28, true),
      magZ: view.getFloat32(32, true),
    };

    // Add to buffer
    writeBuffer.push({
      timestamp: new Date(),
      data,
    });

    sampleCount++;

    // Flush buffer if full
    if (writeBuffer.length >= BUFFER_SIZE) {
      await flushBuffer();
    }

    // Update notification periodically
    const now = Date.now();
    if (now - lastStatusUpdate >= STATUS_UPDATE_INTERVAL) {
      BackgroundService.updateNotification({
        taskDesc: `Recording: ${config?.deviceName || 'Device'} - ${sampleCount} samples`,
      });
      lastStatusUpdate = now;
    }
  } catch (error) {
    console.error('[BackgroundRecordingTask] Error handling sensor data:', error);
  }
}

/**
 * Flush buffered data to file
 */
async function flushBuffer() {
  if (writeBuffer.length === 0 || !config) return;

  const dataToWrite = [...writeBuffer];
  writeBuffer = [];

  try {
    if (config.format === 'vtx' && vtxEncoder) {
      // Write to VTX stream
      for (const { timestamp, data } of dataToWrite) {
        const record: IMURecord = {
          timestamp: timestamp.getTime(),
          accelX: data.accelX,
          accelY: data.accelY,
          accelZ: data.accelZ,
          gyroX: data.gyroX,
          gyroY: data.gyroY,
          gyroZ: data.gyroZ,
          magX: data.magX,
          magY: data.magY,
          magZ: data.magZ,
          quatW: data.quatW,
          quatX: data.quatX,
          quatY: data.quatY,
          quatZ: data.quatZ,
        };
        await vtxEncoder.addRecord(record);
      }
    } else {
      // Write to CSV
      let csv = '';
      for (const { timestamp, data } of dataToWrite) {
        const row = [
          timestamp.getTime(),
          data.accelX,
          data.accelY,
          data.accelZ,
          data.gyroX,
          data.gyroY,
          data.gyroZ,
          data.magX ?? '',
          data.magY ?? '',
          data.magZ ?? '',
          data.quatW ?? '',
          data.quatX ?? '',
          data.quatY ?? '',
          data.quatZ ?? '',
        ].join(',');
        csv += row + '\n';
      }
      await RNFS.appendFile(config.filePath, csv, 'utf8');
    }

    console.log(`[BackgroundRecordingTask] Flushed ${dataToWrite.length} samples`);
  } catch (error) {
    console.error('[BackgroundRecordingTask] Flush error:', error);
    // Put data back on error
    writeBuffer.unshift(...dataToWrite);
  }
}

/**
 * Start background recording
 */
export async function startBackgroundRecording(recordingConfig: RecordingConfig) {
  const options = {
    taskName: 'Vertex Recording',
    taskTitle: 'Recording IMU Data',
    taskDesc: `Recording: ${recordingConfig.deviceName}`,
    taskIcon: {
      name: 'ic_launcher',
      type: 'mipmap',
    },
    color: '#00ff00',
    linkingURI: 'vertexandroid://',
    parameters: {
      config: recordingConfig,
    },
  };

  await BackgroundService.start(recordingTask, options);
  console.log('[BackgroundRecordingTask] Background service started');
}

/**
 * Stop background recording and finalize file
 */
export async function stopBackgroundRecording(): Promise<{ sampleCount: number; filePath: string }> {
  console.log('[BackgroundRecordingTask] Stopping background recording');

  // Flush remaining buffer
  await flushBuffer();

  // Finalize VTX file if needed
  if (config?.format === 'vtx' && vtxEncoder) {
    const finalHeader = vtxEncoder.finalize();

    // Read file and update header
    const currentFile = await RNFS.readFile(config.filePath, 'base64');
    const currentBytes = atob(currentFile);
    const currentArray = new Uint8Array(currentBytes.length);
    for (let i = 0; i < currentBytes.length; i++) {
      currentArray[i] = currentBytes.charCodeAt(i);
    }

    // Replace header
    for (let i = 0; i < finalHeader.length; i++) {
      currentArray[i] = finalHeader[i];
    }

    // Write back
    let binary = '';
    for (let i = 0; i < currentArray.length; i++) {
      binary += String.fromCharCode(currentArray[i]);
    }
    await RNFS.writeFile(config.filePath, btoa(binary), 'base64');

    console.log('[BackgroundRecordingTask] VTX file finalized');
  }

  // Cleanup
  if (bleSubscription) {
    bleSubscription.remove();
    bleSubscription = null;
  }

  if (bleManager) {
    bleManager.destroy();
    bleManager = null;
  }

  const result = {
    sampleCount,
    filePath: config?.filePath || '',
  };

  // Reset state
  vtxEncoder = null;
  sampleCount = 0;
  writeBuffer = [];
  config = null;

  // Stop background service
  await BackgroundService.stop();

  return result;
}

/**
 * Get current recording status
 */
export function getRecordingStatus() {
  return {
    isRecording: BackgroundService.isRunning(),
    sampleCount,
    filePath: config?.filePath || '',
  };
}
