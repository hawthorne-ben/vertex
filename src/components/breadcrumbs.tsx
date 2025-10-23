'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

export function Breadcrumbs() {
  const pathname = usePathname()
  
  // Don't show breadcrumbs on dashboard or auth pages
  if (pathname === '/dashboard' || pathname.startsWith('/login') || pathname.startsWith('/signup') || pathname.startsWith('/auth')) {
    return null
  }
  
  const segments = pathname.split('/').filter(Boolean)
  
  const breadcrumbLabels: Record<string, string> = {
    'dashboard': 'Dashboard',
    'data': 'Data',
    'upload': 'Upload',
    'rides': 'Rides',
    'create': 'Create Ride',
    'settings': 'Settings',
  }
  
  // Function to get label for dynamic segments (UUIDs, etc)
  const getSegmentLabel = (segment: string, index: number) => {
    // If it's a UUID (looks like a data ID), use "View Data" 
    if (segment.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      // Check parent segment to determine context
      const parentSegment = segments[index - 1]
      if (parentSegment === 'data') return 'View Data'
      if (parentSegment === 'rides') return 'Ride Details'
      return segment.slice(0, 8) + '...'
    }
    return breadcrumbLabels[segment] || segment
  }
  
  return (
    <nav className="flex items-center space-x-2 text-sm">
      <Link 
        href="/dashboard" 
        className="text-secondary hover:text-primary"
      >
        Dashboard
      </Link>
      
      {segments.map((segment, index) => {
        const href = '/' + segments.slice(0, index + 1).join('/')
        const label = getSegmentLabel(segment, index)
        const isLast = index === segments.length - 1
        
        return (
          <div key={href} className="flex items-center space-x-2">
            <ChevronRight className="h-4 w-4 text-secondary" />
            {isLast ? (
              <span className="text-primary font-medium">{label}</span>
            ) : (
              <Link 
                href={href}
                className="text-secondary hover:text-primary"
              >
                {label}
              </Link>
            )}
          </div>
        )
      })}
    </nav>
  )
}

