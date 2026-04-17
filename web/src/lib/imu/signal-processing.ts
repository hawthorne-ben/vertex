/**
 * Signal processing utilities for IMU data
 *
 * Low-pass filters to denoise gyro and accel data before fusion
 */

/**
 * Simple exponential moving average (EMA) low-pass filter
 * Computationally efficient for real-time processing
 */
export class LowPassFilter {
  private value: number | null = null
  private alpha: number

  /**
   * @param cutoffFreq - Cutoff frequency in Hz
   * @param sampleRate - Sample rate in Hz
   */
  constructor(cutoffFreq: number, sampleRate: number) {
    // Calculate alpha from cutoff frequency
    // alpha = dt / (RC + dt), where RC = 1 / (2 * PI * fc)
    const dt = 1.0 / sampleRate
    const RC = 1.0 / (2.0 * Math.PI * cutoffFreq)
    this.alpha = dt / (RC + dt)
  }

  /**
   * Filter a new sample
   */
  update(newValue: number): number {
    if (this.value === null) {
      this.value = newValue // Initialize
    } else {
      this.value = this.alpha * newValue + (1 - this.alpha) * this.value
    }
    return this.value
  }

  /**
   * Reset filter state
   */
  reset() {
    this.value = null
  }

  /**
   * Get current filtered value
   */
  getValue(): number | null {
    return this.value
  }
}

/**
 * High-pass filter for removing DC/constant components (e.g., gravity)
 * Implemented as: HPF(x) = x - LPF(x)
 */
export class HighPassFilter {
  private lpf: LowPassFilter

  /**
   * @param cutoffFreq - Cutoff frequency in Hz (frequencies below this are removed)
   * @param sampleRate - Sample rate in Hz
   */
  constructor(cutoffFreq: number, sampleRate: number) {
    this.lpf = new LowPassFilter(cutoffFreq, sampleRate)
  }

  /**
   * Filter a new sample (removes low frequencies, keeps high frequencies)
   */
  update(newValue: number): number {
    const lowFreqComponent = this.lpf.update(newValue)
    return newValue - lowFreqComponent  // Remove low frequencies
  }

  /**
   * Reset filter state
   */
  reset() {
    this.lpf.reset()
  }
}

/**
 * 3-axis low-pass filter for vector data (accel, gyro)
 */
export class VectorLowPassFilter {
  private xFilter: LowPassFilter
  private yFilter: LowPassFilter
  private zFilter: LowPassFilter

  constructor(cutoffFreq: number, sampleRate: number) {
    this.xFilter = new LowPassFilter(cutoffFreq, sampleRate)
    this.yFilter = new LowPassFilter(cutoffFreq, sampleRate)
    this.zFilter = new LowPassFilter(cutoffFreq, sampleRate)
  }

  /**
   * Filter a 3D vector
   */
  update(x: number, y: number, z: number): { x: number; y: number; z: number } {
    return {
      x: this.xFilter.update(x),
      y: this.yFilter.update(y),
      z: this.zFilter.update(z),
    }
  }

  /**
   * Reset filter state
   */
  reset() {
    this.xFilter.reset()
    this.yFilter.reset()
    this.zFilter.reset()
  }
}

/**
 * Butterworth 2nd-order low-pass filter (higher quality, more computation)
 * Uses Direct Form II implementation
 */
export class Butterworth2ndOrder {
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0

  private a0: number
  private a1: number
  private a2: number
  private b1: number
  private b2: number

  /**
   * @param cutoffFreq - Cutoff frequency in Hz
   * @param sampleRate - Sample rate in Hz
   */
  constructor(cutoffFreq: number, sampleRate: number) {
    // Calculate Butterworth coefficients
    const omega = 2 * Math.PI * cutoffFreq
    const dt = 1.0 / sampleRate
    const ita = 1.0 / Math.tan(omega * dt / 2.0)
    const q = Math.sqrt(2.0)

    // Feedback coefficients: maps to scipy's -a[1] and -a[2]
    // y[n] = a0*x[n] + a1*x[n-1] + a2*x[n-2] + b1*y[n-1] + b2*y[n-2]
    this.b1 = -2.0 * (1.0 - ita * ita) / (1.0 + q * ita + ita * ita)
    this.b2 = -(1.0 - q * ita + ita * ita) / (1.0 + q * ita + ita * ita)
    this.a0 = 1.0 / (1.0 + q * ita + ita * ita)
    this.a1 = 2.0 * this.a0
    this.a2 = this.a0
  }

  /**
   * Filter a new sample
   */
  update(newValue: number): number {
    const y = this.a0 * newValue + this.a1 * this.x1 + this.a2 * this.x2 +
              this.b1 * this.y1 + this.b2 * this.y2

    // Shift delay line
    this.x2 = this.x1
    this.x1 = newValue
    this.y2 = this.y1
    this.y1 = y

    return y
  }

  /**
   * Reset filter state
   */
  reset() {
    this.x1 = 0
    this.x2 = 0
    this.y1 = 0
    this.y2 = 0
  }
}

/**
 * Zero-phase forward-backward Butterworth filter (filtfilt).
 * Runs a 2nd-order Butterworth forward then backward over a pre-collected array,
 * cancelling phase lag entirely. Only usable for offline/post-processing.
 *
 * Equivalent to scipy.signal.filtfilt with a 2nd-order Butterworth.
 */
export function filtfilt(
  data: number[],
  cutoffFreq: number,
  sampleRate: number,
): number[] {
  if (data.length === 0) return []

  const forward = new Butterworth2ndOrder(cutoffFreq, sampleRate)
  const backward = new Butterworth2ndOrder(cutoffFreq, sampleRate)

  // Forward pass — seed filter state with first sample to reduce transient
  forward.reset()
  forward['x1'] = data[0]
  forward['x2'] = data[0]
  forward['y1'] = data[0]
  forward['y2'] = data[0]

  const fwd = new Array<number>(data.length)
  for (let i = 0; i < data.length; i++) {
    fwd[i] = forward.update(data[i])
  }

  // Backward pass over forward-filtered result
  backward.reset()
  backward['x1'] = fwd[fwd.length - 1]
  backward['x2'] = fwd[fwd.length - 1]
  backward['y1'] = fwd[fwd.length - 1]
  backward['y2'] = fwd[fwd.length - 1]

  const result = new Array<number>(data.length)
  for (let i = data.length - 1; i >= 0; i--) {
    result[i] = backward.update(fwd[i])
  }

  return result
}

/**
 * Zero-phase forward-backward EMA filter.
 * Like filtfilt but using the simpler EMA low-pass. Useful for slow-varying
 * signals like grade baseline where Butterworth sharpness isn't needed.
 */
export function filtfiltEma(
  data: number[],
  cutoffFreq: number,
  sampleRate: number,
): number[] {
  if (data.length === 0) return []

  const dt = 1.0 / sampleRate
  const RC = 1.0 / (2.0 * Math.PI * cutoffFreq)
  const alpha = dt / (RC + dt)

  // Forward pass
  const fwd = new Array<number>(data.length)
  fwd[0] = data[0]
  for (let i = 1; i < data.length; i++) {
    fwd[i] = alpha * data[i] + (1 - alpha) * fwd[i - 1]
  }

  // Backward pass
  const result = new Array<number>(data.length)
  result[data.length - 1] = fwd[data.length - 1]
  for (let i = data.length - 2; i >= 0; i--) {
    result[i] = alpha * fwd[i] + (1 - alpha) * result[i + 1]
  }

  return result
}

/**
 * 3-axis Butterworth filter for vector data
 */
export class VectorButterworthFilter {
  private xFilter: Butterworth2ndOrder
  private yFilter: Butterworth2ndOrder
  private zFilter: Butterworth2ndOrder

  constructor(cutoffFreq: number, sampleRate: number) {
    this.xFilter = new Butterworth2ndOrder(cutoffFreq, sampleRate)
    this.yFilter = new Butterworth2ndOrder(cutoffFreq, sampleRate)
    this.zFilter = new Butterworth2ndOrder(cutoffFreq, sampleRate)
  }

  /**
   * Filter a 3D vector
   */
  update(x: number, y: number, z: number): { x: number; y: number; z: number } {
    return {
      x: this.xFilter.update(x),
      y: this.yFilter.update(y),
      z: this.zFilter.update(z),
    }
  }

  /**
   * Reset filter state
   */
  reset() {
    this.xFilter.reset()
    this.yFilter.reset()
    this.zFilter.reset()
  }
}

/**
 * Band-pass filter implemented as cascaded HPF + LPF (both EMA-based)
 * Passes frequencies between lowCutoff and highCutoff, rejects DC and high-freq noise
 */
export class BandPassFilter {
  private hpf: HighPassFilter
  private lpf: LowPassFilter

  /**
   * @param lowCutoff - High-pass cutoff in Hz (frequencies below this are removed)
   * @param highCutoff - Low-pass cutoff in Hz (frequencies above this are removed)
   * @param sampleRate - Sample rate in Hz
   */
  constructor(lowCutoff: number, highCutoff: number, sampleRate: number) {
    this.hpf = new HighPassFilter(lowCutoff, sampleRate)
    this.lpf = new LowPassFilter(highCutoff, sampleRate)
  }

  /**
   * Filter a new sample (passes frequencies between low and high cutoffs)
   */
  update(newValue: number): number {
    // HPF first to remove DC/gravity, then LPF to remove high-freq noise
    const highPassed = this.hpf.update(newValue)
    return this.lpf.update(highPassed)
  }

  /**
   * Reset filter state
   */
  reset() {
    this.hpf.reset()
    this.lpf.reset()
  }
}

/**
 * Median filter for outlier rejection (useful for gyro spikes)
 */
export class MedianFilter {
  private buffer: number[] = []
  private windowSize: number

  constructor(windowSize: number = 5) {
    this.windowSize = windowSize
  }

  /**
   * Filter a new sample
   */
  update(newValue: number): number {
    this.buffer.push(newValue)
    if (this.buffer.length > this.windowSize) {
      this.buffer.shift()
    }

    // Return median of buffer
    const sorted = [...this.buffer].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid]
  }

  /**
   * Reset filter state
   */
  reset() {
    this.buffer = []
  }
}

/**
 * 3-axis median filter for vector data (outlier rejection)
 */
export class VectorMedianFilter {
  private xFilter: MedianFilter
  private yFilter: MedianFilter
  private zFilter: MedianFilter

  constructor(windowSize: number = 5) {
    this.xFilter = new MedianFilter(windowSize)
    this.yFilter = new MedianFilter(windowSize)
    this.zFilter = new MedianFilter(windowSize)
  }

  /**
   * Filter a 3D vector
   */
  update(x: number, y: number, z: number): { x: number; y: number; z: number } {
    return {
      x: this.xFilter.update(x),
      y: this.yFilter.update(y),
      z: this.zFilter.update(z),
    }
  }

  /**
   * Reset filter state
   */
  reset() {
    this.xFilter.reset()
    this.yFilter.reset()
    this.zFilter.reset()
  }
}
