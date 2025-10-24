'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, Bike, FileText, Zap, CheckCircle, AlertCircle, Clock } from 'lucide-react'

interface ImuFile {
  id: string
  filename: string
  start_time: string
  end_time: string
  file_size_bytes: number
  sample_count: number
  associated_fit_file_id?: string
  association_confidence?: number
}

interface FitFile {
  id: string
  filename: string
  start_time: string | null
  end_time: string | null
  distance_feet: number | null
  elevation_gain_feet: number | null
  avg_speed_mph: number | null
  associated_imu_file_id?: string
  association_confidence?: number
}

interface RideMatch {
  imuFileId: string
  imuFilename: string
  confidence: number
  level: string
  color: string
  overlap: {
    start: string
    end: string
    durationMinutes: number
    imuCoverage: number
    fitCoverage: number
  }
  validation: {
    valid: boolean
    errors: string[]
    warnings: string[]
    suggestions: string[]
  }
}

export default function RideBuilder() {
  const [imuFiles, setImuFiles] = useState<ImuFile[]>([])
  const [fitFiles, setFitFiles] = useState<FitFile[]>([])
  const [selectedImuFile, setSelectedImuFile] = useState<string>('')
  const [selectedFitFile, setSelectedFitFile] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [isCreatingRide, setIsCreatingRide] = useState(false)
  const [ridePreview, setRidePreview] = useState<RideMatch | null>(null)
  const [error, setError] = useState<string>('')
  const [activeTab, setActiveTab] = useState('select')

  // Load data files
  useEffect(() => {
    loadDataFiles()
  }, [])

  const loadDataFiles = async () => {
    setIsLoading(true)
    try {
      // Load IMU files
      const imuResponse = await fetch('/api/data/imu')
      const imuData = await imuResponse.json()
      setImuFiles(imuData.files || [])

      // Load FIT files
      const fitResponse = await fetch('/api/data/fit')
      const fitData = await fitResponse.json()
      setFitFiles(fitData.files || [])
    } catch (error) {
      console.error('Failed to load data files:', error)
      setError('Failed to load data files')
    } finally {
      setIsLoading(false)
    }
  }

  const previewRide = async () => {
    if (!selectedImuFile || !selectedFitFile) {
      setError('Please select both IMU and FIT files')
      return
    }

    setIsLoading(true)
    setError('')
    
    try {
      const response = await fetch('/api/rides/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imuFileId: selectedImuFile,
          fitFileId: selectedFitFile
        })
      })

      const data = await response.json()
      
      if (response.ok) {
        setRidePreview(data.preview)
        setActiveTab('preview') // Automatically switch to preview tab
      } else {
        setError(data.error || 'Failed to preview ride')
      }
    } catch (error) {
      console.error('Ride preview failed:', error)
      setError('Failed to preview ride')
    } finally {
      setIsLoading(false)
    }
  }

  const createRide = async () => {
    if (!selectedImuFile || !selectedFitFile) {
      setError('Please select both IMU and FIT files')
      return
    }

    setIsCreatingRide(true)
    setError('')
    
    try {
      const response = await fetch('/api/rides/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imuFileId: selectedImuFile,
          fitFileId: selectedFitFile
        })
      })

      const data = await response.json()
      
      if (response.ok) {
        // Success - redirect to rides page or show success message
        window.location.href = '/rides'
      } else {
        setError(data.error || 'Failed to create ride')
      }
    } catch (error) {
      console.error('Ride creation failed:', error)
      setError('Failed to create ride')
    } finally {
      setIsCreatingRide(false)
    }
  }

  const getConfidenceBadgeColor = (confidence: number) => {
    if (confidence >= 0.8) return 'bg-green-100 text-green-800'
    if (confidence >= 0.6) return 'bg-yellow-100 text-yellow-800'
    if (confidence >= 0.4) return 'bg-orange-100 text-orange-800'
    return 'bg-red-100 text-red-800'
  }

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60)
    const mins = Math.round(minutes % 60)
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
  }

  const formatFileSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024)
    return `${mb.toFixed(1)} MB`
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Ride Builder</h1>
          <p className="text-gray-600">
            Combine your IMU sensor data with FIT file ride data to create comprehensive ride analysis.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center">
              <AlertCircle className="h-5 w-5 text-red-500 mr-2" />
              <span className="text-red-700">{error}</span>
            </div>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="select">Select Data Sources</TabsTrigger>
            <TabsTrigger value="preview" disabled={!selectedImuFile || !selectedFitFile}>
              Preview Ride
            </TabsTrigger>
          </TabsList>

          <TabsContent value="select" className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              {/* IMU Files */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <FileText className="h-5 w-5 mr-2" />
                    IMU Sensor Data
                  </CardTitle>
                  <CardDescription>
                    Select IMU data file containing sensor measurements
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {imuFiles
                        .filter(file => !file.associated_fit_file_id) // Only unassociated files
                        .map(file => (
                        <div
                          key={file.id}
                          className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                            selectedImuFile === file.id
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                          onClick={() => setSelectedImuFile(file.id)}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium">{file.filename}</div>
                              <div className="text-sm text-gray-500">
                                {formatFileSize(file.file_size_bytes)} • {file.sample_count.toLocaleString()} samples
                              </div>
                              <div className="text-sm text-gray-500">
                                {new Date(file.start_time).toLocaleString()} - {new Date(file.end_time).toLocaleString()}
                              </div>
                            </div>
                            {file.association_confidence && (
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getConfidenceBadgeColor(file.association_confidence)}`}>
                                {(file.association_confidence * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                      {imuFiles.filter(file => !file.associated_fit_file_id).length === 0 && (
                        <div className="text-center py-8 text-gray-500">
                          No unassociated IMU files found
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* FIT Files */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Bike className="h-5 w-5 mr-2" />
                    FIT Ride Data
                  </CardTitle>
                  <CardDescription>
                    Select FIT file containing GPS and ride metrics
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {fitFiles
                        .filter(file => !file.associated_imu_file_id) // Only unassociated files
                        .map(file => (
                        <div
                          key={file.id}
                          className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                            selectedFitFile === file.id
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                          onClick={() => setSelectedFitFile(file.id)}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium">{file.filename}</div>
                              <div className="text-sm text-gray-500">
                                {file.distance_feet ? `${(file.distance_feet / 5280).toFixed(1)} mi` : 'Distance unknown'} • {file.elevation_gain_feet ? `${file.elevation_gain_feet.toFixed(0)} ft ascent` : 'Elevation unknown'}
                              </div>
                              <div className="text-sm text-gray-500">
                                {file.avg_speed_mph ? `${file.avg_speed_mph.toFixed(1)} mph avg` : 'Speed unknown'}
                              </div>
                            </div>
                            {file.association_confidence && (
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getConfidenceBadgeColor(file.association_confidence)}`}>
                                {(file.association_confidence * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                      {fitFiles.filter(file => !file.associated_imu_file_id).length === 0 && (
                        <div className="text-center py-8 text-gray-500">
                          No unassociated FIT files found
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-center">
              <Button 
                onClick={previewRide}
                disabled={!selectedImuFile || !selectedFitFile || isLoading}
                className="px-8"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4 mr-2" />
                    Preview Ride
                  </>
                )}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="preview" className="space-y-6">
            {ridePreview ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <CheckCircle className="h-5 w-5 mr-2 text-green-500" />
                    Ride Preview
                  </CardTitle>
                  <CardDescription>
                    Review the ride association before creating
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Confidence Score */}
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div>
                      <div className="font-medium">Association Confidence</div>
                      <div className="text-sm text-gray-600">
                        {ridePreview.level} quality match
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getConfidenceBadgeColor(ridePreview.confidence)} text-lg px-4 py-2`}>
                      {(ridePreview.confidence * 100).toFixed(1)}%
                    </span>
                  </div>

                  {/* Overlap Details */}
                  <div className="grid md:grid-cols-3 gap-4">
                    <div className="p-4 border rounded-lg">
                      <div className="flex items-center mb-2">
                        <Clock className="h-4 w-4 mr-2 text-gray-500" />
                        <span className="font-medium">Overlap Duration</span>
                      </div>
                      <div className="text-2xl font-bold">
                        {formatDuration(ridePreview.overlap.durationMinutes)}
                      </div>
                    </div>
                    <div className="p-4 border rounded-lg">
                      <div className="font-medium mb-2">IMU Coverage</div>
                      <div className="text-2xl font-bold">
                        {(ridePreview.overlap.imuCoverage * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="p-4 border rounded-lg">
                      <div className="font-medium mb-2">FIT Coverage</div>
                      <div className="text-2xl font-bold">
                        {(ridePreview.overlap.fitCoverage * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>

                  {/* Validation Warnings */}
                  {ridePreview.validation.warnings.length > 0 && (
                    <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <div className="font-medium text-yellow-800 mb-2">Warnings</div>
                      <ul className="text-sm text-yellow-700 space-y-1">
                        {ridePreview.validation.warnings.map((warning, index) => (
                          <li key={index}>• {warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Create Ride Button */}
                  <div className="flex justify-center">
                    <Button 
                      onClick={createRide}
                      disabled={isCreatingRide || !ridePreview.validation.valid}
                      className="px-8"
                    >
                      {isCreatingRide ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Creating Ride...
                        </>
                      ) : (
                        <>
                          <Bike className="h-4 w-4 mr-2" />
                          Create Ride
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="text-center py-8 text-gray-500">
                Click "Preview Ride" to analyze the data association
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
