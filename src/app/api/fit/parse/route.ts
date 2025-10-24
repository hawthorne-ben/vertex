import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/inngest/client'

export const dynamic = 'force-dynamic'

/**
 * Trigger FIT file parsing
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { fileId } = body

    if (!fileId) {
      return NextResponse.json(
        { error: 'Missing fileId' },
        { status: 400 }
      )
    }

    // Get user ID from header
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json(
        { error: 'Missing user ID' },
        { status: 400 }
      )
    }

    console.log(`🚴‍♂️ Triggering FIT file parsing for file ${fileId}`)

    // Trigger FIT parsing job
    try {
      await inngest.send({
        name: 'fit/parse',
        data: {
          fileId,
          userId
        }
      })
      
      console.log(`✅ FIT parsing triggered for file ${fileId}`)
      
      return NextResponse.json({
        success: true,
        message: 'FIT parsing job triggered successfully'
      })
      
    } catch (inngestError) {
      console.error('Failed to trigger FIT parsing:', inngestError)
      return NextResponse.json(
        { error: 'Failed to trigger FIT parsing job' },
        { status: 500 }
      )
    }

  } catch (error) {
    console.error('FIT parse trigger error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
