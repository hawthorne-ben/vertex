import { notFound } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import mockData from '@/lib/mock-data.json'

export default async function RideDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  
  // Find the ride in mock data
  const ride = mockData.rides.find(r => r.id === id)
  
  if (!ride) {
    notFound()
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', { 
      weekday: 'long',
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  
  return (
    <div className="container mx-auto p-4 md:p-6">
      {/* Ride Header */}
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-serif font-normal mb-2">{ride.name}</h1>
        <div className="flex flex-wrap gap-2 md:gap-4 text-sm md:text-base text-secondary">
          <span>{formatDate(ride.date)}</span>
          <span className="hidden sm:inline">•</span>
          <span>{ride.location}</span>
          <span className="hidden sm:inline">•</span>
          <span>{ride.bike}</span>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 md:gap-4 mb-8">
        <Card>
          <CardContent className="pt-4 md:pt-6">
            <div className="text-xs md:text-sm text-secondary mb-1">Distance</div>
            <div className="text-xl md:text-2xl font-bold text-primary">{ride.distance} mi</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 md:pt-6">
            <div className="text-xs md:text-sm text-secondary mb-1">Duration</div>
            <div className="text-xl md:text-2xl font-bold text-primary">{Math.round(ride.duration / 60)} min</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 md:pt-6">
            <div className="text-xs md:text-sm text-secondary mb-1">Avg Speed</div>
            <div className="text-xl md:text-2xl font-bold text-primary">{ride.stats.avgSpeed} mph</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 md:pt-6">
            <div className="text-xs md:text-sm text-secondary mb-1">Max Lean</div>
            <div className="text-xl md:text-2xl font-bold text-primary">{ride.stats.maxLeanAngle}°</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 md:pt-6">
            <div className="text-xs md:text-sm text-secondary mb-1">Corners</div>
            <div className="text-xl md:text-2xl font-bold text-primary">{ride.stats.corners}</div>
          </CardContent>
        </Card>
      </div>
      
      {/* Tabbed Analysis */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="imu">IMU Analysis</TabsTrigger>
          {ride.powerData && <TabsTrigger value="power">Power</TabsTrigger>}
          <TabsTrigger value="data">Raw Data</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview">
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-xl font-serif">Riding Dynamics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-secondary">Max Speed</span>
                  <span className="font-medium text-primary">{ride.stats.maxSpeed} mph</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary">Average Lean Angle</span>
                  <span className="font-medium text-primary">{ride.stats.avgLeanAngle}°</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary">Max G-Force</span>
                  <span className="font-medium text-primary">{ride.stats.maxGForce}g</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary">Braking Events</span>
                  <span className="font-medium text-primary">{ride.stats.brakingEvents}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl font-serif">Route Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-secondary">Location</span>
                  <span className="font-medium text-primary">{ride.location}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary">Conditions</span>
                  <span className="font-medium text-primary">{ride.conditions}</span>
                </div>
                {ride.gpsData && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-secondary">Elevation Gain</span>
                      <span className="font-medium text-primary">{ride.gpsData.elevation.gain} ft</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-secondary">Max Elevation</span>
                      <span className="font-medium text-primary">{ride.gpsData.elevation.max} ft</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-xl font-serif">GPS Track</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 bg-muted rounded-md flex items-center justify-center">
                <p className="text-secondary">Interactive map will be displayed here</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="imu">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-xl font-serif">Traction Circle</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80 bg-muted rounded-md flex items-center justify-center">
                  <p className="text-secondary">G-force visualization will be displayed here</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl font-serif">Lean Angle Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64 bg-muted rounded-md flex items-center justify-center">
                  <p className="text-secondary">Lean angle chart over time</p>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-secondary">Average</span>
                    <p className="font-medium text-lg text-primary">{ride.stats.avgLeanAngle}°</p>
                  </div>
                  <div>
                    <span className="text-secondary">Maximum</span>
                    <p className="font-medium text-lg text-primary">{ride.stats.maxLeanAngle}°</p>
                  </div>
                  <div>
                    <span className="text-secondary">Data Points</span>
                    <p className="font-medium text-lg text-primary">{ride.imuData?.dataPoints.toLocaleString() || 'N/A'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        {ride.powerData && (
          <TabsContent value="power">
            <Card>
              <CardHeader>
                <CardTitle className="text-xl font-serif">Power & Heart Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64 bg-muted rounded-md flex items-center justify-center mb-6">
                  <p className="text-secondary">Power/HR chart over time</p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-sm text-secondary mb-1">Avg Power</div>
                    <div className="text-2xl font-bold text-primary">{ride.powerData.avgPower}W</div>
                  </div>
                  <div>
                    <div className="text-sm text-secondary mb-1">Max Power</div>
                    <div className="text-2xl font-bold text-primary">{ride.powerData.maxPower}W</div>
                  </div>
                  <div>
                    <div className="text-sm text-secondary mb-1">Avg HR</div>
                    <div className="text-2xl font-bold text-primary">{ride.powerData.avgHeartRate} bpm</div>
                  </div>
                  <div>
                    <div className="text-sm text-secondary mb-1">Calories</div>
                    <div className="text-2xl font-bold text-primary">{ride.powerData.calories}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
        
        <TabsContent value="data">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-serif">Export & Raw Data</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
                  Download CSV
                </button>
                <button className="px-4 py-2 border border-border rounded-md hover-bg transition-colors">
                  Download FIT File
                </button>
                <button className="px-4 py-2 border border-border rounded-md hover-bg transition-colors">
                  Export Charts
                </button>
              </div>
              
              <div className="border-t border-border pt-4">
                <h3 className="font-medium mb-3">Data Summary</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  {ride.imuData && (
                    <>
                      <div>
                        <span className="text-secondary">IMU Sample Rate</span>
                        <p className="font-medium text-primary">{ride.imuData.sampleRate} Hz</p>
                      </div>
                      <div>
                        <span className="text-secondary">Total Data Points</span>
                        <p className="font-medium text-primary">{ride.imuData.dataPoints.toLocaleString()}</p>
                      </div>
                    </>
                  )}
                  <div>
                    <span className="text-secondary">File Size</span>
                    <p className="font-medium text-primary">~{Math.round(ride.distance * 0.08)} MB</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
