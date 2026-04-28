import { useMemo } from 'react'
import {
  LowPassFilter,
  HighPassFilter,
  BandPassFilter,
  filtfilt,
  filtfiltEma,
} from '@/lib/imu/signal-processing'
import type { IMUSample } from './useIMUData'

// ============================================
// Types
// ============================================

export type FilterAxis =
  | 'accel_x' | 'accel_y' | 'accel_z'
  | 'gyro_x' | 'gyro_y' | 'gyro_z'

export interface FilterDefinition {
  id: string
  type: 'lpf' | 'hpf' | 'bpf'
  cutoffHz: number          // LPF/HPF cutoff; BPF upper bound
  cutoffLowHz?: number      // BPF lower bound
  phase: 'zero' | 'causal'
  axes: FilterAxis[]
}

export interface FilteredStream {
  filterId: string
  axis: FilterAxis
  label: string
  values: (number | null)[]
}

// ============================================
// Axis extraction
// ============================================

const AXIS_GETTERS: Record<FilterAxis, (s: IMUSample) => number> = {
  accel_x: s => s.accel_x,
  accel_y: s => s.accel_y,
  accel_z: s => s.accel_z,
  gyro_x: s => s.gyro_x,
  gyro_y: s => s.gyro_y,
  gyro_z: s => s.gyro_z,
}

const AXIS_SHORT: Record<FilterAxis, string> = {
  accel_x: 'X', accel_y: 'Y', accel_z: 'Z',
  gyro_x: 'X', gyro_y: 'Y', gyro_z: 'Z',
}

// ============================================
// Filter application
// ============================================

function applyFilter(
  raw: number[],
  def: FilterDefinition,
  sampleRate: number,
): number[] {
  if (raw.length === 0) return []

  if (def.phase === 'zero') {
    return applyZeroPhase(raw, def, sampleRate)
  }
  return applyCausal(raw, def, sampleRate)
}

function applyZeroPhase(
  raw: number[],
  def: FilterDefinition,
  sampleRate: number,
): number[] {
  switch (def.type) {
    case 'lpf':
      return filtfilt(raw, def.cutoffHz, sampleRate)

    case 'hpf': {
      // HPF = signal - LPF(signal)
      const lp = filtfiltEma(raw, def.cutoffHz, sampleRate)
      return raw.map((v, i) => v - lp[i])
    }

    case 'bpf': {
      const lowCut = def.cutoffLowHz ?? 0.1
      const highCut = def.cutoffHz
      // BPF = LPF(highCut) then subtract LPF(lowCut) of the result
      const lp = filtfilt(raw, highCut, sampleRate)
      const lpOfLp = filtfiltEma(lp, lowCut, sampleRate)
      return lp.map((v, i) => v - lpOfLp[i])
    }
  }
}

function applyCausal(
  raw: number[],
  def: FilterDefinition,
  sampleRate: number,
): number[] {
  switch (def.type) {
    case 'lpf': {
      const f = new LowPassFilter(def.cutoffHz, sampleRate)
      return raw.map(v => f.update(v))
    }

    case 'hpf': {
      const f = new HighPassFilter(def.cutoffHz, sampleRate)
      return raw.map(v => f.update(v))
    }

    case 'bpf': {
      const lowCut = def.cutoffLowHz ?? 0.1
      const highCut = def.cutoffHz
      const f = new BandPassFilter(lowCut, highCut, sampleRate)
      return raw.map(v => f.update(v))
    }
  }
}

// ============================================
// Label construction
// ============================================

function filterLabel(axis: FilterAxis, def: FilterDefinition): string {
  const axisName = AXIS_SHORT[axis]
  const phaseTag = def.phase === 'causal' ? ' causal' : ''

  switch (def.type) {
    case 'lpf':
      return `${axisName} (LPF ${def.cutoffHz}Hz${phaseTag})`
    case 'hpf':
      return `${axisName} (HPF ${def.cutoffHz}Hz${phaseTag})`
    case 'bpf':
      return `${axisName} (BPF ${def.cutoffLowHz ?? 0.1}-${def.cutoffHz}Hz${phaseTag})`
  }
}

// ============================================
// Hook
// ============================================

/**
 * Apply filter definitions to raw IMU samples and return additional chart
 * series. Each (filter, axis) pair produces one FilteredStream with values
 * parallel to the input samples array.
 *
 * Memoized on [samples, filters, sampleRate] — re-runs only when inputs change.
 */
export function useFilteredStreams(
  samples: IMUSample[],
  filters: FilterDefinition[],
  sampleRate: number,
): FilteredStream[] {
  // Serialize filter defs for stable memo key (avoid re-running on object identity change)
  const filtersKey = JSON.stringify(filters)

  return useMemo(() => {
    if (samples.length === 0 || filters.length === 0) return []

    const streams: FilteredStream[] = []

    for (const def of filters) {
      for (const axis of def.axes) {
        // Extract raw values for this axis
        const getter = AXIS_GETTERS[axis]
        const raw = samples.map(getter)

        // Apply filter
        const filtered = applyFilter(raw, def, sampleRate)

        streams.push({
          filterId: def.id,
          axis,
          label: filterLabel(axis, def),
          values: filtered,
        })
      }
    }

    return streams
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, filtersKey, sampleRate])
}
