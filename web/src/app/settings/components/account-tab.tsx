'use client'

import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

export function AccountTab() {
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id)
    })
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-serif">Account Management</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h3 className="font-medium mb-2 text-primary">Account ID</h3>
          <p className="text-sm text-secondary mb-2">Your unique identifier (never changes):</p>
          <code className="block p-2 bg-muted rounded text-xs font-mono break-all text-primary">
            {userId || 'Loading...'}
          </code>
        </div>

        <div className="border-t border-border pt-6">
          <h3 className="font-medium mb-2 text-primary">Change Password</h3>
          <p className="text-sm text-secondary mb-4">Password changes require re-authentication.</p>
          <Button variant="outline" disabled>
            Change Password (Coming Soon)
          </Button>
        </div>

        <div className="border-t border-border pt-6">
          <h3 className="font-medium mb-2 text-error">Danger Zone</h3>
          <p className="text-sm text-secondary mb-4">
            Permanently delete your account and all associated data.
          </p>
          <Button variant="outline" className="border-error text-error hover:bg-error/10" disabled>
            Delete Account (Coming Soon)
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
