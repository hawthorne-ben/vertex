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
    <div className="container mx-auto p-6">
      {/* Ride Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-normal mb-2">{ride.name}</h1>
        <div className="flex gap-4 text-stone-600">
          <span>{formatDate(ride.date)}</span>
          <span>•</span>
          <span>{ride.location}</span>
          <span>•</span>
          <span>{ride.bike}</span>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-stone-500 mb-1">Distance</div>
            <div className="text-2xl font-bold">{ride.distance} mi</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-stone-500 mb-1">Duration</div>
            <div className="text-2xl font-bold">{Math.round(ride.duration / 60)} min</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-stone-500 mb-1">Avg Speed</div>
            <div className="text-2xl font-bold">{ride.stats.avgSpeed} mph</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-stone-500 mb-1">Max Lean</div>
            <div className="text-2xl font-bold">{ride.stats.maxLeanAngle}°</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-stone-500 mb-1">Corners</div>
            <div className="text-2xl font-bold">{ride.stats.corners}</div>
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
                  <span className="text-stone-600">Max Speed</span>
                  <span className="font-medium">{ride.stats.maxSpeed} mph</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-600">Average Lean Angle</span>
                  <span className="font-medium">{ride.stats.avgLeanAngle}°</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-600">Max G-Force</span>
                  <span className="font-medium">{ride.stats.maxGForce}g</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-600">Braking Events</span>
                  <span className="font-medium">{ride.stats.brakingEvents}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl font-serif">Route Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-stone-600">Location</span>
                  <span className="font-medium">{ride.location}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-600">Conditions</span>
                  <span className="font-medium">{ride.conditions}</span>
                </div>
                {ride.gpsData && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-stone-600">Elevation Gain</span>
                      <span className="font-medium">{ride.gpsData.elevation.gain} ft</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-600">Max Elevation</span>
                      <span className="font-medium">{ride.gpsData.elevation.max} ft</span>
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
              <div className="h-64 bg-stone-100 rounded-md flex items-center justify-center">
                <p className="text-stone-500">Interactive map will be displayed here</p>
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
                <div className="h-80 bg-stone-100 rounded-md flex items-center justify-center">
                  <p className="text-stone-500">G-force visualization will be displayed here</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl font-serif">Lean Angle Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64 bg-stone-100 rounded-md flex items-center justify-center">
                  <p className="text-stone-500">Lean angle chart over time</p>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-stone-500">Average</span>
                    <p className="font-medium text-lg">{ride.stats.avgLeanAngle}°</p>
                  </div>
                  <div>
                    <span className="text-stone-500">Maximum</span>
                    <p className="font-medium text-lg">{ride.stats.maxLeanAngle}°</p>
                  </div>
                  <div>
                    <span className="text-stone-500">Data Points</span>
                    <p className="font-medium text-lg">{ride.imuData?.dataPoints.toLocaleString() || 'N/A'}</p>
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
                <div className="h-64 bg-stone-100 rounded-md flex items-center justify-center mb-6">
                  <p className="text-stone-500">Power/HR chart over time</p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-sm text-stone-500 mb-1">Avg Power</div>
                    <div className="text-2xl font-bold">{ride.powerData.avgPower}W</div>
                  </div>
                  <div>
                    <div className="text-sm text-stone-500 mb-1">Max Power</div>
                    <div className="text-2xl font-bold">{ride.powerData.maxPower}W</div>
                  </div>
                  <div>
                    <div className="text-sm text-stone-500 mb-1">Avg HR</div>
                    <div className="text-2xl font-bold">{ride.powerData.avgHeartRate} bpm</div>
                  </div>
                  <div>
                    <div className="text-sm text-stone-500 mb-1">Calories</div>
                    <div className="text-2xl font-bold">{ride.powerData.calories}</div>
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
                <button className="px-4 py-2 bg-stone-900 text-white rounded-md hover:bg-stone-800 transition-colors">
                  Download CSV
                </button>
                <button className="px-4 py-2 border border-stone-300 rounded-md hover:bg-stone-50 transition-colors">
                  Download FIT File
                </button>
                <button className="px-4 py-2 border border-stone-300 rounded-md hover:bg-stone-50 transition-colors">
                  Export Charts
                </button>
              </div>
              
              <div className="border-t border-stone-200 pt-4">
                <h3 className="font-medium mb-3">Data Summary</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  {ride.imuData && (
                    <>
                      <div>
                        <span className="text-stone-500">IMU Sample Rate</span>
                        <p className="font-medium">{ride.imuData.sampleRate} Hz</p>
                      </div>
                      <div>
                        <span className="text-stone-500">Total Data Points</span>
                        <p className="font-medium">{ride.imuData.dataPoints.toLocaleString()}</p>
                      </div>
                    </>
                  )}
                  <div>
                    <span className="text-stone-500">File Size</span>
                    <p className="font-medium">~{Math.round(ride.distance * 0.08)} MB</p>
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
