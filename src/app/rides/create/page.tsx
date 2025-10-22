import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function CreateRidePage() {
  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <h1 className="text-3xl font-serif font-normal mb-8">Create Ride</h1>
      
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-serif">Ride Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Ride Name</label>
            <input
              type="text"
              placeholder="Morning training ride"
              className="w-full px-3 py-2 border border-border rounded-md"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Start Time</label>
              <input
                type="datetime-local"
                className="w-full px-3 py-2 border border-border rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">End Time</label>
              <input
                type="datetime-local"
                className="w-full px-3 py-2 border border-border rounded-md"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">Location</label>
            <input
              type="text"
              placeholder="San Francisco, CA"
              className="w-full px-3 py-2 border border-border rounded-md"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">Bike</label>
            <select className="w-full px-3 py-2 border border-border rounded-md">
              <option>Select bike...</option>
            </select>
          </div>
          
          <div className="pt-4">
            <Button className="w-full">Create Ride</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

