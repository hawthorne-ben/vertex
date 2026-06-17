'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface RideRow {
  id: string
  name: string
  startTime: string
  status: string
  algorithmVersion: string | null
  currentVersion: string
  isStale: boolean
  completedAt: string | null
}

interface RecomputeSummary {
  currentVersion: string
  rides: RideRow[]
  staleCount: number
  totalCount: number
}

function statusBadge(row: RideRow) {
  if (row.status === 'not_started') return <Badge variant="secondary">no analysis</Badge>
  if (row.isStale) return <Badge variant="destructive">stale ({row.algorithmVersion ?? '—'})</Badge>
  if (row.status === 'processing' || row.status === 'pending') return <Badge variant="secondary">running</Badge>
  if (row.status === 'failed') return <Badge variant="destructive">failed</Badge>
  return <Badge variant="default">current</Badge>
}

export function AdminTab() {
  const [summary, setSummary] = useState<RecomputeSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [triggering, setTriggering] = useState(false)
  const [result, setResult] = useState<{ triggered: number; message?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/recompute')
      if (!res.ok) throw new Error(await res.text())
      setSummary(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const trigger = async (payload: object) => {
    setTriggering(true)
    setResult(null)
    setError(null)
    try {
      const res = await fetch('/api/admin/recompute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setResult(data)
      setSelected(new Set())
      setTimeout(load, 1500)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setTriggering(false)
    }
  }

  const toggleSelect = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const toggleAll = () => {
    if (!summary) return
    setSelected(
      selected.size === summary.rides.length
        ? new Set()
        : new Set(summary.rides.map(r => r.id))
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-serif">Algorithm Version</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-secondary">Deployed version</span>
            <code className="px-2 py-0.5 bg-muted rounded text-xs font-mono">
              {summary?.currentVersion ?? '—'}
            </code>
          </div>
          {summary && (
            <p className="text-sm text-secondary">
              {summary.staleCount === 0
                ? `All ${summary.totalCount} rides are current.`
                : `${summary.staleCount} of ${summary.totalCount} rides were computed with an older version.`}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-serif">Recompute</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={triggering || !summary || summary.staleCount === 0}
              onClick={() => trigger({ stale: true })}
            >
              Recompute stale ({summary?.staleCount ?? 0})
            </Button>
            <Button
              variant="outline"
              disabled={triggering || !summary || summary.totalCount === 0}
              onClick={() => trigger({ all: true })}
            >
              Recompute all ({summary?.totalCount ?? 0})
            </Button>
            <Button
              variant="outline"
              disabled={triggering || selected.size === 0}
              onClick={() => trigger({ rideIds: Array.from(selected) })}
            >
              Recompute selected ({selected.size})
            </Button>
            <Button variant="ghost" onClick={load} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </Button>
          </div>
          {result && (
            <p className="text-sm text-success">
              {result.message ?? `Triggered ${result.triggered} ride${result.triggered !== 1 ? 's' : ''}.`}
            </p>
          )}
          {error && <p className="text-sm text-error">{error}</p>}
        </CardContent>
      </Card>

      {summary && summary.rides.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="p-3 text-left w-8">
                    <input
                      type="checkbox"
                      checked={selected.size === summary.rides.length && summary.rides.length > 0}
                      onChange={toggleAll}
                      className="cursor-pointer"
                    />
                  </th>
                  <th className="p-3 text-left font-medium">Ride</th>
                  <th className="p-3 text-left font-medium">Date</th>
                  <th className="p-3 text-left font-medium">Status</th>
                  <th className="p-3 text-left font-medium">Computed</th>
                  <th className="p-3 text-left w-24"></th>
                </tr>
              </thead>
              <tbody>
                {summary.rides.map(row => (
                  <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleSelect(row.id)}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="p-3 font-medium">{row.name}</td>
                    <td className="p-3 text-secondary">
                      {new Date(row.startTime).toLocaleDateString()}
                    </td>
                    <td className="p-3">{statusBadge(row)}</td>
                    <td className="p-3 text-secondary">
                      {row.completedAt ? new Date(row.completedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="p-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={triggering}
                        onClick={() => trigger({ rideIds: [row.id] })}
                      >
                        Recompute
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {summary && summary.rides.length === 0 && (
        <p className="text-sm text-secondary">No rides with merged VTX data found.</p>
      )}
    </div>
  )
}
