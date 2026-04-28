'use client'

import { useState, useCallback } from 'react'
import type { FilterDefinition, FilterAxis } from './hooks/useFilteredStreams'
import type { IMUDataType } from './hooks/useIMUData'

interface FilterWorkbenchProps {
  dataType: IMUDataType
  /** Duration of visible time range in seconds. Workbench disabled if > 600. */
  visibleDurationSeconds: number | null
  activeFilters: FilterDefinition[]
  onFiltersChange: (filters: FilterDefinition[]) => void
  loading?: boolean
  error?: string | null
}

const selectClass = 'px-2 py-1.5 rounded-md text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary'
const inputClass = 'w-20 px-2 py-1.5 rounded-md text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary tabular-nums'
const btnClass = 'px-3 py-1.5 rounded-md text-sm font-medium transition-colors'
const btnPrimary = `${btnClass} bg-primary text-primary-foreground hover:bg-primary/90`
const btnGhost = `${btnClass} text-muted-foreground hover:text-foreground hover:bg-muted`

const ACCEL_AXES: FilterAxis[] = ['accel_x', 'accel_y', 'accel_z']
const GYRO_AXES: FilterAxis[] = ['gyro_x', 'gyro_y', 'gyro_z']

function axesForDataType(dt: IMUDataType): FilterAxis[] {
  return dt === 'gyro' ? GYRO_AXES : ACCEL_AXES
}

function axisLabel(axis: FilterAxis): string {
  return axis.endsWith('_x') ? 'X' : axis.endsWith('_y') ? 'Y' : 'Z'
}

function filterSummary(def: FilterDefinition): string {
  const phaseTag = def.phase === 'causal' ? ', causal' : ''
  const axes = def.axes.map(axisLabel).join(', ')
  switch (def.type) {
    case 'lpf': return `LPF ${def.cutoffHz} Hz on ${axes}${phaseTag}`
    case 'hpf': return `HPF ${def.cutoffHz} Hz on ${axes}${phaseTag}`
    case 'bpf': return `BPF ${def.cutoffLowHz}-${def.cutoffHz} Hz on ${axes}${phaseTag}`
  }
}

let nextId = 1

export function FilterWorkbench({
  dataType,
  visibleDurationSeconds,
  activeFilters,
  onFiltersChange,
  loading = false,
  error = null,
}: FilterWorkbenchProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [filterType, setFilterType] = useState<'lpf' | 'hpf' | 'bpf'>('lpf')
  const [cutoffHz, setCutoffHz] = useState('5')
  const [cutoffLowHz, setCutoffLowHz] = useState('0.3')
  const [phase, setPhase] = useState<'zero' | 'causal'>('zero')
  const [selectedAxes, setSelectedAxes] = useState<Set<FilterAxis>>(
    new Set(axesForDataType(dataType))
  )

  const availableAxes = axesForDataType(dataType)
  const tooLong = visibleDurationSeconds !== null && visibleDurationSeconds > 600
  const disabled = tooLong || dataType === 'orientation'

  const toggleAxis = useCallback((axis: FilterAxis) => {
    setSelectedAxes(prev => {
      const next = new Set(prev)
      if (next.has(axis)) next.delete(axis)
      else next.add(axis)
      return next
    })
  }, [])

  const handleApply = useCallback(() => {
    const axes = availableAxes.filter(a => selectedAxes.has(a))
    if (axes.length === 0) return

    const cutoff = parseFloat(cutoffHz)
    if (!cutoff || cutoff <= 0) return

    const def: FilterDefinition = {
      id: `filter-${nextId++}`,
      type: filterType,
      cutoffHz: cutoff,
      phase,
      axes,
    }

    if (filterType === 'bpf') {
      const low = parseFloat(cutoffLowHz)
      if (!low || low <= 0 || low >= cutoff) return
      def.cutoffLowHz = low
    }

    onFiltersChange([...activeFilters, def])
  }, [availableAxes, selectedAxes, cutoffHz, cutoffLowHz, filterType, phase, activeFilters, onFiltersChange])

  const removeFilter = useCallback((id: string) => {
    onFiltersChange(activeFilters.filter(f => f.id !== id))
  }, [activeFilters, onFiltersChange])

  const clearAll = useCallback(() => {
    onFiltersChange([])
  }, [onFiltersChange])

  return (
    <div className="border border-border rounded-lg bg-card text-sm">
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setIsOpen(p => !p)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/50 transition-colors rounded-lg"
      >
        <span className="font-medium text-foreground flex items-center gap-2">
          Filter Workbench
          {activeFilters.length > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
              {activeFilters.length}
            </span>
          )}
          {loading && (
            <span className="text-xs text-muted-foreground animate-pulse">loading...</span>
          )}
        </span>
        <svg
          className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Body — collapsible */}
      {isOpen && (
        <div className="px-4 pb-4 space-y-3 border-t border-border">
          {disabled && (
            <p className="text-xs text-muted-foreground pt-3">
              {dataType === 'orientation'
                ? 'Filters are not available for orientation data. Switch to accelerometer or gyroscope.'
                : 'Zoom into 10 minutes or less to enable filtering on full-resolution data.'}
            </p>
          )}

          {error && (
            <p className="text-xs text-destructive pt-3">
              Failed to load full-resolution data: {error}
            </p>
          )}

          {!disabled && (
            <>
              {/* Config row */}
              <div className="flex flex-wrap items-end gap-3 pt-3">
                {/* Type */}
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Type</label>
                  <select
                    value={filterType}
                    onChange={e => setFilterType(e.target.value as 'lpf' | 'hpf' | 'bpf')}
                    className={selectClass}
                  >
                    <option value="lpf">Low Pass</option>
                    <option value="hpf">High Pass</option>
                    <option value="bpf">Band Pass</option>
                  </select>
                </div>

                {/* Cutoff(s) */}
                {filterType === 'bpf' && (
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Low (Hz)</label>
                    <input
                      type="number"
                      min="0.01"
                      step="0.1"
                      value={cutoffLowHz}
                      onChange={e => setCutoffLowHz(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">
                    {filterType === 'bpf' ? 'High (Hz)' : 'Cutoff (Hz)'}
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.1"
                    value={cutoffHz}
                    onChange={e => setCutoffHz(e.target.value)}
                    className={inputClass}
                  />
                </div>

                {/* Phase */}
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Phase</label>
                  <select
                    value={phase}
                    onChange={e => setPhase(e.target.value as 'zero' | 'causal')}
                    className={selectClass}
                  >
                    <option value="zero">Zero-phase</option>
                    <option value="causal">Causal</option>
                  </select>
                </div>

                {/* Axes */}
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Axes</label>
                  <div className="flex items-center gap-2 py-1.5">
                    {availableAxes.map(axis => (
                      <label key={axis} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedAxes.has(axis)}
                          onChange={() => toggleAxis(axis)}
                          className="rounded border-border"
                        />
                        <span className="text-foreground">{axisLabel(axis)}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Apply */}
                <button type="button" onClick={handleApply} className={btnPrimary}>
                  Apply
                </button>
              </div>

              {/* Active filters */}
              {activeFilters.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {activeFilters.map(f => (
                    <span
                      key={f.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-xs text-foreground"
                    >
                      {filterSummary(f)}
                      <button
                        type="button"
                        onClick={() => removeFilter(f.id)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                  <button type="button" onClick={clearAll} className={btnGhost}>
                    Clear all
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
