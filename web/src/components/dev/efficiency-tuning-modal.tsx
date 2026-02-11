'use client'

import { useState } from 'react'
import { X, Settings, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { useAuthFetch } from '@/hooks/useAuthFetch'
import * as CONSTANTS from '@/lib/analysis/pedaling-efficiency-constants'

interface EfficiencyTuningModalProps {
  isOpen: boolean
  onClose: () => void
  rideId: string
  rideName?: string
}

interface TuningParameters {
  hpfCutoff: number
  windowSize: number
  fftWindowSize: number
  confidenceThreshold: number
  minCadence: number
  maxCadence: number
  useMagnitude: boolean
}

interface RecomputeResult {
  success: boolean
  message: string
  metadata: {
    avgEfficiencyPercent: number | null
    pedalingPercent: number
    smoothPercent: number
    roughPercent: number
    avgConfidence: number
    avgDetectedCadence: number | null
  }
  sampleCount: number
  computeTime: number
}

export function EfficiencyTuningModal({
  isOpen,
  onClose,
  rideId,
  rideName
}: EfficiencyTuningModalProps) {
  const [parameters, setParameters] = useState<TuningParameters>({
    hpfCutoff: CONSTANTS.HPF_CUTOFF_HZ,
    windowSize: CONSTANTS.EFFICIENCY_WINDOW_SECONDS,
    fftWindowSize: CONSTANTS.FFT_WINDOW_SECONDS,
    confidenceThreshold: CONSTANTS.CONFIDENCE_THRESHOLD,
    minCadence: CONSTANTS.MIN_CADENCE_RPM,
    maxCadence: CONSTANTS.MAX_CADENCE_RPM,
    useMagnitude: CONSTANTS.USE_MAGNITUDE,
  })

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
            hpfCutoff: parameters.hpfCutoff,
            windowSize: parameters.windowSize,
            fftWindowSize: parameters.fftWindowSize,
            confidenceThreshold: parameters.confidenceThreshold,
            minCadence: parameters.minCadence,
            maxCadence: parameters.maxCadence,
            useMagnitude: parameters.useMagnitude,
          },
          saveToDatabase,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to recompute efficiency')
      }

      setResult(data)
    } catch (err: any) {
      console.error('Recompute error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setParameters({
      hpfCutoff: CONSTANTS.HPF_CUTOFF_HZ,
      windowSize: CONSTANTS.EFFICIENCY_WINDOW_SECONDS,
      fftWindowSize: CONSTANTS.FFT_WINDOW_SECONDS,
      confidenceThreshold: CONSTANTS.CONFIDENCE_THRESHOLD,
      minCadence: CONSTANTS.MIN_CADENCE_RPM,
      maxCadence: CONSTANTS.MAX_CADENCE_RPM,
      useMagnitude: CONSTANTS.USE_MAGNITUDE,
    })
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
              <h2 className="text-lg font-medium text-primary">Efficiency Algorithm Tuning</h2>
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
                  This tool allows you to experiment with algorithm parameters. Changes are temporary
                  unless you check &quot;Save to Database&quot; below.
                </p>
              </div>
            </div>
          </div>

          {/* Road Bike Preset Suggestion */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <div className="flex gap-3">
              <Settings className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-blue-500 mb-2">Suggested Settings for Road Bike</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-secondary">
                  <div>HPF Cutoff: <span className="text-primary font-medium">0.3-0.4 Hz</span></div>
                  <div>FFT Window: <span className="text-primary font-medium">6-8 seconds</span></div>
                  <div>Confidence: <span className="text-primary font-medium">0.20-0.30</span></div>
                  <div>Use Magnitude: <span className="text-primary font-medium">true</span></div>
                </div>
                <p className="text-xs text-secondary mt-2">
                  Road bikes have cleaner pedaling signals. Lower HPF = preserve more signal.
                  Higher confidence = stricter detection.
                </p>
              </div>
            </div>
          </div>

          {/* Parameters Grid */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-primary">Signal Processing</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                label="High-Pass Filter Cutoff (Hz)"
                value={parameters.hpfCutoff}
                onChange={(v) => setParameters({ ...parameters, hpfCutoff: v })}
                min={0.1}
                max={2.0}
                step={0.1}
                hint="Road: 0.3-0.4 Hz. MTB: 0.5-0.6 Hz. Lower = more signal"
              />
              <FormField
                label="Efficiency Window (seconds)"
                value={parameters.windowSize}
                onChange={(v) => setParameters({ ...parameters, windowSize: v })}
                min={1}
                max={10}
                step={0.5}
                hint="Smoothness window. Road: 2-3s. MTB: 3-5s"
              />
              <FormField
                label="FFT Window (seconds)"
                value={parameters.fftWindowSize}
                onChange={(v) => setParameters({ ...parameters, fftWindowSize: v })}
                min={5}
                max={20}
                step={1}
                hint="Cadence detection. Road: 6-8s. MTB: 10-12s"
              />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-primary">Pedaling Detection</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                label="Confidence Threshold"
                value={parameters.confidenceThreshold}
                onChange={(v) => setParameters({ ...parameters, confidenceThreshold: v })}
                min={0.05}
                max={0.5}
                step={0.05}
                hint="Road: 0.20-0.30 (strict). MTB: 0.10-0.15 (loose)"
              />
              <FormField
                label="Min Cadence (RPM)"
                value={parameters.minCadence}
                onChange={(v) => setParameters({ ...parameters, minCadence: v })}
                min={20}
                max={60}
                step={5}
                hint="Minimum reasonable cadence"
              />
              <FormField
                label="Max Cadence (RPM)"
                value={parameters.maxCadence}
                onChange={(v) => setParameters({ ...parameters, maxCadence: v })}
                min={100}
                max={180}
                step={5}
                hint="Maximum reasonable cadence"
              />
              <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                <input
                  type="checkbox"
                  id="useMagnitude"
                  checked={parameters.useMagnitude}
                  onChange={(e) => setParameters({ ...parameters, useMagnitude: e.target.checked })}
                  className="w-4 h-4 rounded border-border"
                />
                <label htmlFor="useMagnitude" className="text-sm text-primary cursor-pointer">
                  Use 3-axis magnitude
                </label>
              </div>
            </div>
          </div>

          {/* Display-only constants (FYI) */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-primary">Current Algorithm Constants (FYI)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InfoField label="Stationary Threshold" value={`${CONSTANTS.STATIONARY_THRESHOLD} m/s²`} />
              <InfoField label="Method 1 Peak Ratio" value={`${CONSTANTS.METHOD_1_PEAK_TO_MEDIAN} (road)`} />
              <InfoField label="Method 2 Peak Ratio" value={`${CONSTANTS.METHOD_2_PEAK_TO_MEDIAN} (mtb)`} />
              <InfoField label="Method 3 Peak Ratio" value={`${CONSTANTS.METHOD_3_PEAK_TO_MEDIAN} (rough)`} />
              <InfoField label="Decay Constant (k)" value={`${CONSTANTS.EFFICIENCY_DECAY_CONSTANT}`} />
              <InfoField label="Rescale Range" value={`${CONSTANTS.RESCALE_MIN * 100}%-${CONSTANTS.RESCALE_MAX * 100}%`} />
            </div>
            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-xs text-blue-700 dark:text-blue-400">
                <strong>Note:</strong> Method-specific thresholds and preprocessing filters (bandpass, notch, etc.)
                require code changes in pedaling-efficiency-constants.ts. These parameters control the basic
                signal processing and detection windows.
              </p>
            </div>
          </div>

          {/* Result Display */}
          {result && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
              <div className="flex gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm space-y-2 flex-1">
                  <p className="font-medium text-green-500">{result.message}</p>
                  <div className="grid grid-cols-2 gap-2 text-secondary">
                    <div>Avg Efficiency: <span className="text-primary font-medium">{result.metadata.avgEfficiencyPercent?.toFixed(1)}%</span></div>
                    <div>Pedaling Time: <span className="text-primary font-medium">{result.metadata.pedalingPercent.toFixed(1)}%</span></div>
                    <div>Smooth: <span className="text-primary font-medium">{result.metadata.smoothPercent.toFixed(1)}%</span></div>
                    <div>Rough: <span className="text-primary font-medium">{result.metadata.roughPercent.toFixed(1)}%</span></div>
                    <div>Avg Confidence: <span className="text-primary font-medium">{result.metadata.avgConfidence.toFixed(2)}</span></div>
                    <div>Avg Cadence: <span className="text-primary font-medium">{result.metadata.avgDetectedCadence?.toFixed(0) || 'N/A'} RPM</span></div>
                    <div className="col-span-2">Compute Time: <span className="text-primary font-medium">{result.computeTime}ms</span></div>
                    <div className="col-span-2">Sample Count: <span className="text-primary font-medium">{result.sampleCount.toLocaleString()}</span></div>
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
                Overwrites existing analysis. Chart will update immediately.
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
              {loading ? 'Computing...' : 'Recompute Efficiency'}
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
  min: number
  max: number
  step: number
  hint?: string
}

function FormField({ label, value, onChange, min, max, step, hint }: FormFieldProps) {
  // Ensure value is a valid number
  const displayValue = isNaN(value) ? min : value

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-primary">{label}</label>
      <input
        type="number"
        value={displayValue}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value)
          onChange(isNaN(parsed) ? min : parsed)
        }}
        min={min}
        max={max}
        step={step}
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
