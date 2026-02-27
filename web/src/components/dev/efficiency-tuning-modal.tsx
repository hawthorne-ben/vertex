'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Settings, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { useAuthFetch } from '@/hooks/useAuthFetch'
import { apiCache } from '@/lib/cache/api-cache'
import * as CONSTANTS from '@/lib/analysis/pedaling-efficiency-constants'

interface EfficiencyTuningModalProps {
  isOpen: boolean
  onClose: () => void
  rideId: string
  rideName?: string
}

interface TuningParameters {
  // Stability (cadence-band RMS)
  stabilityBpfLow: number
  stabilityBpfHigh: number
  stabilityRollWeight: number
  stabilityYawWeight: number
  stabilitySurgeWeight: number
  stableThreshold: number
  unstableThreshold: number
  windowSize: number
  maxStabilityRms: number
  maxStabilityRmsPerWatt: number
  powerNormalize: boolean
  // Surface roughness
  hpfCutoff: number
  // Riding position detection
  yAxisThreshold: number
  rollBpfLow: number
  rollBpfHigh: number
  rollRmsThreshold: number
  gyroWeight: number
  accelWeight: number
}

interface RecomputeResult {
  success: boolean
  message: string
  efficiency: {
    metadata: {
      avgStabilityPercent: number | null
      pedalingPercent: number
      stablePercent: number
      unstablePercent: number
      avgCadence: number | null
    }
    sampleCount: number
  }
  position: {
    metadata: {
      standingPercent: number | null
      seatedPercent: number | null
      avgCadenceStanding: number | null
      avgCadenceSeated: number | null
    }
    sampleCount: number
  }
  roughness: {
    metadata: {
      avgRoughness: number
      maxRoughness: number
      smoothSurfacePercent: number
      roughSurfacePercent: number
    }
    sampleCount: number
  }
  computeTime: number
}

const DEFAULT_PARAMS: TuningParameters = {
  stabilityBpfLow: CONSTANTS.STABILITY_BPF_LOW_HZ,
  stabilityBpfHigh: CONSTANTS.STABILITY_BPF_HIGH_HZ,
  stabilityRollWeight: CONSTANTS.STABILITY_ROLL_WEIGHT,
  stabilityYawWeight: CONSTANTS.STABILITY_YAW_WEIGHT,
  stabilitySurgeWeight: CONSTANTS.STABILITY_SURGE_WEIGHT,
  stableThreshold: CONSTANTS.STABLE_THRESHOLD,
  unstableThreshold: CONSTANTS.UNSTABLE_THRESHOLD,
  windowSize: CONSTANTS.STFT_WINDOW_SECONDS,
  maxStabilityRms: CONSTANTS.MAX_STABILITY_RMS,
  maxStabilityRmsPerWatt: CONSTANTS.MAX_STABILITY_RMS_PER_WATT,
  powerNormalize: CONSTANTS.POWER_NORMALIZE_STABILITY,
  hpfCutoff: CONSTANTS.ROUGHNESS_HPF_CUTOFF_HZ,
  yAxisThreshold: CONSTANTS.Y_AXIS_STANDING_THRESHOLD,
  rollBpfLow: CONSTANTS.ROLL_BPF_LOW_HZ,
  rollBpfHigh: CONSTANTS.ROLL_BPF_HIGH_HZ,
  rollRmsThreshold: CONSTANTS.ROLL_RMS_STANDING_THRESHOLD,
  gyroWeight: CONSTANTS.POSITION_GYRO_WEIGHT,
  accelWeight: CONSTANTS.POSITION_ACCEL_WEIGHT,
}

export function EfficiencyTuningModal({
  isOpen,
  onClose,
  rideId,
  rideName
}: EfficiencyTuningModalProps) {
  const [parameters, setParameters] = useState<TuningParameters>({ ...DEFAULT_PARAMS })

  const [saveToDatabase, setSaveToDatabase] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RecomputeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { authFetch } = useAuthFetch()

  if (!isOpen) return null

  const handleRecompute = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await authFetch(`/api/rides/${rideId}/pedaling-efficiency/recompute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parameters: {
            stabilityBpfLow: parameters.stabilityBpfLow,
            stabilityBpfHigh: parameters.stabilityBpfHigh,
            stabilityRollWeight: parameters.stabilityRollWeight,
            stabilityYawWeight: parameters.stabilityYawWeight,
            stabilitySurgeWeight: parameters.stabilitySurgeWeight,
            stableThreshold: parameters.stableThreshold,
            unstableThreshold: parameters.unstableThreshold,
            windowSize: parameters.windowSize,
            maxStabilityRms: parameters.maxStabilityRms,
            maxStabilityRmsPerWatt: parameters.maxStabilityRmsPerWatt,
            powerNormalize: parameters.powerNormalize,
            hpfCutoff: parameters.hpfCutoff,
            yAxisThreshold: parameters.yAxisThreshold,
            rollBpfLow: parameters.rollBpfLow,
            rollBpfHigh: parameters.rollBpfHigh,
            rollRmsThreshold: parameters.rollRmsThreshold,
            gyroWeight: parameters.gyroWeight,
            accelWeight: parameters.accelWeight,
          },
          saveToDatabase,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to recompute efficiency')
      }

      setResult(data)

      // If saved to database, invalidate cache for this ride
      if (saveToDatabase) {
        apiCache.invalidatePattern(rideId)
      }
    } catch (err: any) {
      console.error('Recompute error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setParameters({ ...DEFAULT_PARAMS })
    setResult(null)
    setError(null)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-lg font-medium text-primary">Algorithm Tuning (Stability & Position)</h2>
              {rideName && <p className="text-sm text-secondary">{rideName}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Warning Banner */}
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-yellow-500 mb-1">Development Mode Only</p>
                <p className="text-secondary">
                  This tool recomputes both pedaling stability and riding position with custom parameters.
                  Changes are temporary unless you check &quot;Save to Database&quot; below.
                </p>
              </div>
            </div>
          </div>

          {/* Stability Parameters */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-primary">Pedaling Stability (Cadence-Band RMS)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                label="BPF Low (Hz)"
                value={parameters.stabilityBpfLow}
                onChange={(v) => setParameters({ ...parameters, stabilityBpfLow: v })}
                hint="Low cutoff for stability bandpass. 0.3 Hz catches 18 RPM"
              />
              <FormField
                label="BPF High (Hz)"
                value={parameters.stabilityBpfHigh}
                onChange={(v) => setParameters({ ...parameters, stabilityBpfHigh: v })}
                hint="High cutoff for stability bandpass. 10 Hz captures 5th harmonics"
              />
              <FormField
                label="Roll Weight (gyro-x)"
                value={parameters.stabilityRollWeight}
                onChange={(v) => setParameters({ ...parameters, stabilityRollWeight: v })}
                hint="Frame roll coherence weight. Cleanest signal. Default: 0.7"
              />
              <FormField
                label="Yaw Weight (gyro-z)"
                value={parameters.stabilityYawWeight}
                onChange={(v) => setParameters({ ...parameters, stabilityYawWeight: v })}
                hint="Handlebar stability weight. Synced with roll. Default: 0.3"
              />
              <FormField
                label="Surge Weight (accel-x)"
                value={parameters.stabilitySurgeWeight}
                onChange={(v) => setParameters({ ...parameters, stabilitySurgeWeight: v })}
                hint="Power application weight. Disabled (unit mismatch with gyro). Default: 0.0"
              />
              <FormField
                label="RMS Window (seconds)"
                value={parameters.windowSize}
                onChange={(v) => setParameters({ ...parameters, windowSize: v })}
                hint="Sliding window for RMS calculation. Road: 2-3s. MTB: 3-5s. Default: 3s"
              />
              <FormField
                label="Stable Threshold"
                value={parameters.stableThreshold}
                onChange={(v) => setParameters({ ...parameters, stableThreshold: v })}
                hint="Coherence above this = stable pedaling. Default: 0.7"
              />
              <FormField
                label="Unstable Threshold"
                value={parameters.unstableThreshold}
                onChange={(v) => setParameters({ ...parameters, unstableThreshold: v })}
                hint="Stability below this = unstable pedaling. Default: 0.5"
              />
              <FormField
                label="Max Stability RMS (ceiling)"
                value={parameters.maxStabilityRms}
                onChange={(v) => setParameters({ ...parameters, maxStabilityRms: v })}
                hint="RMS at this value = 0% stability. Lower = stricter. Default: 20.0"
              />
              <FormField
                label="Max Stability RMS/Watt"
                value={parameters.maxStabilityRmsPerWatt}
                onChange={(v) => setParameters({ ...parameters, maxStabilityRmsPerWatt: v })}
                hint="Per-watt ceiling when power normalization is on. Default: 0.02"
              />
              <div className="flex items-center gap-2 p-3 bg-muted rounded-lg md:col-span-2">
                <input
                  type="checkbox"
                  id="powerNormalize"
                  checked={parameters.powerNormalize}
                  onChange={(e) => setParameters({ ...parameters, powerNormalize: e.target.checked })}
                  className="w-4 h-4 rounded border-border"
                />
                <label htmlFor="powerNormalize" className="text-sm text-primary cursor-pointer flex-1">
                  <span className="font-medium">Power Normalization</span>
                  <span className="text-secondary block text-xs mt-0.5">
                    Divide weighted RMS by instantaneous power (watts). Higher-power efforts allowed more motion.
                    Requires power meter data.
                  </span>
                </label>
              </div>
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg md:col-span-2">
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  <strong>Time-Domain RMS (v6):</strong> BPF isolates pedaling band ({parameters.stabilityBpfLow}-{parameters.stabilityBpfHigh} Hz),
                  then RMS of the filtered signal measures oscillation amplitude. Less motion = higher stability.
                  Weighted fusion: roll({parameters.stabilityRollWeight}) +
                  yaw({parameters.stabilityYawWeight}) + surge({parameters.stabilitySurgeWeight}) = {(parameters.stabilityRollWeight + parameters.stabilityYawWeight + parameters.stabilitySurgeWeight).toFixed(1)}.
                  Weights must sum to 1.0. Ceiling: {parameters.maxStabilityRms}.
                </p>
              </div>
            </div>
          </div>

          {/* Surface Roughness */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-primary">Surface Roughness</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                label="HPF Cutoff (Hz)"
                value={parameters.hpfCutoff}
                onChange={(v) => setParameters({ ...parameters, hpfCutoff: v })}
                hint="Removes gravity from accel. Lower = more aggressive. Default: 0.5 Hz"
              />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-primary">Riding Position Detection</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                label="Y-Axis Standing Threshold (m/s²)"
                value={parameters.yAxisThreshold}
                onChange={(v) => setParameters({ ...parameters, yAxisThreshold: v })}
                hint="Lateral rocking threshold. 2.2 = balanced. Lower = more standing detected"
              />
              <FormField
                label="Roll BPF Low Hz"
                value={parameters.rollBpfLow}
                onChange={(v) => setParameters({ ...parameters, rollBpfLow: v })}
                hint="High-pass cutoff for gyro roll. Must pass 0.5 Hz (60 RPM standing)"
              />
              <FormField
                label="Roll BPF High Hz"
                value={parameters.rollBpfHigh}
                onChange={(v) => setParameters({ ...parameters, rollBpfHigh: v })}
                hint="Low-pass cutoff for gyro roll. Rejects road vibration above cadence"
              />
              <FormField
                label="Roll RMS Threshold (rad/s)"
                value={parameters.rollRmsThreshold}
                onChange={(v) => setParameters({ ...parameters, rollRmsThreshold: v })}
                hint="Gyro roll rate RMS threshold for standing. 2.5 = default"
              />
              <FormField
                label="Gyro Weight"
                value={parameters.gyroWeight}
                onChange={(v) => setParameters({ ...parameters, gyroWeight: v })}
                hint="Weight for gyro roll signal (0 = disabled, 1 = gyro only)"
              />
              <FormField
                label="Accel Weight"
                value={parameters.accelWeight}
                onChange={(v) => setParameters({ ...parameters, accelWeight: v })}
                hint="Weight for accel Y-axis signal (0 = disabled, 1 = accel only)"
              />
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg md:col-span-2">
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  <strong>Weighted Fusion:</strong> Each signal is normalized to 0–1 against its threshold,
                  then combined: score = accelWeight × (yStdDev/yThreshold) + gyroWeight × (rollRms/rollThreshold).
                  Standing if score ≥ 1.0. Set gyroWeight=0 for accel-only (v3 behavior).
                </p>
              </div>
            </div>
          </div>

          {/* Display-only constants (FYI) */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-primary">Algorithm Info</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InfoField label="Cadence Source" value="FIT sensor (cadence > 0 = pedaling)" />
              <InfoField label="Algorithm Version" value={CONSTANTS.ALGORITHM_VERSION} />
              <InfoField label="Method" value="Time-domain RMS of BPF'd signal" />
              <InfoField label="Output Rate" value={`${(1 / CONSTANTS.STFT_HOP_SECONDS).toFixed(0)} Hz (interpolated to 25 Hz)`} />
            </div>
          </div>

          {/* Result Display */}
          {result && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
              <div className="flex gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm space-y-3 flex-1">
                  <p className="font-medium text-green-500">{result.message}</p>

                  {/* Stability Results */}
                  <div>
                    <p className="font-medium text-primary mb-2">Pedaling Stability</p>
                    <div className="grid grid-cols-2 gap-2 text-secondary">
                      <div>Avg Stability: <span className="text-primary font-medium">{result.efficiency.metadata.avgStabilityPercent?.toFixed(1)}%</span></div>
                      <div>Pedaling Time: <span className="text-primary font-medium">{result.efficiency.metadata.pedalingPercent.toFixed(1)}%</span></div>
                      <div>Stable: <span className="text-primary font-medium">{result.efficiency.metadata.stablePercent.toFixed(1)}%</span></div>
                      <div>Unstable: <span className="text-primary font-medium">{result.efficiency.metadata.unstablePercent.toFixed(1)}%</span></div>
                      <div>Avg Cadence: <span className="text-primary font-medium">{result.efficiency.metadata.avgCadence?.toFixed(0) || 'N/A'} RPM</span></div>
                      <div>Sample Count: <span className="text-primary font-medium">{result.efficiency.sampleCount.toLocaleString()}</span></div>
                    </div>
                  </div>

                  {/* Position Results */}
                  <div className="pt-3 border-t border-green-500/20">
                    <p className="font-medium text-primary mb-2">Riding Position</p>
                    <div className="grid grid-cols-2 gap-2 text-secondary">
                      <div>Time Standing: <span className="text-primary font-medium">{result.position.metadata.standingPercent?.toFixed(1) || 'N/A'}%</span></div>
                      <div>Time Seated: <span className="text-primary font-medium">{result.position.metadata.seatedPercent?.toFixed(1) || 'N/A'}%</span></div>
                      <div>Avg Cadence (Standing): <span className="text-primary font-medium">{result.position.metadata.avgCadenceStanding?.toFixed(0) || 'N/A'} RPM</span></div>
                      <div>Avg Cadence (Seated): <span className="text-primary font-medium">{result.position.metadata.avgCadenceSeated?.toFixed(0) || 'N/A'} RPM</span></div>
                      <div className="col-span-2">Sample Count: <span className="text-primary font-medium">{result.position.sampleCount.toLocaleString()}</span></div>
                    </div>
                  </div>

                  {/* Roughness Results */}
                  <div className="pt-3 border-t border-green-500/20">
                    <p className="font-medium text-primary mb-2">Surface Roughness</p>
                    <div className="grid grid-cols-2 gap-2 text-secondary">
                      <div>Avg Roughness: <span className="text-primary font-medium">{(result.roughness.metadata.avgRoughness * 100).toFixed(1)}%</span></div>
                      <div>Max Roughness: <span className="text-primary font-medium">{(result.roughness.metadata.maxRoughness * 100).toFixed(1)}%</span></div>
                      <div>Smooth Surface: <span className="text-primary font-medium">{result.roughness.metadata.smoothSurfacePercent.toFixed(1)}%</span></div>
                      <div>Rough Surface: <span className="text-primary font-medium">{result.roughness.metadata.roughSurfacePercent.toFixed(1)}%</span></div>
                      <div className="col-span-2">Sample Count: <span className="text-primary font-medium">{result.roughness.sampleCount.toLocaleString()}</span></div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-green-500/20">
                    <div>Compute Time: <span className="text-primary font-medium">{result.computeTime}ms</span></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <div className="flex gap-3">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-red-500 mb-1">Computation Failed</p>
                  <p className="text-secondary">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Save Option */}
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg border border-border">
            <input
              type="checkbox"
              id="saveToDatabase"
              checked={saveToDatabase}
              onChange={(e) => setSaveToDatabase(e.target.checked)}
              className="w-4 h-4 rounded border-border"
            />
            <label htmlFor="saveToDatabase" className="text-sm text-primary cursor-pointer flex-1">
              <span className="font-medium">Save to Database</span>
              <span className="text-secondary block text-xs mt-0.5">
                Overwrites existing analyses (both efficiency and position). Charts will update immediately.
              </span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-card border-t border-border p-4 flex items-center justify-between gap-3">
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm text-secondary hover:text-primary transition-colors"
            disabled={loading}
          >
            Reset to Defaults
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-secondary hover:text-primary transition-colors"
              disabled={loading}
            >
              Close
            </button>
            <button
              onClick={handleRecompute}
              disabled={loading}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Computing...' : 'Recompute Both Metrics'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Helper Components

interface FormFieldProps {
  label: string
  value: number
  onChange: (value: number) => void
  hint?: string
}

function FormField({ label, value, onChange, hint }: FormFieldProps) {
  const [draft, setDraft] = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync draft when value changes externally (e.g. reset)
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setDraft(String(value))
    }
  }, [value])

  const commit = () => {
    const parsed = parseFloat(draft)
    if (!isNaN(parsed)) {
      onChange(parsed)
    } else {
      setDraft(String(value))
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-primary">{label}</label>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
      {hint && <p className="text-xs text-secondary">{hint}</p>}
    </div>
  )
}

interface InfoFieldProps {
  label: string
  value: string
}

function InfoField({ label, value }: InfoFieldProps) {
  return (
    <div className="p-3 bg-muted rounded-lg">
      <p className="text-xs text-secondary">{label}</p>
      <p className="text-sm font-medium text-primary mt-0.5">{value}</p>
    </div>
  )
}
