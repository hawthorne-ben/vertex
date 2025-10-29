/**
 * File Service for CSV Logging
 *
 * Handles:
 * - Creating CSV log files with full IMU data format
 * - Writing sensor data to CSV (compatible with web app format)
 * - File management and export
 */

import RNFS from 'react-native-fs';
import VTXFileService from './VTXFileService';

export interface IMUSensorData {
  timestamp: Date;
  accel_x: number;
  accel_y: number;
  accel_z: number;
  gyro_x: number;
  gyro_y: number;
  gyro_z: number;
  mag_x?: number;
  mag_y?: number;
  mag_z?: number;
  quat_w?: number;
  quat_x?: number;
  quat_y?: number;
  quat_z?: number;
}

export interface RecordingMetadata {
  fileName: string;
  filePath: string;
  startTime: Date;
  endTime?: Date;
  sampleCount: number;
  fileSize: number;
  deviceName?: string;
  deviceId?: string;
}

class FileService {
  private documentsPath: string;

  constructor() {
    this.documentsPath = RNFS.DocumentDirectoryPath;
    console.log('[FileService] Documents path:', this.documentsPath);
  }

  /**
   * Read file with UTF-8 fallback for corrupted files
   * @param filePath Path to file
   * @returns File content as string
   */
  private async readFileWithFallback(filePath: string): Promise<string> {
    try {
      // Try UTF-8 first (standard encoding)
      return await RNFS.readFile(filePath, 'utf8');
    } catch (error) {
      console.warn('[FileService] UTF-8 read failed, trying ASCII fallback:', error);
      try {
        // Fallback to ASCII which is more lenient
        const content = await RNFS.readFile(filePath, 'ascii');
        // Sanitize by removing non-printable characters except newline, carriage return, and tab
        return content.replace(/[^\x20-\x7E\n\r\t]/g, '');
      } catch (fallbackError) {
        console.error('[FileService] ASCII fallback also failed:', fallbackError);
        throw new Error('Invalid UTF-8 detected');
      }
    }
  }

  /**
   * Create a new CSV file with header matching web app format
   * @param deviceName Optional device name to include in filename
   * @returns Object with filePath and fileName
   */
  async createRecordingFile(deviceName?: string): Promise<{ filePath: string; fileName: string }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
    const devicePrefix = deviceName ? `${deviceName.replace(/[^a-zA-Z0-9]/g, '_')}_` : '';
    const fileName = `${devicePrefix}imu_${timestamp}.csv`;
    const filePath = `${this.documentsPath}/${fileName}`;

    // Header format matching web app parser expectations
    const header = 'timestamp_ms,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z,mag_x,mag_y,mag_z,quat_w,quat_x,quat_y,quat_z\n';

    try {
      await RNFS.writeFile(filePath, header, 'utf8');
      console.log(`[FileService] Created recording file: ${fileName}`);
      return { filePath, fileName };
    } catch (error) {
      console.error('[FileService] Error creating file:', error);
      throw error;
    }
  }

  /**
   * Append IMU sensor data to CSV file
   * @param filePath The path to the log file
   * @param data The IMU sensor data to write
   */
  async appendIMUData(filePath: string, data: IMUSensorData): Promise<void> {
    const timestampMs = data.timestamp.getTime();

    // Format: timestamp_ms, accel(x,y,z), gyro(x,y,z), mag(x,y,z), quat(w,x,y,z)
    const line = [
      timestampMs,
      data.accel_x,
      data.accel_y,
      data.accel_z,
      data.gyro_x,
      data.gyro_y,
      data.gyro_z,
      data.mag_x ?? '',
      data.mag_y ?? '',
      data.mag_z ?? '',
      data.quat_w ?? '',
      data.quat_x ?? '',
      data.quat_y ?? '',
      data.quat_z ?? ''
    ].join(',') + '\n';

    try {
      await RNFS.appendFile(filePath, line, 'utf8');
    } catch (error) {
      console.error('[FileService] Error appending data:', error);
      throw error;
    }
  }

  /**
   * Get list of all recording files with metadata
   * @returns Array of recording metadata
   */
  async getRecordings(): Promise<RecordingMetadata[]> {
    try {
      const files = await RNFS.readDir(this.documentsPath);
      const recordingFiles = files
        .filter(file => file.name.endsWith('.csv') || file.name.endsWith('.vtx'))
        .sort((a, b) => b.mtime!.getTime() - a.mtime!.getTime()); // Newest first

      const recordings: RecordingMetadata[] = [];

      for (const file of recordingFiles) {
        const isVTX = file.name.endsWith('.vtx');

        // Parse filename to extract device name
        // Format: [deviceName_]imu_YYYY-MM-DD_HH-MM-SS.(csv|vtx)
        const nameMatch = file.name.match(/^(?:(.+?)_)?imu_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.(csv|vtx)$/);
        let deviceName = nameMatch?.[1]?.replace(/_/g, ' ');

        let sampleCount = 0;
        let startTime: Date | undefined;
        let endTime: Date | undefined;

        try {
          if (isVTX) {
            // Read VTX file header for metadata
            const vtxData = await VTXFileService.readVTXFile(file.path);
            sampleCount = vtxData.records.length;

            // Get timestamps from header
            startTime = new Date(Number(vtxData.header.startTimestamp));
            endTime = new Date(Number(vtxData.header.endTimestamp));

            // Get device name from metadata if not in filename
            if (!deviceName && vtxData.metadata?.device?.name) {
              deviceName = vtxData.metadata.device.name;
            }
          } else {
            // Read CSV file
            const content = await this.readFileWithFallback(file.path);
            const lines = content.split('\n').filter(line => line.trim());
            sampleCount = Math.max(0, lines.length - 1); // Subtract header

            // Extract first and last timestamps from CSV data
            if (lines.length > 1) {
              // First data line (skip header)
              const firstDataLine = lines[1]?.split(',');
              if (firstDataLine && firstDataLine[0]) {
                startTime = new Date(parseInt(firstDataLine[0]));
              }

              // Last data line
              const lastDataLine = lines[lines.length - 1]?.split(',');
              if (lastDataLine && lastDataLine[0]) {
                endTime = new Date(parseInt(lastDataLine[0]));
              }
            }
          }
        } catch (err) {
          console.warn(`[FileService] Could not read file for metadata: ${file.name}`, err);
        }

        recordings.push({
          fileName: file.name,
          filePath: file.path,
          startTime: startTime || file.mtime || new Date(file.ctime || Date.now()),
          endTime,
          sampleCount,
          fileSize: file.size,
          deviceName
        });
      }

      return recordings;
    } catch (error) {
      console.error('[FileService] Error reading recordings:', error);
      return [];
    }
  }

  /**
   * Get full path for a file
   * @param fileName The name of the file
   */
  getFilePath(fileName: string): string {
    return `${this.documentsPath}/${fileName}`;
  }

  /**
   * Get file info (size, sample count, duration)
   * @param filePath Path to the recording file
   */
  async getFileInfo(filePath: string): Promise<{
    size: number;
    sampleCount: number;
    startTime?: Date;
    endTime?: Date;
    duration?: number; // in seconds
  } | null> {
    try {
      const stat = await RNFS.stat(filePath);
      const content = await this.readFileWithFallback(filePath);
      const lines = content.split('\n').filter(line => line.trim());

      // Extract first and last timestamps
      let startTime: Date | undefined;
      let endTime: Date | undefined;
      let duration: number | undefined;

      if (lines.length > 1) {
        // First data line (skip header)
        const firstDataLine = lines[1]?.split(',');
        if (firstDataLine && firstDataLine[0]) {
          startTime = new Date(parseInt(firstDataLine[0]));
        }

        // Last data line
        const lastDataLine = lines[lines.length - 1]?.split(',');
        if (lastDataLine && lastDataLine[0]) {
          endTime = new Date(parseInt(lastDataLine[0]));
        }

        if (startTime && endTime) {
          duration = (endTime.getTime() - startTime.getTime()) / 1000;
        }
      }

      return {
        size: stat.size,
        sampleCount: Math.max(0, lines.length - 1), // Subtract header
        startTime,
        endTime,
        duration
      };
    } catch (error) {
      console.error('[FileService] Error getting file info:', error);
      return null;
    }
  }

  /**
   * Delete a recording file
   * @param fileName The name of the file to delete
   */
  async deleteRecording(fileName: string): Promise<void> {
    const filePath = this.getFilePath(fileName);

    try {
      await RNFS.unlink(filePath);
      console.log(`[FileService] Deleted recording: ${fileName}`);
    } catch (error) {
      console.error('[FileService] Error deleting recording:', error);
      throw error;
    }
  }

  /**
   * Check if file exists
   * @param filePath Path to check
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      return await RNFS.exists(filePath);
    } catch {
      return false;
    }
  }

  /**
   * Read and parse CSV data from a recording file
   * @param filePath Path to the recording file
   * @returns Array of IMU sensor data with timestamps as numbers (ms since epoch)
   */
  async readRecordingData(filePath: string): Promise<IMUSensorData[]> {
    try {
      const content = await this.readFileWithFallback(filePath);
      const lines = content.split('\n').filter(line => line.trim());

      // Skip header (first line)
      const dataLines = lines.slice(1);

      const data: IMUSensorData[] = [];

      for (const line of dataLines) {
        const values = line.split(',');
        if (values.length < 7) continue; // Need at least timestamp + accel + gyro

        data.push({
          timestamp: new Date(parseInt(values[0])),
          accel_x: parseFloat(values[1]),
          accel_y: parseFloat(values[2]),
          accel_z: parseFloat(values[3]),
          gyro_x: parseFloat(values[4]),
          gyro_y: parseFloat(values[5]),
          gyro_z: parseFloat(values[6]),
          mag_x: values[7] ? parseFloat(values[7]) : undefined,
          mag_y: values[8] ? parseFloat(values[8]) : undefined,
          mag_z: values[9] ? parseFloat(values[9]) : undefined,
          quat_w: values[10] ? parseFloat(values[10]) : undefined,
          quat_x: values[11] ? parseFloat(values[11]) : undefined,
          quat_y: values[12] ? parseFloat(values[12]) : undefined,
          quat_z: values[13] ? parseFloat(values[13]) : undefined,
        });
      }

      console.log(`[FileService] Parsed ${data.length} samples from ${filePath}`);
      return data;
    } catch (error) {
      console.error('[FileService] Error reading recording data:', error);
      throw error;
    }
  }
}

export default new FileService();

