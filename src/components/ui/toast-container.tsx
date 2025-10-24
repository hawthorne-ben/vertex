'use client'

import React from 'react'
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info, Copy } from 'lucide-react'
import { Toast, useToast } from './toast-context'

interface ToastItemProps {
  toast: Toast
  onRemove: (id: string) => void
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const handleCopy = async () => {
    const textToCopy = `${toast.title}${toast.message ? `: ${toast.message}` : ''}`
    try {
      await navigator.clipboard.writeText(textToCopy)
      // You could add a brief "Copied!" feedback here if desired
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <CheckCircle2 className="w-5 h-5 text-success" />
      case 'error':
        return <AlertCircle className="w-5 h-5 text-error" />
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-warning" />
      case 'info':
        return <Info className="w-5 h-5 text-info" />
      default:
        return <Info className="w-5 h-5 text-secondary" />
    }
  }

  const getBorderColor = () => {
    switch (toast.type) {
      case 'success':
        return 'border-success/20'
      case 'error':
        return 'border-error/20'
      case 'warning':
        return 'border-warning/20'
      case 'info':
        return 'border-info/20'
      default:
        return 'border-border'
    }
  }

  const getBackgroundColor = () => {
    switch (toast.type) {
      case 'success':
        return 'bg-success/10'
      case 'error':
        return 'bg-error/10'
      case 'warning':
        return 'bg-warning/10'
      case 'info':
        return 'bg-info/10'
      default:
        return 'bg-muted/80'
    }
  }

  return (
    <div className={`
      relative flex items-start gap-3 p-4 rounded-xl border backdrop-blur-md
      ${getBackgroundColor()} ${getBorderColor()}
      shadow-2xl shadow-black/20
      animate-in slide-in-from-left-5 duration-300
      glass-surface
    `}>
      <div className="flex-shrink-0 mt-0.5">
        {getIcon()}
      </div>
      
      <div className="flex-grow min-w-0">
        <h4 className="text-sm font-medium text-primary">
          {toast.title}
        </h4>
        {toast.message && (
          <p className="text-sm text-secondary mt-1">
            {toast.message}
          </p>
        )}
      </div>
      
      <div className="flex-shrink-0 flex items-center gap-1">
        {/* Copy button for error toasts */}
        {toast.type === 'error' && (
          <button
            onClick={handleCopy}
            className="p-1 text-secondary hover:text-primary transition-colors"
            aria-label="Copy error message"
            title="Copy error message"
          >
            <Copy className="w-4 h-4" />
          </button>
        )}
        
        {/* Close button */}
        <button
          onClick={() => onRemove(toast.id)}
          className="p-1 text-secondary hover:text-primary transition-colors"
          aria-label="Close toast"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

export function ToastContainer() {
  const { toasts, removeToast } = useToast()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 left-4 z-50 space-y-2 max-w-sm">
      {toasts.map(toast => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onRemove={removeToast}
        />
      ))}
    </div>
  )
}
