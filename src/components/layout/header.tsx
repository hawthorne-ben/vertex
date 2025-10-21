'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton } from '@/components/user-button'
import { Breadcrumbs } from '@/components/breadcrumbs'

export function Header() {
  const pathname = usePathname()
  
  // Hide header on public pages
  const publicPaths = ['/', '/login', '/signup', '/auth/callback']
  if (publicPaths.includes(pathname)) {
    return null
  }
  
  return (
    <header className="border-b border-stone-200 bg-white sticky top-0 z-50">
      <div className="container mx-auto px-6">
        {/* Top bar with logo and user */}
        <div className="flex items-center justify-between py-4">
          <Link href="/dashboard" className="text-2xl font-serif font-normal">
            VERTEX
          </Link>
          
          <nav className="flex items-center gap-6">
            <Link 
              href="/dashboard" 
              className="text-sm text-stone-600 hover:text-stone-900 transition-colors"
            >
              Dashboard
            </Link>
            <Link 
              href="/upload" 
              className="text-sm text-stone-600 hover:text-stone-900 transition-colors"
            >
              Upload
            </Link>
            <div className="flex items-center gap-2">
              <UserButton />
              <button
                onClick={async () => {
                  const { createClient } = await import('@/lib/supabase/client')
                  const supabase = createClient()
                  await supabase.auth.signOut()
                  window.location.href = '/'
                }}
                className="text-sm text-stone-600 hover:text-stone-900 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </nav>
        </div>
        
        {/* Breadcrumbs bar */}
        <div className="pb-3">
          <Breadcrumbs />
        </div>
      </div>
    </header>
  )
}

