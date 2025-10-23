import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/inngest/client'

/**
 * Trigger streaming IMU file processing
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { fileId } = body

    if (!fileId) {
      return NextResponse.json(
        { error: 'Missing fileId' },
        { status: 400 }
      )
    }

    // Get user ID from request (you'll need to implement proper auth)
    const userId = req.headers.get('x-user-id') // Placeholder - implement proper auth
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Trigger parse job
    try {
      await inngest.send({
        name: 'imu/parse',
        data: { 
          fileId,
          userId 
        }
      })
      console.log(`✅ Parse job triggered for file ${fileId}`)
      
      return NextResponse.json({
        success: true,
        message: 'Streaming processing started',
        fileId
      })
    } catch (inngestError) {
      console.warn(`⚠️ Failed to trigger Inngest streaming parse job for file ${fileId}:`, inngestError)
      
      return NextResponse.json({
        success: false,
        message: 'Inngest not available - manual processing required',
        fileId,
        error: 'Inngest service unavailable'
      }, { status: 503 })
    }

  } catch (error) {
    console.error('Streaming parse trigger error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
