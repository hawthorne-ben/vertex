'use client'

import React, { Component, ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * Error Boundary component to catch React errors and prevent full page crashes
 * Wraps components to isolate errors and show fallback UI
 *
 * @example
 * <ErrorBoundary fallback={<ErrorCard />}>
 *   <RecordingCard recording={recording} />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    this.props.onError?.(error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="p-6 rounded-lg bg-error/10 border border-error/20">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-error flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-medium text-error mb-1">
                Something went wrong
              </h3>
              <p className="text-sm text-secondary">
                {this.state.error?.message || 'An unexpected error occurred'}
              </p>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * Fallback component for recording card errors
 */
export function RecordingCardError({ error }: { error?: string }) {
  return (
    <div className="card-interactive p-6 rounded-lg">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-error flex-shrink-0" aria-hidden="true" />
        <div>
          <h3 className="text-sm font-medium text-error">Failed to load recording</h3>
          {error && <p className="text-xs text-secondary mt-1">{error}</p>}
        </div>
      </div>
    </div>
  )
}

/**
 * Fallback component for ride card errors
 */
export function RideCardError({ error }: { error?: string }) {
  return (
    <div className="card-interactive p-6 rounded-lg">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-error flex-shrink-0" aria-hidden="true" />
        <div>
          <h3 className="text-sm font-medium text-error">Failed to load ride</h3>
          {error && <p className="text-xs text-secondary mt-1">{error}</p>}
        </div>
      </div>
    </div>
  )
}
