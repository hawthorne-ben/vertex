/**
 * VTX Gap Detection Algorithm
 *
 * Detects temporal gaps in IMU data recordings by analyzing timestamp sequences.
 * Uses O(n) single-pass algorithm with configurable gap threshold.
 */

import { VTXDecoder, VTXHeader, IMURecord } from '@vertex-pkg/vtx-parser';

/**
 * Represents a continuous range of data
 */
export interface DataRange {
  /** Start offset in milliseconds from recording start */
  startOffsetMs: number;
  /** End offset in milliseconds from recording start */
  endOffsetMs: number;
}

/**
 * Details about a detected gap
 */
export interface GapDetail {
  /** Gap start offset in milliseconds from recording start */
  start_offset_ms: number;
  /** Gap end offset in milliseconds from recording start */
  end_offset_ms: number;
  /** Gap duration in milliseconds */
  duration_ms: number;
}

/**
 * Statistical information about gaps in the recording
 */
export interface GapInfo {
  /** Total number of gaps detected */
  total_gaps: number;
  /** Duration of the largest gap in milliseconds */
  largest_gap_ms: number;
  /** Total duration of all gaps combined */
  total_gap_duration_ms: number;
  /** Percentage of recording time that is gaps */
  gap_percentage: number;
  /** Detailed information about each gap */
  gap_details: GapDetail[];
}

/**
 * Result of gap detection analysis
 */
export interface GapDetectionResult {
  /** Continuous data ranges (no gaps) */
  ranges: DataRange[];
  /** Gap statistics and details */
  gapInfo: GapInfo;
}

/**
 * Default gap threshold: 500ms
 * Rationale:
 * - At 100Hz sampling, 500ms = 50 samples
 * - Catches significant interruptions (device sleep, connection loss)
 * - Ignores minor timestamp jitter and brief interruptions
 */
export const DEFAULT_GAP_THRESHOLD_MS = 500;

/**
 * Detects data gaps in a VTX recording using O(n) single-pass algorithm
 *
 * @param decoder - VTXDecoder instance with loaded file
 * @param gapThresholdMs - Minimum timestamp difference to consider a gap (default 500ms)
 * @returns Object containing continuous data ranges and gap statistics
 *
 * @example
 * ```typescript
 * const buffer = await readFile('recording.vtx');
 * const decoder = new VTXDecoder(buffer);
 * const { ranges, gapInfo } = detectDataRanges(decoder);
 *
 * console.log(`Found ${gapInfo.total_gaps} gaps`);
 * console.log(`Largest gap: ${gapInfo.largest_gap_ms}ms`);
 * console.log(`Gap percentage: ${gapInfo.gap_percentage}%`);
 * ```
 */
export function detectDataRanges(
  decoder: VTXDecoder,
  gapThresholdMs: number = DEFAULT_GAP_THRESHOLD_MS
): GapDetectionResult {
  const header = decoder.getHeader();
  const recordCount = Number(header.recordCount);

  // Handle empty file
  if (recordCount === 0) {
    return {
      ranges: [],
      gapInfo: {
        total_gaps: 0,
        largest_gap_ms: 0,
        total_gap_duration_ms: 0,
        gap_percentage: 0,
        gap_details: [],
      },
    };
  }

  const ranges: DataRange[] = [];
  const gaps: GapDetail[] = [];

  // Read first record to initialize
  const startTimestamp = Number(header.startTimestamp);
  const firstRecord = decoder.readRecord(0);
  let rangeStartOffset = firstRecord.timestamp - startTimestamp;
  let lastTimestampOffset = rangeStartOffset;

  // Single pass through all records
  for (let i = 1; i < recordCount; i++) {
    const record = decoder.readRecord(i);
    const currentOffset = record.timestamp - startTimestamp;
    const timeDiff = currentOffset - lastTimestampOffset;

    // Gap detected: timestamp jump larger than threshold
    if (timeDiff > gapThresholdMs) {
      // Close current data range
      ranges.push({
        startOffsetMs: rangeStartOffset,
        endOffsetMs: lastTimestampOffset,
      });

      // Record gap details
      gaps.push({
        start_offset_ms: lastTimestampOffset,
        end_offset_ms: currentOffset,
        duration_ms: timeDiff,
      });

      // Start new data range
      rangeStartOffset = currentOffset;
    }

    lastTimestampOffset = currentOffset;
  }

  // Close final data range
  ranges.push({
    startOffsetMs: rangeStartOffset,
    endOffsetMs: lastTimestampOffset,
  });

  // Compute gap statistics
  const totalGapDuration = gaps.reduce((sum, gap) => sum + gap.duration_ms, 0);
  const largestGap = gaps.length > 0 ? Math.max(...gaps.map((g) => g.duration_ms)) : 0;

  // Calculate total recording duration from header
  const totalDuration = Number(header.endTimestamp - header.startTimestamp);
  const gapPercentage = totalDuration > 0 ? (totalGapDuration / totalDuration) * 100 : 0;

  return {
    ranges,
    gapInfo: {
      total_gaps: gaps.length,
      largest_gap_ms: largestGap,
      total_gap_duration_ms: totalGapDuration,
      gap_percentage: Math.round(gapPercentage * 100) / 100, // Round to 2 decimal places
      gap_details: gaps,
    },
  };
}

/**
 * Converts data ranges to PostgreSQL integer array format
 *
 * @param ranges - Array of data ranges
 * @returns PostgreSQL-compatible 2D array as string
 *
 * @example
 * ```typescript
 * const ranges = [
 *   { startOffsetMs: 0, endOffsetMs: 30000 },
 *   { startOffsetMs: 35000, endOffsetMs: 60000 }
 * ];
 * const pgArray = rangesToPgArray(ranges);
 * // Returns: "{{0,30000},{35000,60000}}"
 * ```
 */
export function rangesToPgArray(ranges: DataRange[]): number[][] {
  return ranges.map((range) => [range.startOffsetMs, range.endOffsetMs]);
}

/**
 * Extracts essential file metadata from VTX header
 *
 * @param decoder - VTXDecoder instance with loaded file
 * @returns Metadata object for database storage
 */
export function extractVTXMetadata(decoder: VTXDecoder) {
  const header = decoder.getHeader();
  const metadata = decoder.getMetadata();

  return {
    startTime: new Date(Number(header.startTimestamp)),
    endTime: new Date(Number(header.endTimestamp)),
    durationMs: Number(header.endTimestamp - header.startTimestamp),
    sampleRate: header.sampleRate,
    sampleCount: Number(header.recordCount),
    recordFormat: header.recordFormat,
    deviceInfo: metadata ? {
      id: metadata.device?.id,
      name: metadata.device?.name,
      firmware_version: metadata.device?.firmwareVersion,
    } : null,
    sessionMetadata: metadata?.session || null,
  };
}

/**
 * Performs fast gap detection by sampling every Nth record
 * Useful for very large files where exact gap detection isn't required
 *
 * @param decoder - VTXDecoder instance
 * @param samplingInterval - Sample every Nth record (default 10)
 * @param gapThresholdMs - Gap threshold in milliseconds
 * @returns Approximate gap detection results
 *
 * @note
 * - Trades accuracy for speed: O(n/k) instead of O(n)
 * - May miss small gaps between sampled records
 * - Good for files >1GB or when exact gaps aren't critical
 * - At samplingInterval=10 and 100Hz, can still detect gaps >100ms
 */
export function detectDataRangesFast(
  decoder: VTXDecoder,
  samplingInterval: number = 10,
  gapThresholdMs: number = DEFAULT_GAP_THRESHOLD_MS
): GapDetectionResult {
  const header = decoder.getHeader();
  const recordCount = Number(header.recordCount);

  if (recordCount === 0) {
    return {
      ranges: [],
      gapInfo: {
        total_gaps: 0,
        largest_gap_ms: 0,
        total_gap_duration_ms: 0,
        gap_percentage: 0,
        gap_details: [],
      },
    };
  }

  const ranges: DataRange[] = [];
  const gaps: GapDetail[] = [];

  const startTimestamp = Number(header.startTimestamp);
  const firstRecord = decoder.readRecord(0);
  let rangeStartOffset = firstRecord.timestamp - startTimestamp;
  let lastTimestampOffset = rangeStartOffset;

  // Sample records at intervals
  for (let i = samplingInterval; i < recordCount; i += samplingInterval) {
    const record = decoder.readRecord(i);
    const currentOffset = record.timestamp - startTimestamp;
    const timeDiff = currentOffset - lastTimestampOffset;

    if (timeDiff > gapThresholdMs) {
      ranges.push({
        startOffsetMs: rangeStartOffset,
        endOffsetMs: lastTimestampOffset,
      });

      gaps.push({
        start_offset_ms: lastTimestampOffset,
        end_offset_ms: currentOffset,
        duration_ms: timeDiff,
      });

      rangeStartOffset = currentOffset;
    }

    lastTimestampOffset = currentOffset;
  }

  // Check final record
  const finalRecord = decoder.readRecord(recordCount - 1);
  const finalOffset = finalRecord.timestamp - startTimestamp;
  const finalDiff = finalOffset - lastTimestampOffset;

  if (finalDiff > gapThresholdMs) {
    ranges.push({
      startOffsetMs: rangeStartOffset,
      endOffsetMs: lastTimestampOffset,
    });

    gaps.push({
      start_offset_ms: lastTimestampOffset,
      end_offset_ms: finalOffset,
      duration_ms: finalDiff,
    });

    rangeStartOffset = finalOffset;
  }

  ranges.push({
    startOffsetMs: rangeStartOffset,
    endOffsetMs: finalOffset,
  });

  // Compute statistics
  const totalGapDuration = gaps.reduce((sum, gap) => sum + gap.duration_ms, 0);
  const largestGap = gaps.length > 0 ? Math.max(...gaps.map((g) => g.duration_ms)) : 0;
  const totalDuration = Number(header.endTimestamp - header.startTimestamp);
  const gapPercentage = totalDuration > 0 ? (totalGapDuration / totalDuration) * 100 : 0;

  return {
    ranges,
    gapInfo: {
      total_gaps: gaps.length,
      largest_gap_ms: largestGap,
      total_gap_duration_ms: totalGapDuration,
      gap_percentage: Math.round(gapPercentage * 100) / 100,
      gap_details: gaps,
    },
  };
}
