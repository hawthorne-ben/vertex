/**
 * Battery Utility Functions
 *
 * Handles LiPo battery voltage to percentage conversion and status
 */

// Battery reading history for stabilization (5-reading buffer)
const batteryHistory: number[] = [];
const BATTERY_HISTORY_SIZE = 5;

/**
 * LiPo Battery Voltage Ranges (single cell, 3.7V nominal)
 * - 4.2V: Fully charged (100%)
 * - 3.7V: Nominal voltage (50%)
 * - 3.5V: Low but usable (25%)
 * - 3.2V: Firmware cutoff (0% - device auto-sleeps to protect battery)
 *
 * Note: Firmware enforces 3.2V cutoff for battery protection
 */

export interface BatteryStatus {
  voltage: number;
  percentage: number;
  level: 'good' | 'low' | 'critical';
  color: string; // For use with theme colors
}

/**
 * Calculate mode (most frequent value) from battery history
 * If tie, returns the most recent value among tied values
 */
function calculateMode(values: number[]): number {
  if (values.length === 0) return 0;

  // Count frequency of each percentage value
  const frequency = new Map<number, number>();
  for (const val of values) {
    frequency.set(val, (frequency.get(val) || 0) + 1);
  }

  // Find maximum frequency
  let maxFreq = 0;
  let mode = values[values.length - 1]; // Default to most recent

  for (const [value, freq] of frequency.entries()) {
    if (freq > maxFreq) {
      maxFreq = freq;
      mode = value;
    }
  }

  return mode;
}

/**
 * Convert LiPo battery voltage to percentage with stabilization
 * Uses 5-reading buffer and mode calculation for stable display
 *
 * @param voltage Battery voltage in volts
 * @returns Percentage (0-100), stabilized via mode of last 5 readings
 */
export function voltageToPercentage(voltage: number): number {
  // Round to hundredths for consistent percentage calculation
  const stabilizedVoltage = Math.round(voltage * 100) / 100;

  // Clamp to valid range (firmware enforces 3.2V cutoff)
  let clampedVoltage = stabilizedVoltage;
  if (clampedVoltage >= 4.2) clampedVoltage = 4.2;
  if (clampedVoltage <= 3.2) clampedVoltage = 3.2;

  // Calculate raw percentage from voltage
  let rawPercentage: number;

  // Piecewise linear approximation (LiPo discharge curve)
  // 4.2V - 3.7V: 100% - 50% (steep drop)
  if (clampedVoltage > 3.7) {
    rawPercentage = 50 + ((clampedVoltage - 3.7) / (4.2 - 3.7)) * 50;
  }
  // 3.7V - 3.5V: 50% - 25% (moderate drop)
  else if (clampedVoltage > 3.5) {
    rawPercentage = 25 + ((clampedVoltage - 3.5) / (3.7 - 3.5)) * 25;
  }
  // 3.5V - 3.2V: 25% - 0% (rapid drop, firmware cutoff at 3.2V)
  else {
    rawPercentage = ((clampedVoltage - 3.2) / (3.5 - 3.2)) * 25;
  }

  // Round to integer percentage
  const percentage = Math.round(rawPercentage);

  // Add to history buffer
  batteryHistory.push(percentage);
  if (batteryHistory.length > BATTERY_HISTORY_SIZE) {
    batteryHistory.shift(); // Remove oldest
  }

  // Return mode of last 5 readings for stability
  return calculateMode(batteryHistory);
}

/**
 * Get battery status with color coding
 *
 * @param voltage Battery voltage in volts (null if unknown)
 * @returns BatteryStatus object with percentage, level, and theme color name
 */
export function getBatteryStatus(voltage: number | null): BatteryStatus | null {
  if (voltage === null || voltage === undefined) {
    return null;
  }

  const percentage = Math.round(voltageToPercentage(voltage));

  let level: 'good' | 'low' | 'critical';
  let color: string;

  if (percentage > 50) {
    level = 'good';
    color = 'success';
  } else if (percentage > 25) {
    level = 'low';
    color = 'warning';
  } else {
    level = 'critical';
    color = 'error';
  }

  return {
    voltage,
    percentage,
    level,
    color
  };
}

/**
 * Format battery display string
 *
 * @param voltage Battery voltage in volts (null if unknown)
 * @returns Formatted string like "85%" or "Battery" if unknown
 */
export function formatBatteryDisplay(voltage: number | null): string {
  if (voltage === null || voltage === undefined) {
    return 'Battery';
  }

  const percentage = Math.round(voltageToPercentage(voltage));
  return `${percentage}%`;
}
