import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { inngest } from '@/inngest/client'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Complete chunked upload and trigger processing
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { fileId, fileName, fileSize, totalChunks, mimeType } = body

    // Validate required fields
    if (!fileId || !fileName || !fileSize || !totalChunks) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Get user ID from Supabase session
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized - No auth token' },
        { status: 401 }
      )
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      console.error('Auth error:', authError)
      return NextResponse.json(
        { error: 'Unauthorized - Invalid token' },
        { status: 401 }
      )
    }

    const userId = user.id

    // Verify all chunks exist in storage
    const chunkPaths = []
    for (let i = 0; i < totalChunks; i++) {
      const chunkFileName = `${fileId}_chunk_${i.toString().padStart(3, '0')}`
      const chunkPath = `chunks/${fileId}/${chunkFileName}`
      chunkPaths.push(chunkPath)
    }

    // Check if all chunks exist
    const { data: chunkFiles, error: listError } = await supabase.storage
      .from('uploads')
      .list(`chunks/${fileId}`)

    if (listError) {
      console.error('Error listing chunks:', listError)
      return NextResponse.json(
        { error: 'Failed to verify chunks' },
        { status: 500 }
      )
    }

    const existingChunks = chunkFiles?.map(f => f.name) || []
    const missingChunks = chunkPaths.filter(path => 
      !existingChunks.includes(path.split('/').pop()!)
    )

    if (missingChunks.length > 0) {
      return NextResponse.json(
        { error: `Missing chunks: ${missingChunks.join(', ')}` },
        { status: 400 }
      )
    }

    // Create file metadata record
    const { data: fileRecord, error: insertError } = await supabase
      .from('imu_data_files')
      .insert({
        user_id: userId,
        filename: fileName,
        file_size_bytes: fileSize,
        storage_path: `chunks/${fileId}`, // Points to chunk directory
        status: 'uploaded',
        chunk_count: totalChunks,
        chunk_size_bytes: Math.ceil(fileSize / totalChunks)
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error creating file record:', insertError)
      return NextResponse.json(
        { error: 'Failed to create file record' },
        { status: 500 }
      )
    }

    // Trigger processing for chunked files
    try {
      await inngest.send({
        name: 'imu/parse',
        data: {
          fileId: fileRecord.id,
          userId
        }
      })
      console.log(`✅ Processing triggered for file ${fileRecord.id}`)
    } catch (inngestError) {
      console.warn(`⚠️ Failed to trigger Inngest processing for file ${fileRecord.id}:`, inngestError)
      
      // Update file status to indicate manual processing needed
      await supabase
        .from('imu_data_files')
        .update({
          status: 'uploaded',
          error_message: 'Inngest not available - manual processing required'
        })
        .eq('id', fileRecord.id)
      
      // Don't fail the upload - just warn that processing needs to be triggered manually
      console.log(`📝 File ${fileRecord.id} uploaded successfully but requires manual processing trigger`)
    }

    return NextResponse.json({
      success: true,
      fileId: fileRecord.id,
      message: 'Chunked upload completed, processing started'
    })

  } catch (error) {
    console.error('Complete chunked upload error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
