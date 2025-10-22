'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton } from '@/components/user-button'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { ThemeToggle } from '@/components/theme-toggle'

export function Header() {
  const pathname = usePathname()
  
  // Hide header on public pages
  const publicPaths = ['/', '/login', '/signup', '/auth/callback']
  if (publicPaths.includes(pathname)) {
    return null
  }
  
  // Check if breadcrumbs should be shown
  const showBreadcrumbs = pathname !== '/dashboard' && 
    !pathname.startsWith('/login') && 
    !pathname.startsWith('/signup') && 
    !pathname.startsWith('/auth')
  
  return (
    <header className="border-b border-border bg-background sticky top-0 z-50">
      <div className="container mx-auto px-4 md:px-6">
        {/* Top bar with logo and user */}
        <div className="flex items-center justify-between py-4">
          <Link href="/dashboard" className="text-xl md:text-2xl font-serif font-normal">
            VERTEX
          </Link>
          
          <nav className="flex items-center gap-1 text-sm">
            <Link 
              href="/dashboard" 
              className="px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-md"
            >
              Dashboard
            </Link>
            <Link 
              href="/data" 
              className="px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-md"
            >
              Data
            </Link>
            <Link 
              href="/upload" 
              className="px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-md"
            >
              Upload
            </Link>
            <div className="flex items-center gap-1 ml-2 pl-4 border-l border-border">
              <ThemeToggle />
              <UserButton />
              <button
                onClick={async () => {
                  const { createClient } = await import('@/lib/supabase/client')
                  const supabase = createClient()
                  await supabase.auth.signOut()
                  window.location.href = '/'
                }}
                className="px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-md hidden sm:block"
              >
                Sign Out
              </button>
            </div>
          </nav>
        </div>
        
        {/* Breadcrumbs bar - only show padding when breadcrumbs are present */}
        {showBreadcrumbs && (
          <div className="pb-3">
            <Breadcrumbs />
          </div>
        )}
      </div>
    </header>
  )
}

