/**
 * Bicycle-Aware IMU Filter
 *
 * Complementary filter optimized for bicycle dynamics
 * Improves upon BNO055's built-in fusion by exploiting bicycle physics constraints
 *
 * Key improvement: Denoise gyro and accel BEFORE fusion (like BNO055 does internally)
 */

import { VectorLowPassFilter } from './signal-processing'

export interface IMUReading {
  accelX: number
  accelY: number
  accelZ: number
  gyroX: number
  gyroY: number
  gyroZ: number
  timestamp: number // milliseconds
}

export interface GPSReading {
  speed: number // m/s
  heading: number // radians
  timestamp: number // milliseconds
}

export interface OrientationOutput {
  roll: number // radians
  pitch: number // radians
  yaw: number // radians
  accelTrust: number // 0-1, how much we trust accelerometer
  debug?: {
    accelMag: number // Magnitude of measured accel
    accelFiltered: { x: number; y: number; z: number } // Filtered accel vector
    gyroFiltered: { x: number; y: number; z: number } // Filtered gyro (rad/s)
    rollAccel: number // Roll calculated from accel (rad)
    pitchAccel: number // Pitch calculated from accel (rad)
    rollGyro: number // Roll from pure gyro integration (rad)
    pitchGyro: number // Pitch from pure gyro integration (rad)
    dynamicsFactor: number // Current dynamics factor (|a| - g) / g
    kAccelAdaptive: number // Actual accel gain used
    kGyroAdaptive: number // Actual gyro gain used
  }
}

export class BicycleIMUFilter {
  // Filter gains (tunable)
  private kAccel = 0.02 // Low-pass on accel (gravity correction)
  private kGyro = 0.98 // High-pass on gyro (fast response)
  private kGPS = 0.005 // Very slow GPS yaw correction
  private minAccelTrust = 0.1 // Never trust accel less than this (prevents pure integration)

  // Bicycle constraints (soft limits, not hard clipping)
  private readonly MAX_ROLL = (45.0 * Math.PI) / 180 // 45 degrees in radians
  private readonly MAX_PITCH = (30.0 * Math.PI) / 180 // 30 degrees in radians

  // Preprocessing filters (denoise BEFORE fusion - critical!)
  private gyroFilter: VectorLowPassFilter // Remove vibration from gyro
  private accelFilter: VectorLowPassFilter // Clean gravity vector
  private sampleRate: number

  // State
  private roll = 0.0
  private pitch = 0.0
  private yaw = 0.0
  private accelTrust = 1.0 // 0-1, decreases with high dynamics
  private accelTrustSmoothed = 1.0 // Low-pass filtered trust (prevents jitter)
  private lastTimestamp: number | null = null
  private initialized = false // Track if we've initialized from gravity
  private enableDebug = false // Enable debug output

  constructor(options?: {
    kAccel?: number
    kGyro?: number
    kGPS?: number
    maxRoll?: number
    maxPitch?: number
    sampleRate?: number
    gyroCutoff?: number
    accelCutoff?: number
    debug?: boolean
  }) {
    // Default sample rate (typical for BNO055 and our recordings)
    this.sampleRate = options?.sampleRate || 50.0

    // Initialize preprocessing filters
    // Gyro: Cut at 10 Hz (remove vibration, keep motion)
    // Accel: Cut at 5 Hz (clean gravity vector, remove bumps/vibration)
    const gyroCutoff = options?.gyroCutoff || 10.0
    const accelCutoff = options?.accelCutoff || 5.0

    this.gyroFilter = new VectorLowPassFilter(gyroCutoff, this.sampleRate)
    this.accelFilter = new VectorLowPassFilter(accelCutoff, this.sampleRate)

    if (options) {
      if (options.kAccel !== undefined) this.kAccel = options.kAccel
      if (options.kGyro !== undefined) this.kGyro = options.kGyro
      if (options.kGPS !== undefined) this.kGPS = options.kGPS
      if (options.maxRoll !== undefined)
        this.MAX_ROLL = (options.maxRoll * Math.PI) / 180
      if (options.maxPitch !== undefined)
        this.MAX_PITCH = (options.maxPitch * Math.PI) / 180
      if (options.debug !== undefined) this.enableDebug = options.debug
    }
  }

  /**
   * Update orientation estimate
   */
  update(imu: IMUReading, gps?: GPSReading): OrientationOutput {
    // Calculate dt (time step)
    let dt: number
    if (this.lastTimestamp === null) {
      dt = 0.02 // Default 20ms for first sample (50Hz)
      this.lastTimestamp = imu.timestamp
    } else {
      dt = (imu.timestamp - this.lastTimestamp) / 1000.0 // Convert ms to seconds
      this.lastTimestamp = imu.timestamp
    }

    // Clamp dt to reasonable range (avoid numerical issues)
    dt = Math.max(0.001, Math.min(dt, 0.1))

    // Convert gyro from deg/s to rad/s (BNO055 outputs deg/s)
    const gyroRadX = (imu.gyroX * Math.PI) / 180
    const gyroRadY = (imu.gyroY * Math.PI) / 180
    const gyroRadZ = (imu.gyroZ * Math.PI) / 180

    // PREPROCESSING: Denoise gyro and accel BEFORE fusion
    // This is what the BNO055 does internally - critical for stability!
    const gyroFiltered = this.gyroFilter.update(gyroRadX, gyroRadY, gyroRadZ)
    const accelFiltered = this.accelFilter.update(imu.accelX, imu.accelY, imu.accelZ)

    // 2. ACCELEROMETER GRAVITY (use filtered accel)
    const accelMag = Math.sqrt(
      accelFiltered.x ** 2 + accelFiltered.y ** 2 + accelFiltered.z ** 2
    )

    // Adaptive trust: trust accel more when |a| ≈ g (low dynamics)
    // When accelMag deviates from gravity, we're experiencing dynamics (braking, cornering, etc.)
    const G = 9.81 // gravity constant (m/s²)
    const dynamicsFactor = Math.abs(accelMag - G) / G
    this.accelTrust = Math.max(
      this.minAccelTrust,
      Math.min(1.0, 1.0 - dynamicsFactor / 4.0)
    )

    // Smooth trust over time to prevent jittery fusion gains (0.2 Hz low-pass)
    const trustAlpha = 0.05 // 5% new, 95% old (very smooth)
    this.accelTrustSmoothed = trustAlpha * this.accelTrust + (1.0 - trustAlpha) * this.accelTrustSmoothed

    // Calculate roll/pitch from gravity vector (use filtered accel)
    const rollAccel = Math.atan2(accelFiltered.y, accelFiltered.z)
    const pitchAccel = Math.atan2(
      -accelFiltered.x,
      Math.sqrt(accelFiltered.y ** 2 + accelFiltered.z ** 2)
    )

    // INITIALIZATION: Wait for valid accelerometer reading
    // Don't initialize until we see reasonable gravity magnitude (> 5 m/s²)
    // This lets the low-pass filters settle and rejects bad initial samples
    if (!this.initialized) {
      const MIN_ACCEL_FOR_INIT = 5.0 // m/s² - must be at least half of gravity

      if (accelMag > MIN_ACCEL_FOR_INIT) {
        // Valid gravity vector detected, initialize orientation
        this.roll = rollAccel
        this.pitch = pitchAccel
        this.yaw = 0.0 // No way to know initial heading without magnetometer
        this.initialized = true
      } else {
        // Still warming up - return neutral orientation
        const result: OrientationOutput = {
          roll: 0.0,
          pitch: 0.0,
          yaw: 0.0,
          accelTrust: 0.0, // No trust yet
        }

        if (this.enableDebug) {
          result.debug = {
            accelMag,
            accelFiltered: { x: accelFiltered.x, y: accelFiltered.y, z: accelFiltered.z },
            gyroFiltered: { x: gyroFiltered.x, y: gyroFiltered.y, z: gyroFiltered.z },
            rollAccel,
            pitchAccel,
            rollGyro: 0.0,
            pitchGyro: 0.0,
            dynamicsFactor,
            kAccelAdaptive: 0.0,
            kGyroAdaptive: 0.0,
          }
        }

        return result
      }

      // Just initialized - return initial orientation
      const result: OrientationOutput = {
        roll: this.roll,
        pitch: this.pitch,
        yaw: this.yaw,
        accelTrust: this.accelTrust,
      }

      if (this.enableDebug) {
        result.debug = {
          accelMag,
          accelFiltered: { x: accelFiltered.x, y: accelFiltered.y, z: accelFiltered.z },
          gyroFiltered: { x: gyroFiltered.x, y: gyroFiltered.y, z: gyroFiltered.z },
          rollAccel,
          pitchAccel,
          rollGyro: rollAccel, // Init: same as accel
          pitchGyro: pitchAccel, // Init: same as accel
          dynamicsFactor,
          kAccelAdaptive: 1.0, // Init: 100% accel
          kGyroAdaptive: 0.0, // Init: 0% gyro
        }
      }

      return result
    }

    // 1. GYRO INTEGRATION (use filtered gyro - no more 3000 deg/s spikes!)
    const rollGyro = this.roll + gyroFiltered.x * dt
    const pitchGyro = this.pitch + gyroFiltered.y * dt
    const yawGyro = this.yaw + gyroFiltered.z * dt

    // 3. COMPLEMENTARY FUSION with adaptive weighting
    // Use smoothed trust to prevent jittery fusion (stable convergence)
    const kAccelAdaptive = this.kAccel * this.accelTrustSmoothed
    const kGyroAdaptive = 1.0 - kAccelAdaptive

    this.roll = kGyroAdaptive * rollGyro + kAccelAdaptive * rollAccel
    this.pitch = kGyroAdaptive * pitchGyro + kAccelAdaptive * pitchAccel
    this.yaw = yawGyro // Pure integration for now

    // 4. BICYCLE CONSTRAINTS (soft, non-disruptive)

    // Soft roll constraint: pull gently toward center if exceeding typical range
    if (Math.abs(this.roll) > this.MAX_ROLL) {
      const excess = Math.abs(this.roll) - this.MAX_ROLL
      this.roll -= Math.sign(this.roll) * excess * 0.1 // Pull back 10% per sample
    }

    // Soft pitch constraint: pull gently toward center if exceeding typical range
    if (Math.abs(this.pitch) > this.MAX_PITCH) {
      const excess = Math.abs(this.pitch) - this.MAX_PITCH
      this.pitch -= Math.sign(this.pitch) * excess * 0.1 // Pull back 10% per sample
    }

    // 5. GPS YAW CORRECTION (optional)
    if (gps && gps.speed > 1.0) {
      // Only trust GPS heading when moving > 1 m/s
      // Slowly correct yaw drift using GPS
      const yawError = this.normalizeAngle(gps.heading - this.yaw)
      this.yaw += this.kGPS * yawError
    }

    // 6. BICYCLE PHYSICS VALIDATION
    // Use bicycle kinematics to cross-check yaw rate during turns
    // Only apply during high-confidence scenarios (good GPS, significant roll)
    if (gps && gps.speed > 2.0 && Math.abs(this.roll) > 0.1) {
      // Only validate when moving >2 m/s and leaning >5.7°
      const wheelbase = 1.0 // meters, typical bike
      const expectedYawRate = (gps.speed / wheelbase) * Math.tan(this.roll)

      // If measured yaw rate differs significantly, blend toward physics model
      const yawRateError = Math.abs(gyroFiltered.z - expectedYawRate)
      if (yawRateError > 0.7) {
        // 40 deg/s threshold (0.7 rad/s) - gyro might be saturated
        // Gently blend toward physics model (10% correction per sample)
        const physicsYaw = this.yaw + expectedYawRate * dt
        this.yaw = 0.9 * this.yaw + 0.1 * physicsYaw
      }
    }

    // DON'T normalize yaw here - let it drift, we'll wrap for display only

    const result: OrientationOutput = {
      roll: this.roll,
      pitch: this.pitch,
      yaw: this.yaw,
      accelTrust: this.accelTrust,
    }

    if (this.enableDebug) {
      result.debug = {
        accelMag,
        accelFiltered: { x: accelFiltered.x, y: accelFiltered.y, z: accelFiltered.z },
        gyroFiltered: { x: gyroFiltered.x, y: gyroFiltered.y, z: gyroFiltered.z },
        rollAccel,
        pitchAccel,
        rollGyro,
        pitchGyro,
        dynamicsFactor,
        kAccelAdaptive,
        kGyroAdaptive,
      }
    }

    return result
  }

  /**
   * Reset filter state
   */
  reset() {
    this.roll = 0.0
    this.pitch = 0.0
    this.yaw = 0.0
    this.accelTrust = 1.0
    this.accelTrustSmoothed = 1.0
    this.lastTimestamp = null
    this.initialized = false

    // Reset preprocessing filters
    this.gyroFilter.reset()
    this.accelFilter.reset()
  }

  /**
   * Wrap angle to [-π, π]
   */
  private normalizeAngle(angle: number): number {
    while (angle > Math.PI) {
      angle -= 2 * Math.PI
    }
    while (angle < -Math.PI) {
      angle += 2 * Math.PI
    }
    return angle
  }

  /**
   * Convert radians to degrees
   */
  static radToDeg(rad: number): number {
    return (rad * 180) / Math.PI
  }

  /**
   * Convert degrees to radians
   */
  static degToRad(deg: number): number {
    return (deg * Math.PI) / 180
  }
}

/**
 * Batch process IMU data with bicycle filter
 */
export function processBatch(
  imuReadings: IMUReading[],
  gpsReadings?: GPSReading[]
): OrientationOutput[] {
  const filter = new BicycleIMUFilter()
  const results: OrientationOutput[] = []

  for (const imu of imuReadings) {
    // Find closest GPS reading within 1 second window
    let closestGPS: GPSReading | undefined
    let minTimeDiff = 1000 // 1 second threshold

    if (gpsReadings) {
      for (const gps of gpsReadings) {
        const timeDiff = Math.abs(gps.timestamp - imu.timestamp)
        if (timeDiff < minTimeDiff) {
          minTimeDiff = timeDiff
          closestGPS = gps
        }
      }
    }

    results.push(filter.update(imu, closestGPS))
  }

  return results
}
