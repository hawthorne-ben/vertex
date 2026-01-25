/**
 * VTX Binary Format Merger
 * Merges multiple VTX files into a single unified file
 */

import { VTXDecoder } from './decoder';
import { VTXEncoder } from './encoder';
import {
  VTXHeader,
  IMURecord,
  GPSRecord,
  VTXMetadata,
  RecordFormatFlags,
} from './types';

export interface MergeResult {
  buffer: ArrayBuffer;
  header: VTXHeader;
  metadata: VTXMetadata;
  stats: {
    inputFiles: number;
    totalInputRecords: number;
    outputRecords: number;
    deduplicatedRecords: number;
    timeRange: {
      start: number;
      end: number;
    };
  };
}

export class VTXMerger {
  /**
   * Merge multiple VTX files into a single file
   *
   * Features:
   * - Sorts records by timestamp across all files
   * - Deduplicates exact timestamp matches (keeps first occurrence)
   * - Preserves all sensor data (accel, gyro, mag, quat, GPS)
   * - Updates header with merged statistics
   *
   * @param files Array of VTX file ArrayBuffers to merge
   * @returns MergeResult with merged buffer and statistics
   */
  static merge(files: ArrayBuffer[]): MergeResult {
    if (files.length === 0) {
      throw new Error('Cannot merge empty file list');
    }

    if (files.length === 1) {
      // Single file - just return it as-is with stats
      const decoder = new VTXDecoder(files[0]);
      const header = decoder.getHeader();
      const metadata = decoder.decode({ headerOnly: true }).metadata;

      return {
        buffer: files[0],
        header,
        metadata,
        stats: {
          inputFiles: 1,
          totalInputRecords: Number(header.recordCount),
          outputRecords: Number(header.recordCount),
          deduplicatedRecords: 0,
          timeRange: {
            start: Number(header.startTimestamp),
            end: Number(header.endTimestamp),
          },
        },
      };
    }

    // Decode all files
    const decodedFiles = files.map((buffer) => {
      const decoder = new VTXDecoder(buffer);
      return decoder.decode();
    });

    // Collect all IMU records with their source file index
    const allRecords: Array<IMURecord & { sourceIndex: number }> = [];
    const allGpsRecords: Array<GPSRecord & { sourceIndex: number }> = [];

    decodedFiles.forEach((file, index) => {
      file.records.forEach((record) => {
        allRecords.push({ ...record, sourceIndex: index });
      });

      if (file.gpsRecords) {
        file.gpsRecords.forEach((gps) => {
          allGpsRecords.push({ ...gps, sourceIndex: index });
        });
      }
    });

    // Sort by timestamp
    allRecords.sort((a, b) => a.timestamp - b.timestamp);
    allGpsRecords.sort((a, b) => a.timestamp - b.timestamp);

    // Deduplicate exact timestamp matches (keep first)
    const deduplicatedRecords: IMURecord[] = [];
    const deduplicatedGps: GPSRecord[] = [];
    const seenTimestamps = new Set<number>();
    const seenGpsTimestamps = new Set<number>();

    let deduplicatedCount = 0;

    for (const record of allRecords) {
      if (!seenTimestamps.has(record.timestamp)) {
        seenTimestamps.add(record.timestamp);
        // Remove sourceIndex before adding
        const { sourceIndex, ...cleanRecord } = record;
        deduplicatedRecords.push(cleanRecord);
      } else {
        deduplicatedCount++;
      }
    }

    for (const gps of allGpsRecords) {
      if (!seenGpsTimestamps.has(gps.timestamp)) {
        seenGpsTimestamps.add(gps.timestamp);
        const { sourceIndex, ...cleanGps } = gps;
        deduplicatedGps.push(cleanGps);
      }
    }

    // Determine sensor capabilities from first file
    const firstHeader = decodedFiles[0].header;
    const hasMag = (firstHeader.recordFormat & RecordFormatFlags.HAS_MAG) !== 0;
    const hasQuat = (firstHeader.recordFormat & RecordFormatFlags.HAS_QUAT) !== 0;
    const hasEuler = (firstHeader.recordFormat & RecordFormatFlags.HAS_EULER) !== 0;
    const hasGps = deduplicatedGps.length > 0;

    // Merge metadata (combine from all files)
    const mergedMetadata: VTXMetadata = {
      ...decodedFiles[0].metadata,
      custom: {
        ...decodedFiles[0].metadata.custom,
        mergedFrom: decodedFiles.map((f, i) => ({
          index: i,
          deviceId: f.metadata.device?.id,
          deviceName: f.metadata.device?.name,
          recordCount: Number(f.header.recordCount),
          timeRange: {
            start: Number(f.header.startTimestamp),
            end: Number(f.header.endTimestamp),
          },
        })),
      },
    };

    // Create encoder with merged data
    const encoder = new VTXEncoder({
      sampleRate: firstHeader.sampleRate,
      includeMag: hasMag,
      includeQuat: hasQuat,
      includeEuler: hasEuler,
      includeGPS: hasGps,
      metadata: mergedMetadata,
    });

    // Add all deduplicated records
    for (const record of deduplicatedRecords) {
      encoder.addRecord(record);
    }

    // Add GPS records if present
    if (hasGps) {
      for (const gps of deduplicatedGps) {
        encoder.addGPSRecord(gps);
      }
    }

    // Encode to buffer
    const mergedBuffer = encoder.encode();

    // Get final header
    const decoder = new VTXDecoder(mergedBuffer);
    const finalHeader = decoder.getHeader();

    return {
      buffer: mergedBuffer,
      header: finalHeader,
      metadata: mergedMetadata,
      stats: {
        inputFiles: files.length,
        totalInputRecords: allRecords.length,
        outputRecords: deduplicatedRecords.length,
        deduplicatedRecords: deduplicatedCount,
        timeRange: {
          start: deduplicatedRecords[0]?.timestamp || 0,
          end: deduplicatedRecords[deduplicatedRecords.length - 1]?.timestamp || 0,
        },
      },
    };
  }

  /**
   * Validate that files can be merged
   * Checks for compatible sensor configurations
   */
  static validateMergeCompatibility(files: ArrayBuffer[]): {
    compatible: boolean;
    errors: string[];
  } {
    if (files.length === 0) {
      return { compatible: false, errors: ['No files provided'] };
    }

    if (files.length === 1) {
      return { compatible: true, errors: [] };
    }

    const errors: string[] = [];

    try {
      const decodedFiles = files.map((buffer) => {
        const decoder = new VTXDecoder(buffer);
        return decoder.decode({ headerOnly: true });
      });

      // Check sensor compatibility
      const firstFormat = decodedFiles[0].header.recordFormat;
      const firstSampleRate = decodedFiles[0].header.sampleRate;

      for (let i = 1; i < decodedFiles.length; i++) {
        const file = decodedFiles[i];

        // Check record format matches
        if (file.header.recordFormat !== firstFormat) {
          errors.push(
            `File ${i} has different sensor configuration (format: ${file.header.recordFormat} vs ${firstFormat})`
          );
        }

        // Warn about sample rate mismatch (not fatal)
        if (file.header.sampleRate !== firstSampleRate) {
          errors.push(
            `Warning: File ${i} has different sample rate (${file.header.sampleRate}Hz vs ${firstSampleRate}Hz)`
          );
        }
      }

      return {
        compatible: errors.filter((e) => !e.startsWith('Warning')).length === 0,
        errors,
      };
    } catch (error) {
      return {
        compatible: false,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }
}
