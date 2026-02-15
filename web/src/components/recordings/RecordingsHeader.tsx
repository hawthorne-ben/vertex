'use client'

import { Download, Trash2, FileText } from 'lucide-react'
import { Recording } from '@/types/recordings'

interface RecordingsHeaderProps {
  selectedCount: number
  selectedFiles: Recording[]
  canMerge: boolean
  batchOperating: boolean
  merging: boolean
  onBatchDownload: () => void
  onBatchDelete: () => void
  onMerge: () => void
}

/**
 * Header component for recordings list
 * Shows selection state and batch action buttons
 */
export function RecordingsHeader({
  selectedCount,
  selectedFiles,
  canMerge,
  batchOperating,
  merging,
  onBatchDownload,
  onBatchDelete,
  onMerge
}: RecordingsHeaderProps) {
  const hasDownloadableFiles = selectedFiles.some(f => f.status === 'ready')

  return (
    <div className="sticky top-[100px] z-40 -mx-4 md:-mx-6 px-4 md:px-6 pt-4 pb-4 mb-4 glass-header">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-normal text-primary mb-2">Recordings</h1>

        {/* Selection bar or subtitle — fixed height to prevent layout shift */}
        <div className="min-h-[36px] flex items-center">
          {selectedCount > 0 ? (
            <div className="flex items-center justify-between gap-4 w-full">
              <div className="text-sm text-secondary">
                {selectedCount} file{selectedCount !== 1 ? 's' : ''} selected
              </div>
              <div className="flex gap-2 flex-wrap">
                {canMerge && (
                  <button
                    onClick={onMerge}
                    disabled={batchOperating || merging}
                    className="px-3 py-1.5 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-none"
                    aria-label={`Merge ${selectedCount} selected recordings`}
                  >
                    <FileText className="w-4 h-4" aria-hidden="true" />
                    Merge Recordings
                  </button>
                )}
                <button
                  onClick={onBatchDownload}
                  disabled={batchOperating || !hasDownloadableFiles}
                  className="px-3 py-1.5 bg-background hover:bg-muted transition-colors rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-none"
                  aria-label={`Download ${selectedCount} selected recordings`}
                >
                  <Download className="w-4 h-4" aria-hidden="true" />
                  Download ({selectedCount})
                </button>
                <button
                  onClick={onBatchDelete}
                  disabled={batchOperating}
                  className="px-3 py-1.5 bg-background hover:bg-error/10 hover:text-error transition-colors rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-none"
                  aria-label={`Delete ${selectedCount} selected recordings`}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                  Delete ({selectedCount})
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-secondary">
              View and analyze your Vertex IMU sensor recordings
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
