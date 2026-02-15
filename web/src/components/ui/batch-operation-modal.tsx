'use client'

import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { formatDurationFromTimestamps } from '@/lib/utils/formatting'

interface ModalFile {
  id: string
  filename?: string
  start_time: string | null
  end_time: string | null
  file_size_bytes: number
}

interface BatchOperationModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  files: ModalFile[]
  operation: 'delete' | 'download' | 'merge'
  isLoading?: boolean
  // For merge operation only
  filename?: string
  onFilenameChange?: (value: string) => void
}

export function BatchOperationModal({
  isOpen,
  onClose,
  onConfirm,
  files,
  operation,
  isLoading = false,
  filename = '',
  onFilenameChange
}: BatchOperationModalProps) {
  if (!isOpen) return null

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }

  const formatDuration = formatDurationFromTimestamps

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getTitle = () => {
    switch (operation) {
      case 'delete':
        return 'Delete Recordings'
      case 'download':
        return 'Download Recordings'
      case 'merge':
        return 'Merge VTX Recordings'
    }
  }

  const getDescription = () => {
    switch (operation) {
      case 'delete':
        return 'The following recordings will be permanently deleted:'
      case 'download':
        return 'The following recordings will be downloaded as a ZIP file:'
      case 'merge':
        return 'The following recordings will be merged into a single file (originals will be deleted):'
    }
  }

  const getConfirmText = () => {
    switch (operation) {
      case 'delete':
        return isLoading ? 'Deleting...' : 'Delete'
      case 'download':
        return isLoading ? 'Downloading...' : 'Download'
      case 'merge':
        return isLoading ? 'Merging...' : 'Merge Files'
    }
  }

  const getConfirmClass = () => {
    return operation === 'delete' ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground' : ''
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg max-w-3xl w-full max-h-[80vh] flex flex-col border border-border">
        {/* Header */}
        <div className="p-6 border-b border-border">
          <h2 className="text-2xl font-bold text-primary">{getTitle()}</h2>
          <p className="text-secondary mt-2">{getDescription()}</p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-3">
            {files.map((file) => (
              <div
                key={file.id}
                className="p-4 rounded-lg border border-border bg-muted/50"
              >
                <div className="flex-1">
                  <div className="font-medium mb-1 text-primary">
                    {file.start_time && file.end_time ? (
                      <>
                        {(() => {
                          try {
                            const startDate = new Date(file.start_time)
                            const endDate = new Date(file.end_time)

                            const dateStr = startDate.toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric'
                            })
                            const startTimeStr = startDate.toLocaleTimeString(undefined, {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true
                            })
                            const endTimeStr = endDate.toLocaleTimeString(undefined, {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true
                            })

                            return `${dateStr}, ${startTimeStr} → ${endTimeStr}`
                          } catch (error) {
                            return file.filename || 'Unknown'
                          }
                        })()}
                      </>
                    ) : (
                      file.filename || 'Unknown'
                    )}
                  </div>
                  <div className="text-sm text-secondary space-y-1">
                    {file.start_time && file.end_time && (
                      <div>{formatDuration(file.start_time, file.end_time)}</div>
                    )}
                    <div>Source: {file.filename} ({formatFileSize(file.file_size_bytes)})</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Merge filename input */}
          {operation === 'merge' && (
            <div className="mt-6">
              <label htmlFor="merge-filename" className="block text-sm font-medium text-primary mb-2">
                New recording name
              </label>
              <input
                id="merge-filename"
                type="text"
                value={filename}
                onChange={(e) => onFilenameChange?.(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="merged.vtx"
                disabled={isLoading}
              />
              <p className="mt-2 text-xs text-secondary">
                .vtx extension will be added automatically
              </p>
            </div>
          )}

          {/* Warning for destructive operations */}
          {(operation === 'delete' || operation === 'merge') && (
            <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400 font-medium">
                {operation === 'delete' ? 'This action cannot be undone' : 'Original files will be permanently deleted after merge'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border flex justify-between items-center">
          <div className="text-sm text-secondary">
            {files.length} file{files.length !== 1 ? 's' : ''} selected
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={onConfirm}
              disabled={isLoading || (operation === 'merge' && !filename.trim())}
              className={getConfirmClass()}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {getConfirmText()}
                </>
              ) : (
                getConfirmText()
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
