'use client'

import React from 'react'
import { Card, CardContent } from './ui/card'
import { AlertCircle } from 'lucide-react'

interface MapErrorBoundaryProps {
  children: React.ReactNode
}

interface MapErrorBoundaryState {
  hasError: boolean
  error?: Error
}

export class MapErrorBoundary extends React.Component<MapErrorBoundaryProps, MapErrorBoundaryState> {
  constructor(props: MapErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): MapErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Map error boundary caught error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card>
          <CardContent className="h-[400px] flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center max-w-md">
              <AlertCircle className="w-12 h-12 text-destructive" />
              <div>
                <h3 className="text-lg font-semibold mb-2">Map Error</h3>
                <p className="text-sm text-muted-foreground">
                  Failed to load the map. Try refreshing the page.
                </p>
                {this.state.error && (
                  <p className="text-xs text-muted-foreground mt-2 font-mono">
                    {this.state.error.message}
                  </p>
                )}
              </div>
              <button
                onClick={() => this.setState({ hasError: false })}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
              >
                Try Again
              </button>
            </div>
          </CardContent>
        </Card>
      )
    }

    return this.props.children
  }
}
