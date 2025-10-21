import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default async function RideDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  
  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-normal mb-2">Ride Details</h1>
        <p className="text-neutral-600">Ride ID: {id}</p>
      </div>
      
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="imu">IMU Analysis</TabsTrigger>
          <TabsTrigger value="power">Power</TabsTrigger>
          <TabsTrigger value="data">Raw Data</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-neutral-600">Max Lean Angle</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-mono font-semibold">--°</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-neutral-600">Max Lateral G</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-mono font-semibold">-- g</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-neutral-600">Braking Events</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-mono font-semibold">--</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        <TabsContent value="imu">
          <Card>
            <CardContent className="py-12">
              <p className="text-center text-neutral-600">IMU analysis will be displayed here</p>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="power">
          <Card>
            <CardContent className="py-12">
              <p className="text-center text-neutral-600">Power analysis will be displayed here</p>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="data">
          <Card>
            <CardContent className="py-12">
              <p className="text-center text-neutral-600">Raw data export options will be displayed here</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

