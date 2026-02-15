/**
 * Pedaling Efficiency Algorithm Constants
 *
 * Centralized configuration for easy tuning without hunting through code.
 * Adjust these values to calibrate algorithm for different riding styles.
 *
 * v3.0.0: FIT cadence for pedaling detection, removed FFT/BPF
 */

// ============================================
// ALGORITHM VERSION
// ============================================

/**
 * Version string for cache invalidation
 * Bump this when changing any constants or algorithm logic
 */
export const ALGORITHM_VERSION = '3.0.0'  // FIT cadence, no FFT

// ============================================
// SIGNAL PROCESSING
// ============================================

/**
 * High-pass filter cutoff frequency in Hz
 * Removes gravity and constant acceleration components
 * Lower = more aggressive filtering (removes slower movements)
 * Higher = preserves more signal (but keeps some gravity)
 *
 * Tuning guide:
 * - 0.3 Hz: Very aggressive, removes all slow movements
 * - 0.5 Hz: Balanced (default) - removes gravity, keeps pedaling
 * - 0.8 Hz: Minimal filtering, keeps most signal
 */
export const HPF_CUTOFF_HZ = 0.5

/**
 * Window size for efficiency calculation in seconds
 * Larger = smoother results but less responsive to changes
 * Smaller = more responsive but noisier
 *
 * Tuning guide:
 * - 2 seconds: Very responsive, shows every variation
 * - 3 seconds: Balanced (default)
 * - 5 seconds: Very smooth, averages out technique variations
 */
export const EFFICIENCY_WINDOW_SECONDS = 3

// ============================================
// EFFICIENCY FORMULA
// ============================================

/**
 * Decay constant for efficiency formula: efficiency = exp(-k * stdDev)
 * Lower k = more generous scoring (higher efficiency values)
 * Higher k = stricter scoring (lower efficiency values)
 *
 * Current calibration (k = 0.18):
 * - stdDev ~0.5 m/s² (very smooth) → ~85% efficiency
 * - stdDev ~1.0 m/s² (smooth) → ~70% efficiency
 * - stdDev ~2.0 m/s² (moderate) → ~50% efficiency
 * - stdDev ~4.0 m/s² (rough) → ~25% efficiency
 */
export const EFFICIENCY_DECAY_CONSTANT = 0.18

/**
 * Minimum raw efficiency value (floor to prevent extremely low scores)
 * Raw values below this are clamped up to prevent discouragement
 */
export const EFFICIENCY_FLOOR = 0.15


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
 * Efficiency threshold for "smooth" classification
 * Samples above this count toward smoothPercent metric
 */
export const SMOOTH_THRESHOLD = 0.7

/**
 * Efficiency threshold for "rough" classification
 * Samples below this count toward roughPercent metric
 */
export const ROUGH_THRESHOLD = 0.5

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
export const Y_AXIS_STANDING_THRESHOLD = 2.2

/**
 * Window size for position calculation in seconds
 * Matches efficiency window for consistency
 */
export const POSITION_WINDOW_SECONDS = 3
