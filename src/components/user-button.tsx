'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { User } from 'lucide-react'

export function UserButton() {
  const router = useRouter()

  const handleSettingsClick = () => {
    router.push('/settings')
  }

  const handleSignOut = () => {
    // TODO: Implement Supabase sign out
    router.push('/')
  }

  return (
    <div className="relative group">
      <Button variant="ghost" size="icon" className="rounded-full">
        <User className="h-5 w-5" />
      </Button>
      
      {/* Simple dropdown - will be replaced with proper dropdown component later */}
      <div className="absolute right-0 mt-2 w-56 bg-white border border-neutral-200 rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
        <div className="py-1">
          <div className="px-4 py-2 text-sm font-medium border-b">
            My Account
          </div>
          <button
            onClick={handleSettingsClick}
            className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-50"
          >
            Settings
          </button>
          <div className="border-t">
            <button
              onClick={handleSignOut}
              className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-50"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

