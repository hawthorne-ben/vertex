import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import mockData from '@/lib/mock-data.json'

export default function DashboardPage() {
  const { stats, rides } = mockData
  const recentRides = rides.slice(0, 3) // Show 3 most recent

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-serif font-normal mb-8">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-stone-600">Total Rides</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalRides}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-stone-600">Total Hours</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalHours}h</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-stone-600">Max Lean Angle</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.maxLeanAngle}°</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-stone-600">Storage Used</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.storageUsed} {stats.storageUnit}</div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Rides */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-xl font-serif">Recent Rides</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {recentRides.map((ride) => (
              <Link 
                key={ride.id}
                href={`/rides/${ride.id}`}
                className="block p-4 border border-stone-200 rounded-md hover:bg-stone-50 transition-colors"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="font-medium text-lg">{ride.name}</h3>
                    <p className="text-sm text-stone-600">{ride.location}</p>
                  </div>
                  <span className="text-sm text-stone-500">
                    {new Date(ride.date).toLocaleDateString('en-US', { 
                      month: 'short', 
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-stone-500">Distance</span>
                    <p className="font-medium">{ride.distance} mi</p>
                  </div>
                  <div>
                    <span className="text-stone-500">Duration</span>
                    <p className="font-medium">{Math.round(ride.duration / 60)} min</p>
                  </div>
                  <div>
                    <span className="text-stone-500">Max Speed</span>
                    <p className="font-medium">{ride.stats.maxSpeed} mph</p>
                  </div>
                  <div>
                    <span className="text-stone-500">Max Lean</span>
                    <p className="font-medium">{ride.stats.maxLeanAngle}°</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Timeline View - Placeholder */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-serif">Activity Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-stone-600">Calendar heatmap showing ride frequency and intensity.</p>
        </CardContent>
      </Card>
    </div>
  )
}
