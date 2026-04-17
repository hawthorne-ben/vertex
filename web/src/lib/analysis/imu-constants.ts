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
export const ALGORITHM_VERSION = '8.3.0'  // Longitudinal accel compensation + per-ride pitch offset calibration

// ============================================
// WINDOWED RMS CONFIGURATION
// ============================================

/**
 * Sliding window size in seconds for stability RMS calculation
 * Matches position detection window for consistency
 */
export const WINDOW_SECONDS = 3

/**
 * Window hop size in seconds (advance rate)
 * 0.5s → 2 Hz output rate, linearly interpolated to 104 Hz for output
 */
export const WINDOW_HOP_SECONDS = 0.5

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
export const FFT_SIZE = 128

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
 * VTX files are 104 Hz (v2), FIT files are 1 Hz
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
 * - 1.0 m/s²: Very sensitive, seated baseline is ~1.1-1.3
 * - 1.5 m/s²: Sensitive - may detect aggressive seated pedaling
 * - 2.0 m/s²: Balanced (default) - filters out seated rocking
 * - 2.5 m/s²: Conservative, only very aggressive standing
 */
export const Y_AXIS_STANDING_THRESHOLD = 2.0

/**
 * Window size for position calculation in seconds
 * Independent from STFT stability window for separate tuning.
 * Shorter = more responsive to transitions, noisier.
 * Longer = smoother but detects transitions later.
 */
export const POSITION_WINDOW_SECONDS = 3

// ============================================
// GYRO ROLL RATE (POSITION DETECTION)
// ============================================

/**
 * Band-pass filter low cutoff for gyro_x roll rate (Hz)
 * 0.5 Hz rejects sustained cornering/bridge turns (0.1-0.2 Hz)
 * while passing standing cadence (1.0+ Hz fundamental)
 */
export const ROLL_BPF_LOW_HZ = 0.5

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
export const ROLL_RMS_STANDING_THRESHOLD = 6

/**
 * Weight for gyro-derived roll signal in position detection (0–1)
 * Split equally between roll (gyro-x) and yaw (gyro-z) by default
 */
export const POSITION_GYRO_WEIGHT = 0.7

/**
 * Weight for accel-derived Y-axis signal in position detection (0–1)
 */
export const POSITION_ACCEL_WEIGHT = 0.3

// ============================================
// GYRO YAW RATE (POSITION DETECTION)
// ============================================

/**
 * Band-pass filter low cutoff for gyro_z yaw rate (Hz)
 * Same band as roll — standing yaw oscillation tracks pedaling cadence
 */
export const YAW_BPF_LOW_HZ = 0.5

/**
 * Band-pass filter high cutoff for gyro_z yaw rate (Hz)
 */
export const YAW_BPF_HIGH_HZ = 4.0

/**
 * RMS threshold for band-pass filtered gyro_z yaw rate (deg/s)
 * Standing produces periodic yaw oscillation from handlebar sway
 *
 * Tuning guide:
 * - 3 deg/s: Very sensitive
 * - 6 deg/s: Balanced (default, matches roll threshold)
 * - 10 deg/s: Conservative
 */
export const YAW_RMS_STANDING_THRESHOLD = 6

/**
 * Weight for roll (gyro-x) within the gyro component (0–1)
 * rollWeight + yawWeight should = 1.0
 * These split the gyroWeight between roll and yaw signals
 */
export const POSITION_ROLL_WEIGHT = 0.5

/**
 * Weight for yaw (gyro-z) within the gyro component (0–1)
 */
export const POSITION_YAW_WEIGHT = 0.5

// ============================================
// BRAKING DETECTION
// ============================================

/**
 * Zero-phase Butterworth LPF cutoff for accel before pitch calculation (Hz)
 * Applied as forward-backward (filtfilt) so no phase lag.
 * 5 Hz preserves the full braking envelope (human actions 0.5-4 Hz)
 * while rejecting road chatter and knobby tire vibration (>15 Hz).
 */
export const BRAKING_LPF_HZ = 5.0

/**
 * Grade baseline EMA cutoff frequency (Hz)
 * Applied as forward-backward EMA for zero-lag grade tracking.
 * 0.1 Hz ≈ 10-second equivalent window — captures grade changes
 * without lagging on steep transitions.
 */
export const BRAKING_GRADE_LPF_HZ = 0.1

/**
 * FIT speed smoothing cutoff (Hz) for dv/dt computation.
 * Applied as forward-backward EMA over FIT speed before differentiation.
 * 0.3 Hz ≈ 3-second equivalent window — smooths GPS noise without
 * blurring real acceleration events.
 *
 * Used to compensate longitudinal inertial bleed onto accel_x. When the
 * rider accelerates, the accelerometer can't distinguish forward inertia
 * from a nose-up tilt — both bleed gravity onto accel_x. We subtract the
 * FIT-derived pitch-equivalent acceleration before computing grade.
 */
export const BRAKING_SPEED_LPF_HZ = 0.3

/**
 * Minimum deceleration to register as braking (m/s²)
 * Below this is coasting/aero drag. Typical light braking starts at ~1 m/s².
 */
export const BRAKING_THRESHOLD_MS2 = 3.0

/**
 * Maximum braking deceleration for 0-100 scaling (m/s²)
 * ~0.8g is near pitch-over limit for most bikes.
 */
export const BRAKING_MAX_MS2 = 8.0

/**
 * Braking-specific window size in seconds.
 * Shorter than stability/roughness window to capture brief brake checks.
 * 0.75s captures events as short as 400ms without over-fragmenting.
 */
export const BRAKING_WINDOW_SECONDS = 0.75

/**
 * Braking window hop size in seconds.
 * 0.2s → 5 Hz braking resolution, matching output rate.
 */
export const BRAKING_WINDOW_HOP_SECONDS = 0.2

/**
 * Gyro-Y (pitch rate) correlation — minimum pitch rate (deg/s) that
 * indicates sustained forward rotation consistent with braking.
 * Below this, pitch rate is ambiguous (could be terrain oscillation).
 */
export const BRAKING_GYRO_PITCH_RATE_MIN = 3.0

/**
 * Gyro-Y correlation boost factor.
 * When gyro pitch rate is sustained and correlates with accel deceleration,
 * effective deceleration is scaled by (1 + boost).
 * When gyro shows oscillatory pattern (bump), scaled by (1 - penalty).
 */
export const BRAKING_GYRO_CORRELATION_BOOST = 0.3

/**
 * Gyro-Y anti-correlation penalty factor.
 * Applied when gyro pitch rate oscillates (sign changes), suggesting
 * bump-induced pitch rather than braking.
 */
export const BRAKING_GYRO_OSCILLATION_PENALTY = 0.4

/**
 * Gyro-Y integration window for terrain transition detection (seconds).
 * Wider than the brake correlation window so we can see the full crest/dip
 * rotation event around the suspected braking peak.
 */
export const BRAKING_GYRO_INTEGRAL_WINDOW_SECONDS = 2.0

/**
 * Net rotation threshold (degrees) over the integration window.
 *
 * A brake stab oscillates around an angular position — pitch dives forward
 * then returns when brakes release — so the integral of gyro_y is ~0.
 *
 * A terrain transition (crest, dip, grade change) is a true rotation —
 * the bike ends up at a new pitch — so the integral is non-trivial.
 *
 * 5° over 2 seconds = a moderate crest/dip; bigger = penalize.
 */
export const BRAKING_GYRO_INTEGRAL_THRESHOLD_DEG = 5.0

/**
 * Penalty factor when gyro_y integral exceeds threshold.
 * 0.0 = full suppression (treat as terrain, not braking).
 * Aggressive because terrain transitions are confidently NOT braking.
 */
export const BRAKING_TERRAIN_TRANSITION_PENALTY = 0.0
