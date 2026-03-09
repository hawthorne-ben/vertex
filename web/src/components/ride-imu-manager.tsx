'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { AddVtxDataButton } from '@/components/add-vtx-data-button'
import { Loader2, Trash2, RotateCcw, AlertTriangle } from 'lucide-react'
import { useToast } from '@/components/ui/toast-context'
import { formatDurationFromMilliseconds } from '@/lib/utils/formatting'

interface VtxRecording {
  id: string
  filename: string
  start_time: string
  end_time: string
  duration_ms: number
  file_size_bytes: number
}

interface RideImuManagerProps {
  rideId: string
  vtxRecordings: VtxRecording[]
}

export function RideImuManager({ rideId, vtxRecordings }: RideImuManagerProps) {
  const [resetting, setResetting] = useState(false)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const { addToast } = useToast()

  const handleReset = async () => {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }

    setResetting(true)
    try {
      const response = await fetch(`/api/rides/${rideId}/reset`, {
        method: 'POST',
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error)

      addToast({
        type: 'success',
        title: 'IMU data reset',
        message: 'All IMU data and analysis removed from this ride',
      })

      window.location.reload()
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Reset failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setResetting(false)
      setConfirmReset(false)
    }
  }

  const handleReanalyze = async () => {
    setReanalyzing(true)
    try {
      const response = await fetch(`/api/rides/${rideId}/reanalyze`, {
        method: 'POST',
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error)

      addToast({
        type: 'success',
        title: 'Reanalysis triggered',
        message: 'Analysis job has been queued. Results will appear shortly.',
      })
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Reanalysis failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setReanalyzing(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  if (vtxRecordings.length === 0) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Vertex IMU Data</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">No IMU data associated with this ride yet.</p>
          <AddVtxDataButton rideId={rideId} />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Vertex IMU Data</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Associated recordings */}
        <div className="space-y-2 mb-4">
          {vtxRecordings.map((rec) => (
            <div
              key={rec.id}
              className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/50"
            >
              <div>
                <div className="font-medium text-sm text-primary">{rec.filename}</div>
                <div className="text-xs text-secondary">
                  {formatDate(rec.start_time)} · {formatDurationFromMilliseconds(rec.duration_ms)} · {formatFileSize(rec.file_size_bytes)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReanalyze}
            disabled={reanalyzing || resetting}
          >
            {reanalyzing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" />
            )}
            Reanalyze
          </Button>
          <Button
            variant={confirmReset ? 'destructive' : 'outline'}
            size="sm"
            onClick={handleReset}
            onBlur={() => setConfirmReset(false)}
            disabled={resetting || reanalyzing}
          >
            {resetting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : confirmReset ? (
              <AlertTriangle className="h-4 w-4 mr-2" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            {confirmReset ? 'Confirm Remove All' : 'Remove IMU Data'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
