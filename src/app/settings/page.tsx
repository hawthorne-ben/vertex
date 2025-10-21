'use client'

import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null)
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  useEffect(() => {
    const loadUser = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (user) {
        setUser(user)
        setFullName(user.user_metadata?.full_name || '')
      }
    }

    loadUser()
  }, [])

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({
        data: {
          full_name: fullName,
        }
      })

      if (error) throw error

      setMessage({ type: 'success', text: 'Profile updated successfully!' })
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to update profile' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-4xl">
      <h1 className="text-2xl md:text-3xl font-serif font-normal mb-6 md:mb-8">Settings</h1>
      
      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="bikes">Bikes</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>
        
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-serif">Profile Information</CardTitle>
            </CardHeader>
            <CardContent>
              {message && (
                <div className={`mb-4 p-3 rounded-md ${
                  message.type === 'success' 
                    ? 'bg-green-50 text-green-800 border border-green-200' 
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}>
                  {message.text}
                </div>
              )}

              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div>
                  <label htmlFor="fullName" className="block text-sm font-medium mb-2">
                    Full Name
                  </label>
                  <input
                    id="fullName"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your name"
                    disabled={loading}
                    className="flex h-10 w-full rounded-md border border-stone-300 bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-medium mb-2">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={user?.email || ''}
                    disabled
                    className="flex h-10 w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-500 cursor-not-allowed"
                  />
                  <p className="text-xs text-stone-500 mt-1">
                    Email is tied to your account authentication and cannot be changed here. 
                    Contact support to update your email.
                  </p>
                </div>

                <Button type="submit" disabled={loading}>
                  {loading ? 'Saving...' : 'Save Changes'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="bikes">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-serif">Your Bikes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-stone-600 text-center py-8">
                No bikes configured yet. Add your first bike to use in ride metadata.
              </p>
              <Button className="w-full">Add Bike</Button>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="preferences">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-serif">Preferences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Units</label>
                <select className="w-full px-3 py-2 border border-stone-300 rounded-md">
                  <option>Metric</option>
                  <option>Imperial</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Timezone</label>
                <select className="w-full px-3 py-2 border border-stone-300 rounded-md">
                  <option>UTC</option>
                </select>
              </div>
              <Button>Save Preferences</Button>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="account">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-serif">Account Management</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="font-medium mb-2">Account ID</h3>
                <p className="text-sm text-stone-600 mb-2">
                  Your unique identifier (never changes):
                </p>
                <code className="block p-2 bg-stone-100 rounded text-xs font-mono break-all">
                  {user?.id || 'Loading...'}
                </code>
              </div>

              <div className="border-t border-stone-200 pt-6">
                <h3 className="font-medium mb-2">Change Password</h3>
                <p className="text-sm text-stone-600 mb-4">
                  Password changes require re-authentication.
                </p>
                <Button variant="outline" disabled>
                  Change Password (Coming Soon)
                </Button>
              </div>

              <div className="border-t border-stone-200 pt-6">
                <h3 className="font-medium mb-2 text-red-800">Danger Zone</h3>
                <p className="text-sm text-stone-600 mb-4">
                  Permanently delete your account and all associated data.
                </p>
                <Button variant="outline" className="border-red-300 text-red-800 hover:bg-red-50" disabled>
                  Delete Account (Coming Soon)
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
