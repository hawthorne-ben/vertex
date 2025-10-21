import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

export default function DashboardPage() {
  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-serif font-normal mb-8">Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-neutral-600">Total Rides</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-mono font-semibold">0</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-neutral-600">Total Hours</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-mono font-semibold">0</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-neutral-600">Latest Ride</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-neutral-600">No rides yet</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-neutral-600">Storage Used</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-mono font-semibold">0 MB</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-serif">Recent Rides</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-neutral-600 text-center py-8">
            No rides yet. Upload your first IMU data to get started.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

