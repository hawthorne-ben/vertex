'use client'

import React from 'react'
import { X, AlertTriangle, Trash2, CheckCircle2 } from 'lucide-react'

export type ConfirmationType = 'delete' | 'warning' | 'success'

interface ConfirmationModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  type?: ConfirmationType
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  isLoading?: boolean
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  type = 'delete',
  title,
  message,
  confirmText,
  cancelText = 'Cancel',
  isLoading = false
}: ConfirmationModalProps) {
  if (!isOpen) return null

  const getIcon = () => {
    switch (type) {
      case 'delete':
        return <Trash2 className="w-6 h-6 text-error" />
      case 'warning':
        return <AlertTriangle className="w-6 h-6 text-warning" />
      case 'success':
        return <CheckCircle2 className="w-6 h-6 text-success" />
      default:
        return <AlertTriangle className="w-6 h-6 text-tertiary" />
    }
  }

  const getConfirmButtonStyle = () => {
    switch (type) {
      case 'delete':
        return 'bg-error hover:bg-error/90 text-white'
      case 'warning':
        return 'bg-warning hover:bg-warning/90 text-white'
      case 'success':
        return 'bg-success hover:bg-success/90 text-white'
      default:
        return 'bg-primary hover:bg-primary/90 text-white'
    }
  }

  const getDefaultConfirmText = () => {
    switch (type) {
      case 'delete':
        return 'Delete'
      case 'warning':
        return 'Continue'
      case 'success':
        return 'OK'
      default:
        return 'Confirm'
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-background/90 backdrop-blur-md border border-border rounded-xl shadow-2xl shadow-black/25 max-w-md w-full glass-surface">
        {/* Header */}
        <div className="flex items-center gap-3 p-6 border-b border-border">
          <div className="flex-shrink-0">
            {getIcon()}
          </div>
          <div className="flex-grow">
            <h2 className="text-lg font-semibold text-primary">
              {title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1 text-tertiary hover:text-primary transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="text-secondary">
            {message}
          </p>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 p-6 border-t border-border">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-secondary bg-muted hover:bg-muted/80 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={`
              px-4 py-2 text-sm font-medium rounded-md transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed
              ${getConfirmButtonStyle()}
            `}
          >
            {isLoading ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Loading...
              </div>
            ) : (
              confirmText || getDefaultConfirmText()
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
