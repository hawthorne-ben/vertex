'use client'

import { useState } from 'react'
import { FileText, X, Upload, Loader2 } from 'lucide-react'

interface FileToUpload {
  file: File
  id: string
}

interface ConfirmationModalProps {
  files: FileToUpload[]
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
  onRemoveFile: (id: string) => void
}

export function ConfirmationModal({ files, isOpen, onConfirm, onCancel, onRemoveFile }: ConfirmationModalProps) {
  if (!isOpen) return null

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const isFileOversized = (bytes: number) => {
    const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB limit (matches upload logic)
    return bytes > MAX_FILE_SIZE
  }

  const getFileType = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase()
    return ext || 'unknown'
  }

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-background/90 backdrop-blur-md border border-border rounded-xl shadow-2xl shadow-black/25 max-w-2xl w-full max-h-[80vh] overflow-hidden glass-surface">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-medium text-primary">Confirm Upload</h2>
          <button
            onClick={onCancel}
            className="p-2 text-tertiary hover:text-primary hover:bg-muted rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          <p className="text-secondary mb-4">
            Please review the files you&apos;re about to upload. Processing will begin automatically after upload.
          </p>

          <div className="space-y-3">
            {files.map((fileToUpload) => (
              <div
                key={fileToUpload.id}
                className="flex items-center gap-3 p-3 bg-muted rounded-lg border border-border"
              >
                <FileText className="w-5 h-5 text-tertiary flex-shrink-0" />
                
                <div className="flex-grow min-w-0">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-sm font-medium text-primary truncate">
                      {fileToUpload.file.name}
                    </span>
                    <span className={`text-xs flex-shrink-0 ${isFileOversized(fileToUpload.file.size) ? 'text-error font-medium' : 'text-tertiary'}`}>
                      {formatFileSize(fileToUpload.file.size)}
                      {isFileOversized(fileToUpload.file.size) && ' (TOO LARGE)'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-secondary">
                    <span>Type: {getFileType(fileToUpload.file.name)}</span>
                    <span>•</span>
                    <span>Modified: {new Date(fileToUpload.file.lastModified).toLocaleDateString()}</span>
                  </div>
                </div>

                <button
                  onClick={() => onRemoveFile(fileToUpload.id)}
                  className="p-1 text-tertiary hover:text-error hover:bg-error/10 rounded transition-colors"
                  title="Remove file"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {files.length === 0 && (
            <div className="text-center py-8 text-secondary">
              <FileText className="w-12 h-12 mx-auto mb-2 text-tertiary" />
              <p>No files selected</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border bg-muted/50">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={files.length === 0}
            className="px-6 py-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded-md flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Upload {files.length} file{files.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

interface UploadProgressModalProps {
  isOpen: boolean
  currentFile: string
  progress: number
  totalFiles: number
  currentFileIndex: number
}

export function UploadProgressModal({ isOpen, currentFile, progress, totalFiles, currentFileIndex }: UploadProgressModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-background/90 backdrop-blur-md border border-border rounded-xl shadow-2xl shadow-black/25 max-w-md w-full glass-surface">
        {/* Header */}
        <div className="p-6 border-b border-border">
          <h2 className="text-xl font-medium text-primary">Uploading Files</h2>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
            <div className="flex-grow">
              <p className="text-sm text-primary font-medium truncate">
                {currentFile}
              </p>
              <p className="text-xs text-secondary">
                File {currentFileIndex + 1} of {totalFiles}
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-muted rounded-full h-2 mb-2">
            <div 
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          
          <p className="text-xs text-secondary text-center">
            {progress.toFixed(0)}% complete
          </p>
        </div>
      </div>
    </div>
  )
}
