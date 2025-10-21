'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { User } from 'lucide-react'

export function UserButton() {
  return (
    <Link href="/settings">
      <Button variant="ghost" size="icon" className="rounded-full">
        <User className="h-5 w-5" />
      </Button>
    </Link>
  )
}

