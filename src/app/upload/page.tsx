import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function UploadPage() {
  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-serif font-normal mb-8">Upload Data</h1>
      
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-serif">Upload IMU or FIT Files</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border-2 border-dashed border-neutral-300 rounded-lg p-12 text-center">
            <p className="text-neutral-600 mb-4">
              Drag and drop files here, or click to select
            </p>
            <p className="text-sm text-neutral-500 mb-6">
              Supports .csv (IMU data) and .fit (cycling computer data)
            </p>
            <Button>Select Files</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-xl font-serif">Recent Uploads</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-neutral-600 text-center py-8">
            No files uploaded yet
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

