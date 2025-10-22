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
    try {
      await inngest.send({
        name: 'imu/parse',
        data: { 
          fileId,
          userId: user.id
        }
      })
      console.log(`✅ Parse job triggered for file ${fileId}`)
    } catch (inngestError) {
      console.warn(`⚠️ Failed to trigger Inngest parse job for file ${fileId}:`, inngestError)
      
      // Update file status to indicate manual processing needed
      await supabase
        .from('imu_data_files')
        .update({
          status: 'uploaded',
          error_message: 'Inngest not available - manual processing required'
        })
        .eq('id', fileId)
      
      return NextResponse.json({ 
        status: 'uploaded',
        fileId,
        message: 'File uploaded but requires manual processing trigger'
      })
    }

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

