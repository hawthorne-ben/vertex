import { Loader2 } from 'lucide-react'

export default function Loading() {
  return (
    <div className="container mx-auto px-4 md:px-6 py-8 max-w-7xl">
      {/* Header Skeleton */}
      <div className="mb-8 animate-pulse">
        <div className="h-8 bg-muted rounded w-64 mb-2"></div>
        <div className="flex items-center gap-6">
          <div className="h-4 bg-muted rounded w-24"></div>
          <div className="h-4 bg-muted rounded w-16"></div>
          <div className="h-4 bg-muted rounded w-20"></div>
          <div className="h-6 bg-muted rounded-full w-16"></div>
        </div>
        <div className="h-3 bg-muted rounded w-48 mt-2"></div>
      </div>

      {/* Chart Loading */}
      <div className="space-y-6">
        {/* Selector Buttons Skeleton */}
        <div className="flex gap-2">
          <div className="h-10 bg-muted rounded-md w-32 animate-pulse"></div>
          <div className="h-10 bg-muted rounded-md w-28 animate-pulse"></div>
          <div className="h-10 bg-muted rounded-md w-32 animate-pulse"></div>
        </div>

        {/* Chart Container */}
        <div className="border border-border rounded-lg p-6 bg-card">
          <div className="h-6 bg-muted rounded w-48 mb-4 animate-pulse"></div>
          
          {/* Chart Area with Centered Spinner */}
          <div className="w-full h-[400px] flex items-center justify-center bg-muted/30 rounded">
            <div className="text-center">
              <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Loading chart data...</p>
            </div>
          </div>
        </div>

        {/* Stats Skeleton */}
        <div className="grid grid-cols-3 gap-4">
          <div className="h-24 bg-muted rounded-lg animate-pulse"></div>
          <div className="h-24 bg-muted rounded-lg animate-pulse"></div>
          <div className="h-24 bg-muted rounded-lg animate-pulse"></div>
        </div>

        {/* Info Box Skeleton */}
        <div className="h-20 bg-muted rounded-lg animate-pulse"></div>
      </div>
    </div>
  )
}

