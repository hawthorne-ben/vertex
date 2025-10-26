/**
 * File Service for CSV Logging
 * 
 * Handles:
 * - Creating CSV log files
 * - Writing sensor data to CSV
 * - File management and export
 */

import RNFS from 'react-native-fs';
import { SensorReading } from '../types';

class FileService {
  private documentsPath: string;

  constructor() {
    this.documentsPath = RNFS.DocumentDirectoryPath;
    console.log('Documents path:', this.documentsPath);
  }

  /**
   * Create a new CSV file with header
   * @returns The full file path
   */
  async createLogFile(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                     new Date().toISOString().split('T')[1].replace(/[:.]/g, '-').split('.')[0];
    const fileName = `imu_log_${timestamp}.csv`;
    const filePath = `${this.documentsPath}/${fileName}`;

    const header = 'timestamp_ms,grade_percent,roll_deg,accel_x_g,accel_y_g,accel_z_g\n';
    
    try {
      await RNFS.writeFile(filePath, header, 'utf8');
      console.log(`Created log file: ${fileName}`);
      return filePath;
    } catch (error) {
      console.error('Error creating log file:', error);
      throw error;
    }
  }

  /**
   * Append sensor reading to CSV file
   * @param filePath The path to the log file
   * @param reading The sensor reading to write
   */
  async appendReading(filePath: string, reading: SensorReading): Promise<void> {
    const line = `${reading.timestamp_ms},${reading.grade_percent},${reading.roll_deg},${reading.accel_x_g},${reading.accel_y_g},${reading.accel_z_g}\n`;
    
    try {
      await RNFS.appendFile(filePath, line, 'utf8');
    } catch (error) {
      console.error('Error appending to log file:', error);
      throw error;
    }
  }

  /**
   * Get list of all log files
   * @returns Array of log file names
   */
  async getLogFiles(): Promise<string[]> {
    try {
      const files = await RNFS.readDir(this.documentsPath);
      const logFiles = files
        .filter(file => file.name.startsWith('imu_log_') && file.name.endsWith('.csv'))
        .map(file => file.name);
      
      return logFiles.sort().reverse(); // Newest first
    } catch (error) {
      console.error('Error reading log files:', error);
      return [];
    }
  }

  /**
   * Get full path for a log file
   * @param fileName The name of the log file
   */
  getFilePath(fileName: string): string {
    return `${this.documentsPath}/${fileName}`;
  }

  /**
   * Delete a log file
   * @param fileName The name of the log file to delete
   */
  async deleteLogFile(fileName: string): Promise<void> {
    const filePath = this.getFilePath(fileName);
    
    try {
      await RNFS.unlink(filePath);
      console.log(`Deleted log file: ${fileName}`);
    } catch (error) {
      console.error('Error deleting log file:', error);
      throw error;
    }
  }
}

export default new FileService();

