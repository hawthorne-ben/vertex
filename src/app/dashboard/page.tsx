import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import mockData from '@/lib/mock-data.json'

export default function DashboardPage() {
  const { stats, rides } = mockData
  const recentRides = rides.slice(0, 3) // Show 3 most recent

  return (
    <div className="container mx-auto p-4 md:p-6">
      <h1 className="text-2xl md:text-3xl font-serif font-normal mb-6 md:mb-8">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-6 md:mb-8">
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

      {/* Two Column Layout */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* Recent Rides - Left Column */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-serif">Recent Rides</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentRides.map((ride) => (
                <Link 
                  key={ride.id}
                  href={`/rides/${ride.id}`}
                  className="block p-3 border border-stone-200 rounded-md hover:bg-stone-50 transition-colors"
                >
                  <div className="flex justify-between gap-4 mb-2">
                    <h3 className="font-medium text-base">{ride.name}</h3>
                    <span className="text-sm text-stone-500 flex-shrink-0">
                      {new Date(ride.date).toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric'
                      })}
                    </span>
                  </div>
                  <p className="text-sm text-stone-600 mb-2">{ride.location}</p>
                  
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-stone-500">Distance</span>
                      <span className="font-medium">{ride.distance} mi</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500">Duration</span>
                      <span className="font-medium">{Math.round(ride.duration / 60)} min</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500">Max Speed</span>
                      <span className="font-medium">{ride.stats.maxSpeed} mph</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500">Max Lean</span>
                      <span className="font-medium">{ride.stats.maxLeanAngle}°</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Activity Calendar - Right Column */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-serif">Activity Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Calendar Heatmap Placeholder */}
              <div>
                <h3 className="text-sm font-medium mb-3">This Month</h3>
                <div className="h-32 bg-stone-100 rounded-md flex items-center justify-center">
                  <p className="text-stone-500 text-sm">Calendar heatmap</p>
                </div>
              </div>

              {/* Quick Stats */}
              <div>
                <h3 className="text-sm font-medium mb-3">Last 30 Days</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-stone-600">Rides</span>
                    <span className="font-medium">12</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-600">Total Distance</span>
                    <span className="font-medium">284 mi</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-600">Total Time</span>
                    <span className="font-medium">18.5 h</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-600">Avg Lean Angle</span>
                    <span className="font-medium">32.4°</span>
                  </div>
                </div>
              </div>

              {/* Milestones */}
              <div>
                <h3 className="text-sm font-medium mb-3">Recent Milestones</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-stone-600">
                    <span className="text-lg">🏆</span>
                    <span>First track day completed</span>
                  </div>
                  <div className="flex items-center gap-2 text-stone-600">
                    <span className="text-lg">📊</span>
                    <span>20+ rides logged</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
