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
    'upload': 'Upload',
    'rides': 'Rides',
    'create': 'Create Ride',
    'settings': 'Settings',
  }
  
  return (
    <nav className="flex items-center space-x-2 text-sm">
      <Link 
        href="/dashboard" 
        className="text-stone-600 hover:text-stone-900"
      >
        Dashboard
      </Link>
      
      {segments.map((segment, index) => {
        const href = '/' + segments.slice(0, index + 1).join('/')
        const label = breadcrumbLabels[segment] || segment
        const isLast = index === segments.length - 1
        
        return (
          <div key={href} className="flex items-center space-x-2">
            <ChevronRight className="h-4 w-4 text-stone-400" />
            {isLast ? (
              <span className="text-stone-900 font-medium">{label}</span>
            ) : (
              <Link 
                href={href}
                className="text-stone-600 hover:text-stone-900"
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

