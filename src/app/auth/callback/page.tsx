'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const handleCallback = async () => {
      const supabase = createClient()
      
      // Handle email confirmation or OAuth callback (for future use)
      const { error } = await supabase.auth.exchangeCodeForSession(
        new URL(window.location.href).searchParams.get('code') || ''
      )

      if (error) {
        console.error('Error during callback:', error)
        router.push('/login?error=callback_failed')
      } else {
        router.push('/dashboard')
      }
      
      router.refresh()
    }

    handleCallback()
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-stone-900 mx-auto mb-4"></div>
        <p className="text-stone-600">Confirming email...</p>
      </div>
    </div>
  )
}
