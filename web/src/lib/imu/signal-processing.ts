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

    this.b1 = 2.0 * (1.0 - ita * ita) / (1.0 + q * ita + ita * ita)
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
