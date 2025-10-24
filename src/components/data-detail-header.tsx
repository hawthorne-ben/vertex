'use client'

interface DataDetailHeaderProps {
  startTime: string
  endTime: string
  sampleCount: number | null
  sampleRate: number | null
  status: string
  filename: string | null
}

export function DataDetailHeader({
  startTime,
  endTime,
  sampleCount,
  sampleRate,
  status,
  filename
}: DataDetailHeaderProps) {
  const duration = ((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000).toFixed(1)

  return (
    <div className="mb-8">
      <h1 className="text-3xl font-normal text-primary mb-2">
        {new Date(startTime).toLocaleString(undefined, { 
          month: 'short', 
          day: 'numeric', 
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        })}
        {' → '}
        {new Date(endTime).toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        })}
      </h1>
      
      {/* Metadata */}
      <div className="flex items-center gap-6 text-sm text-secondary">
        {sampleCount && (
          <span>{sampleCount.toLocaleString()} samples</span>
        )}
        {sampleRate && (
          <span>{sampleRate} Hz</span>
        )}
        <span>{duration}s</span>
        <span className={`
          px-2 py-1 rounded-full text-xs
          ${status === 'ready' ? 'status-badge-success' : ''}
          ${status === 'parsing' ? 'status-badge-info' : ''}
          ${status === 'error' ? 'status-badge-error' : ''}
          ${status === 'uploaded' ? 'bg-muted text-muted-foreground' : ''}
        `}>
          {status}
        </span>
      </div>

      {filename && (
        <p className="text-xs text-secondary mt-2">
          Source: {filename}
        </p>
      )}
    </div>
  )
}

