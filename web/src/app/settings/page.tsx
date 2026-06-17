'use client'

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { ProfileTab } from './components/profile-tab'
import { AccountTab } from './components/account-tab'
import { AdminTab } from './components/admin-tab'

export default function SettingsPage() {
  return (
    <div className="container mx-auto p-4 md:p-6 max-w-4xl">
      <h1 className="text-2xl md:text-3xl font-serif font-normal mb-6 md:mb-8">Settings</h1>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="bikes">Bikes</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="admin">Admin</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <ProfileTab />
        </TabsContent>

        <TabsContent value="bikes">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-serif">Your Bikes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-secondary py-8">
                No bikes configured yet. Add your first bike to use in ride metadata.
              </p>
              <Button>Add Bike</Button>
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
                <select className="form-input w-full px-3 py-2 rounded-md">
                  <option>Metric</option>
                  <option>Imperial</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Timezone</label>
                <select className="form-input w-full px-3 py-2 rounded-md">
                  <option>UTC</option>
                </select>
              </div>
              <Button>Save Preferences</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="account">
          <AccountTab />
        </TabsContent>

        <TabsContent value="admin">
          <AdminTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
