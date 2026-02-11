/**
 * Pedaling Efficiency Algorithm Constants
 *
 * Centralized configuration for easy tuning without hunting through code.
 * Adjust these values to calibrate algorithm for different riding styles.
 */

// ============================================
// ALGORITHM VERSION
// ============================================

/**
 * Version string for cache invalidation
 * Bump this when changing any constants or algorithm logic
 */
export const ALGORITHM_VERSION = '1.1.1'

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

/**
 * Window size for FFT cadence detection in seconds
 * Larger = better frequency resolution but less responsive
 * Smaller = faster updates but less accurate cadence
 *
 * Tuning guide:
 * - 5 seconds: Minimum for reliable cadence detection
 * - 10 seconds: Balanced (default) - good resolution
 * - 15 seconds: Maximum resolution, slow to respond
 */
export const FFT_WINDOW_SECONDS = 10

/**
 * Use 3-axis acceleration magnitude vs single axis
 * true = captures pedaling forces in any direction (recommended)
 * false = uses only accel_x (bike orientation dependent)
 */
export const USE_MAGNITUDE = true

// ============================================
// PEDALING DETECTION THRESHOLDS
// ============================================

/**
 * Minimum confidence threshold to report efficiency
 * Lower = more sensitive (may include coasting)
 * Higher = more strict (only confident pedaling)
 *
 * Tuning guide:
 * - 0.10: Very sensitive, may show false positives
 * - 0.15: Balanced (default) - good for mountain biking
 * - 0.25: Strict, only very clear pedaling
 */
export const CONFIDENCE_THRESHOLD = 0.15

/**
 * Standard deviation threshold for stationary detection (m/s²)
 * Below this value, assume bike is stationary (not pedaling)
 *
 * INCREASED from 0.05 to fix false positives when stationary
 *
 * Tuning guide:
 * - 0.05: Too sensitive - shows pedaling when stationary
 * - 0.15: Balanced (new default) - rejects stationary periods
 * - 0.25: Very strict, may miss gentle pedaling
 */
export const STATIONARY_THRESHOLD = 0.15

/**
 * Minimum reasonable cadence in RPM
 * Below this is likely noise, not pedaling
 */
export const MIN_CADENCE_RPM = 40

/**
 * Maximum reasonable cadence in RPM
 * Above this is likely noise, not pedaling
 */
export const MAX_CADENCE_RPM = 130

// ============================================
// FFT CONFIDENCE CALCULATION
// ============================================

/**
 * Method 1: Strong periodic signal (road cycling, smooth trails)
 * Peak must be this many times higher than median power
 */
export const METHOD_1_PEAK_TO_MEDIAN = 2.5

/**
 * Method 1: Minimum standard deviation (m/s²)
 */
export const METHOD_1_MIN_STDDEV = 0.15

/**
 * Method 1: Bonus confidence multiplier for very strong peaks
 */
export const METHOD_1_STRONG_PEAK_THRESHOLD = 5.0
export const METHOD_1_STRONG_PEAK_BONUS = 0.2

/**
 * Method 2: Moderate signal (mountain biking)
 * TIGHTENED: Peak to median ratio requirement
 */
export const METHOD_2_PEAK_TO_MEDIAN = 1.5

/**
 * Method 2: Minimum standard deviation (m/s²)
 */
export const METHOD_2_MIN_STDDEV = 0.2

/**
 * Method 2: Cadence range for validation
 */
export const METHOD_2_MIN_CADENCE = 50
export const METHOD_2_MAX_CADENCE = 110

/**
 * Method 2: Maximum confidence (capped because signal is moderate)
 */
export const METHOD_2_MAX_CONFIDENCE = 0.6

/**
 * Method 3: High variance with weak periodic component (very rough terrain)
 * TIGHTENED: Increased from 1.2 to 2.0 to reduce false positives on descents
 */
export const METHOD_3_PEAK_TO_MEDIAN = 2.0

/**
 * Method 3: Minimum standard deviation (m/s²)
 */
export const METHOD_3_MIN_STDDEV = 0.5

/**
 * Method 3: Cadence range for validation
 */
export const METHOD_3_MIN_CADENCE = 40
export const METHOD_3_MAX_CADENCE = 120

/**
 * Method 3: Maximum confidence (very uncertain due to noise)
 */
export const METHOD_3_MAX_CONFIDENCE = 0.4

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

/**
 * Efficiency rescaling parameters
 * Maps raw efficiency range to more motivating output range
 *
 * NEW: Linear rescaling to make good riders feel better
 * [EFFICIENCY_FLOOR, 1.0] → [RESCALE_MIN, RESCALE_MAX]
 *
 * Current: [15%, 100%] → [30%, 100%]
 * - Your 70% becomes 82% (more motivating!)
 * - Your 85% becomes 92% (rare perfection)
 * - Floor of 15% becomes 30% (shows bad segments, not too discouraging)
 * - Better heatmap resolution with 70% range instead of 50%
 */
export const RESCALE_MIN = 0.30  // Output minimum (30%)
export const RESCALE_MAX = 1.00  // Output maximum (100%)

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

/**
 * Minimum samples required for FFT analysis
 * Below this, skip FFT and return zero confidence
 */
export const MIN_FFT_SAMPLES = 32

/**
 * Minimum frequency to analyze in FFT (Hz)
 * Skip DC component and very low frequencies
 */
export const MIN_FFT_FREQUENCY_HZ = 0.1

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
