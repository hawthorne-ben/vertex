import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import mockData from '@/lib/mock-data.json'

export default function RidesPage() {
  const { rides } = mockData

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  }

  // Sort rides by date (most recent first)
  const sortedRides = [...rides].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  )

  // Group by bike type
  const bikeGroups = rides.reduce((acc, ride) => {
    if (!acc[ride.bike]) acc[ride.bike] = []
    acc[ride.bike].push(ride)
    return acc
  }, {} as Record<string, typeof rides>)

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-serif font-normal mb-8">All Rides</h1>

      <Tabs defaultValue="all" className="space-y-6">
        <TabsList>
          <TabsTrigger value="all">All Rides</TabsTrigger>
          <TabsTrigger value="by-bike">By Bike</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-serif">
                All Rides ({sortedRides.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {/* Table Header - Hidden on mobile */}
                <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-3 bg-muted rounded-md text-sm font-medium text-secondary">
                  <div className="col-span-3">Ride</div>
                  <div className="col-span-2">Date</div>
                  <div className="col-span-2">Location</div>
                  <div className="col-span-1 text-right">Distance</div>
                  <div className="col-span-1 text-right">Duration</div>
                  <div className="col-span-1 text-right">Max Speed</div>
                  <div className="col-span-2 text-right">Max Lean</div>
                </div>

                {/* Ride Rows */}
                {sortedRides.map((ride) => (
                  <Link
                    key={ride.id}
                    href={`/rides/${ride.id}`}
                    className="block md:grid md:grid-cols-12 gap-4 px-4 py-4 border border-border rounded-md hover:bg-muted transition-colors"
                  >
                    {/* Mobile layout */}
                    <div className="md:hidden space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-medium">{ride.name}</div>
                          <div className="text-sm text-secondary">{formatDate(ride.date)} • {formatTime(ride.date)}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-medium">{ride.stats.maxLeanAngle}°</div>
                          <div className="text-xs text-secondary">max lean</div>
                        </div>
                      </div>
                      <div className="flex gap-4 text-sm text-secondary">
                        <span>{ride.distance} mi</span>
                        <span>•</span>
                        <span>{formatDuration(ride.duration)}</span>
                        <span>•</span>
                        <span>{ride.stats.maxSpeed} mph</span>
                      </div>
                    </div>

                    {/* Desktop layout */}
                    <div className="hidden md:contents">
                      <div className="col-span-3">
                        <div className="font-medium">{ride.name}</div>
                        <div className="text-sm text-secondary">{formatTime(ride.date)}</div>
                      </div>
                      <div className="col-span-2 text-secondary">
                        {formatDate(ride.date)}
                      </div>
                      <div className="col-span-2 text-secondary truncate">
                        {ride.location}
                      </div>
                      <div className="col-span-1 text-right text-primary">
                        {ride.distance} mi
                      </div>
                      <div className="col-span-1 text-right text-primary">
                        {formatDuration(ride.duration)}
                      </div>
                      <div className="col-span-1 text-right text-primary">
                        {ride.stats.maxSpeed} mph
                      </div>
                      <div className="col-span-2 text-right">
                        <span className="font-medium text-primary">
                          {ride.stats.maxLeanAngle}°
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="by-bike">
          <div className="space-y-6">
            {Object.entries(bikeGroups).map(([bike, bikeRides]) => (
              <Card key={bike}>
                <CardHeader>
                  <CardTitle className="text-xl font-serif">
                    {bike} ({bikeRides.length} rides)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {bikeRides
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                      .map((ride) => (
                        <Link
                          key={ride.id}
                          href={`/rides/${ride.id}`}
                          className="block px-4 py-3 border border-border rounded-md hover:bg-muted transition-colors"
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <div className="font-medium">{ride.name}</div>
                              <div className="text-sm text-secondary">
                                {formatDate(ride.date)} at {formatTime(ride.date)}
                              </div>
                            </div>
                            <div className="text-sm text-secondary">
                              {ride.location}
                            </div>
                          </div>
                          <div className="flex gap-6 text-sm">
                            <div>
                              <span className="text-secondary">Distance: </span>
                              <span className="font-medium">{ride.distance} mi</span>
                            </div>
                            <div>
                              <span className="text-secondary">Duration: </span>
                              <span className="font-medium">{formatDuration(ride.duration)}</span>
                            </div>
                            <div>
                              <span className="text-secondary">Max Lean: </span>
                              <span className="font-medium">{ride.stats.maxLeanAngle}°</span>
                            </div>
                            <div>
                              <span className="text-secondary">Max Speed: </span>
                              <span className="font-medium">{ride.stats.maxSpeed} mph</span>
                            </div>
                          </div>
                        </Link>
                      ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

