import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/inngest/client'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { fileId } = await req.json()
    
    if (!fileId) {
      return NextResponse.json(
        { error: 'fileId is required' },
        { status: 400 }
      )
    }

    // Verify file exists and belongs to user
    const { data: file, error: fileError } = await supabase
      .from('imu_data_files')
      .select('id, user_id')
      .eq('id', fileId)
      .single()

    if (fileError || !file) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      )
    }

    if (file.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Trigger Inngest job
    await inngest.send({
      name: 'imu/parse',
      data: { 
        fileId,
        userId: user.id
      }
    })

    return NextResponse.json({ 
      status: 'parsing_queued',
      fileId 
    })
  } catch (err) {
    console.error('Parse trigger error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

