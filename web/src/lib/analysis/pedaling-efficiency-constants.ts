/**
 * Pedaling Stability & Surface Roughness Algorithm Constants
 *
 * Centralized configuration for easy tuning without hunting through code.
 * Adjust these values to calibrate algorithm for different riding styles.
 *
 * v6.0.0: Time-domain RMS stability (BPF'd gyro → windowed RMS → ceiling normalization)
 *         Replaces FFT spectral analysis. FFT constants retained for future use.
 */

// ============================================
// ALGORITHM VERSION
// ============================================

/**
 * Version string for cache invalidation
 * Bump this when changing any constants or algorithm logic
 */
export const ALGORITHM_VERSION = '6.4.0'  // Speed² roughness ceiling scaling

// ============================================
// WINDOWED RMS CONFIGURATION
// ============================================

/**
 * Sliding window size in seconds for stability RMS calculation
 * Matches position detection window for consistency
 */
export const STFT_WINDOW_SECONDS = 3

/**
 * Window hop size in seconds (advance rate)
 * 0.5s → 2 Hz output rate, linearly interpolated to 25 Hz for output
 */
export const STFT_HOP_SECONDS = 0.5

// ============================================
// STABILITY BANDPASS FILTER
// ============================================

/**
 * Bandpass filter bounds for stability signals (gyro-x, gyro-z, accel-x)
 * Isolates the human-frequency range from DC drift and aliased noise.
 * Cornering lean is sub-0.3 Hz and gets attenuated by the BPF.
 *
 * 0.3 Hz: catches very slow cadences (18 RPM), rejects sustained lean
 * 10.0 Hz: captures harmonics up to ~5th order, well below Nyquist (12.5 Hz)
 */
export const STABILITY_BPF_LOW_HZ = 0.3
export const STABILITY_BPF_HIGH_HZ = 10.0

// ============================================
// FFT CONSTANTS (retained for future spectral analysis)
// ============================================

/** FFT size for future spectral features (not used by stability v6) */
export const STFT_FFT_SIZE = 128

/** Cadence band half-width (not used by stability v6) */
export const CADENCE_BAND_HALF_WIDTH_HZ = 0.2

/** Minimum cadence for spectral analysis (not used by stability v6) */
export const MIN_CADENCE_RPM = 30

/** Wider cadence band for low cadence (not used by stability v6) */
export const LOW_CADENCE_BAND_HALF_WIDTH_HZ = 0.3

// ============================================
// STABILITY AXIS WEIGHTS
// ============================================

/**
 * Weighted fusion of per-axis spectral coherence
 * Must sum to 1.0
 *
 * Gyro-x (roll): cleanest signal, road noise produces minimal frame roll
 * Gyro-z (yaw): captures handlebar instability, synced with roll
 * Accel-x (surge): captures uneven power application, noisier but self-normalizing
 */
export const STABILITY_ROLL_WEIGHT = 0.7   // Gyro-x: frame roll
export const STABILITY_YAW_WEIGHT = 0.3    // Gyro-z: handlebar stability
export const STABILITY_SURGE_WEIGHT = 0.0  // Accel-x: disabled (incompatible units with gyro deg/s)

// ============================================
// STABILITY CEILING NORMALIZATION
// ============================================

/**
 * Maximum expected weighted RMS at cadence frequency for stability normalization
 * stability = max(0, 1 - weightedRms / MAX_STABILITY_RMS)
 *
 * Units: mixed (gyro deg/s, accel m/s²) weighted sum
 * Calibrate from real data. Start at 5.0, tune with tuning modal.
 */
export const MAX_STABILITY_RMS = 15.0

/**
 * Maximum expected weighted RMS per watt for power-normalized stability
 * Used when POWER_NORMALIZE_STABILITY is enabled
 */
export const MAX_STABILITY_RMS_PER_WATT = 0.02

/**
 * Whether to normalize stability by instantaneous power (watts)
 * Default off — not all riders have power meters.
 * When enabled, higher-power efforts are allowed more motion.
 */
export const POWER_NORMALIZE_STABILITY = false

// ============================================
// SURFACE ROUGHNESS
// ============================================

/**
 * High-pass filter cutoff for roughness signals (accel-x, accel-z)
 * Removes gravity and constant acceleration
 */
export const ROUGHNESS_HPF_CUTOFF_HZ = 0.5

/**
 * Speed² roughness ceiling configuration
 *
 * Vibration energy scales with speed², so ceiling = baseCeiling * (speed / refSpeed)².
 * Same surface at any speed produces the same normalized roughness score.
 *
 * Reference speed: ~17 mph (7.5 m/s), midpoint of typical riding range.
 * At 5 mph (0.44x ref): ceiling = 15 * 0.19 = 2.9 (very sensitive)
 * At 30 mph (1.79x ref): ceiling = 15 * 3.2 = 48 (very forgiving)
 */
export const ROUGHNESS_BASE_CEILING = 50.0         // RMS ceiling at reference speed
export const ROUGHNESS_REFERENCE_SPEED_MS = 6.0    // ~13 mph
export const ROUGHNESS_SPEED_EXPONENT = 1.0        // Power law: 0.5=sqrt, 1.0=linear, 2.0=energy

/**
 * Rolling window for roughness RMS calculation in seconds
 */
export const ROUGHNESS_WINDOW_SECONDS = 3

/**
 * Roughness threshold for "smooth surface" classification
 * Samples below this count toward smoothSurfacePercent
 */
export const ROUGHNESS_SMOOTH_THRESHOLD = 0.3

/**
 * Roughness threshold for "rough surface" classification
 * Samples above this count toward roughSurfacePercent
 */
export const ROUGHNESS_ROUGH_THRESHOLD = 0.7

// ============================================
// TIME SYNCHRONIZATION
// ============================================

/**
 * Maximum time difference for FIT/VTX sync in milliseconds
 * Samples within this tolerance are considered synchronized
 */
export const SYNC_TOLERANCE_MS = 100

// ============================================
// METADATA THRESHOLDS
// ============================================

/**
 * Stability threshold for "stable" classification
 * Samples above this count toward stablePercent metric
 */
export const STABLE_THRESHOLD = 0.7

/**
 * Stability threshold for "unstable" classification
 * Samples below this count toward unstablePercent metric
 */
export const UNSTABLE_THRESHOLD = 0.5

// ============================================
// DEBUG CONFIGURATION
// ============================================

/**
 * Window size for debug sample extraction (seconds)
 * Used to capture representative windows for analysis
 */
export const DEBUG_WINDOW_SECONDS = 5

/**
 * Default sample rate if detection fails (Hz)
 * Most VTX files are 25 Hz, FIT files are 1 Hz
 */
export const DEFAULT_SAMPLE_RATE_HZ = 25

/**
 * Output sample rate for analysis results (Hz)
 * STFT windows are at ~2 Hz, so anything above that is interpolation.
 * 5 Hz gives smooth charts without bloating JSONB storage.
 */
export const OUTPUT_SAMPLE_RATE_HZ = 5

// ============================================
// GRADE SMOOTHING
// ============================================

/**
 * Window size for grade smoothing in seconds
 * Grade data is noisy, apply moving average
 */
export const GRADE_SMOOTH_WINDOW_SECONDS = 10

/**
 * Maximum reasonable grade percentage
 * Values outside ±MAX_GRADE are clamped
 */
export const MAX_GRADE_PERCENT = 30

// ============================================
// RIDING POSITION DETECTION
// ============================================

/**
 * Y-axis (lateral rocking) threshold for standing detection
 * Standing creates lateral rocking motion not present when seated
 *
 * Tuning guide:
 * - 1.0 m/s²: Very sensitive, may detect seated rocking
 * - 1.5 m/s²: Sensitive - may detect aggressive seated pedaling
 * - 2.2 m/s²: Balanced (default) - filters out most seated rocking
 * - 2.5 m/s²: Conservative, only very aggressive standing
 */
export const Y_AXIS_STANDING_THRESHOLD = 1.0

/**
 * Window size for position calculation in seconds
 * Matches STFT window for consistency
 */
export const POSITION_WINDOW_SECONDS = 3

// ============================================
// GYRO ROLL RATE (POSITION DETECTION)
// ============================================

/**
 * Band-pass filter low cutoff for gyro_x roll rate (Hz)
 * Must pass the 0.5 Hz roll fundamental from 60 RPM standing cadence
 */
export const ROLL_BPF_LOW_HZ = 0.3

/**
 * Band-pass filter high cutoff for gyro_x roll rate (Hz)
 * Rejects road vibration harmonics above cadence range
 */
export const ROLL_BPF_HIGH_HZ = 4.0

/**
 * RMS threshold for band-pass filtered gyro_x roll rate (deg/s)
 * Standing produces periodic roll oscillation above this threshold
 *
 * Tuning guide:
 * - 5 deg/s: Very sensitive
 * - 10 deg/s: Balanced (default)
 * - 15 deg/s: Conservative
 */
export const ROLL_RMS_STANDING_THRESHOLD = 10

/**
 * Weight for gyro-derived roll signal in position detection (0–1)
 * Combined with accel weight for weighted fusion
 */
export const POSITION_GYRO_WEIGHT = 0.7

/**
 * Weight for accel-derived Y-axis signal in position detection (0–1)
 * Combined with gyro weight for weighted fusion
 */
export const POSITION_ACCEL_WEIGHT = 0.3
