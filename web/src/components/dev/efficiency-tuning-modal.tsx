'use client'

import { useState } from 'react'
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
  hpfCutoff: number
  windowSize: number
  yAxisThreshold: number
}

interface RecomputeResult {
  success: boolean
  message: string
  efficiency: {
    metadata: {
      avgEfficiencyPercent: number | null
      pedalingPercent: number
      smoothPercent: number
      roughPercent: number
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
    yAxisThreshold: CONSTANTS.Y_AXIS_STANDING_THRESHOLD,
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
            yAxisThreshold: parameters.yAxisThreshold,
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
    setParameters({
      hpfCutoff: CONSTANTS.HPF_CUTOFF_HZ,
      windowSize: CONSTANTS.EFFICIENCY_WINDOW_SECONDS,
      yAxisThreshold: CONSTANTS.Y_AXIS_STANDING_THRESHOLD,
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
              <h2 className="text-lg font-medium text-primary">Algorithm Tuning (Efficiency & Position)</h2>
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
                  This tool recomputes both pedaling efficiency and riding position with custom parameters.
                  Changes are temporary unless you check &quot;Save to Database&quot; below.
                </p>
              </div>
            </div>
          </div>

          {/* Parameters Grid */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-primary">Signal Processing</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                label="HPF Cutoff (Hz)"
                value={parameters.hpfCutoff}
                onChange={(v) => setParameters({ ...parameters, hpfCutoff: v })}
                min={0.1}
                max={1.0}
                step={0.1}
                hint="Removes gravity. Lower = more aggressive. Default: 0.5 Hz"
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
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-primary">Riding Position Detection</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                label="Y-Axis Standing Threshold (m/s²)"
                value={parameters.yAxisThreshold}
                onChange={(v) => setParameters({ ...parameters, yAxisThreshold: v })}
                min={1.0}
                max={5.0}
                step={0.1}
                hint="Lateral rocking threshold. 2.5 = balanced. Lower = more standing detected"
              />
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  <strong>Standing Detection:</strong> Y-axis stddev ≥ threshold = standing.
                  Most seated riding is &lt; 2.0 m/s². Aggressive climbing: 2.5-4.0 m/s².
                </p>
              </div>
            </div>
          </div>

          {/* Display-only constants (FYI) */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-primary">Current Algorithm Constants (FYI)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InfoField label="Cadence Source" value="FIT sensor (cadence > 0 = pedaling)" />
              <InfoField label="Decay Constant (k)" value={`${CONSTANTS.EFFICIENCY_DECAY_CONSTANT}`} />
              <InfoField label="Algorithm Version" value={CONSTANTS.ALGORITHM_VERSION} />
            </div>
          </div>

          {/* Result Display */}
          {result && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
              <div className="flex gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm space-y-3 flex-1">
                  <p className="font-medium text-green-500">{result.message}</p>

                  {/* Efficiency Results */}
                  <div>
                    <p className="font-medium text-primary mb-2">Pedaling Efficiency</p>
                    <div className="grid grid-cols-2 gap-2 text-secondary">
                      <div>Avg Efficiency: <span className="text-primary font-medium">{result.efficiency.metadata.avgEfficiencyPercent?.toFixed(1)}%</span></div>
                      <div>Pedaling Time: <span className="text-primary font-medium">{result.efficiency.metadata.pedalingPercent.toFixed(1)}%</span></div>
                      <div>Smooth: <span className="text-primary font-medium">{result.efficiency.metadata.smoothPercent.toFixed(1)}%</span></div>
                      <div>Rough: <span className="text-primary font-medium">{result.efficiency.metadata.roughPercent.toFixed(1)}%</span></div>
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
