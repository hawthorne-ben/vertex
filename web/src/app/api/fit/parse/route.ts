import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/inngest/client'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Trigger FIT file parsing
 * Requires authentication via Bearer token
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate user properly
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { fileId } = body

    if (!fileId) {
      return NextResponse.json(
        { error: 'Missing fileId' },
        { status: 400 }
      )
    }

    // Verify user owns this file (security check)
    const { data: recording, error: fetchError } = await supabase
      .from('recordings')
      .select('id, user_id')
      .eq('id', fileId)
      .single()

    if (fetchError || !recording) {
      return NextResponse.json(
        { error: 'Recording not found' },
        { status: 404 }
      )
    }

    if (recording.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Access denied - you do not own this recording' },
        { status: 403 }
      )
    }

    console.log(`🚴‍♂️ Triggering FIT file parsing for file ${fileId}`)

    // Trigger FIT parsing job
    try {
      await inngest.send({
        name: 'fit/parse',
        data: {
          fileId,
          userId: user.id
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
