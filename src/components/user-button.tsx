'use client'

import Link from 'next/link'
import { User } from 'lucide-react'

export function UserButton() {
  return (
    <Link 
      href="/settings"
      className="p-2 hover:bg-stone-50 transition-colors rounded-full"
      title="Settings"
    >
      <User className="h-5 w-5 text-stone-600" />
    </Link>
  )
}

