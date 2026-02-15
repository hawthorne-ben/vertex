'use client'

import { Download, Trash2 } from 'lucide-react'

interface RidesHeaderProps {
  selectedCount: number
  batchOperating: boolean
  onBatchDownload: () => void
  onBatchDelete: () => void
}

/**
 * Header component for rides list
 * Shows selection state and batch action buttons
 */
export function RidesHeader({
  selectedCount,
  batchOperating,
  onBatchDownload,
  onBatchDelete
}: RidesHeaderProps) {
  return (
    <div className="sticky top-[100px] z-40 -mx-4 md:-mx-6 px-4 md:px-6 pt-4 pb-4 mb-4 glass-header">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-normal text-primary mb-2">Rides</h1>

        {/* Selection bar or subtitle — fixed height to prevent layout shift */}
        <div className="min-h-[36px] flex items-center">
          {selectedCount > 0 ? (
            <div className="flex items-center justify-between gap-4 w-full">
              <div className="text-sm text-secondary">
                {selectedCount} ride{selectedCount !== 1 ? 's' : ''} selected
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={onBatchDownload}
                  disabled={batchOperating}
                  className="px-3 py-1.5 bg-background hover:bg-muted transition-colors rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-none"
                  aria-label={`Download ${selectedCount} selected rides`}
                >
                  <Download className="w-4 h-4" aria-hidden="true" />
                  Download ({selectedCount})
                </button>
                <button
                  onClick={onBatchDelete}
                  disabled={batchOperating}
                  className="px-3 py-1.5 bg-background hover:bg-error/10 hover:text-error transition-colors rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-none"
                  aria-label={`Delete ${selectedCount} selected rides`}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                  Delete ({selectedCount})
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-secondary">
              View and analyze your cycling activities from FIT files
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
