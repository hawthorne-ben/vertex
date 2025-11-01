import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createAuthClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Get presigned URL for chunk upload
 * Requires authentication
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const authClient = await createAuthClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { fileId, chunkIndex, totalChunks, fileName, fileSize, mimeType } = body

    // Validate required fields
    if (!fileId || chunkIndex === undefined || !totalChunks || !fileName) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Generate unique storage path for this chunk
    const chunkFileName = `${fileId}_chunk_${chunkIndex.toString().padStart(3, '0')}`
    const storagePath = `chunks/${fileId}/${chunkFileName}`

    // Get presigned URL from Supabase Storage
    const { data, error } = await supabase.storage
      .from('uploads')
      .createSignedUploadUrl(storagePath, {
        upsert: false // Don't overwrite existing chunks
      })

    if (error) {
      console.error('Error creating presigned URL:', error)
      return NextResponse.json(
        { error: 'Failed to create upload URL' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      uploadUrl: data.signedUrl,
      storagePath,
      chunkIndex,
      totalChunks
    })

  } catch (error) {
    console.error('Chunk URL generation error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
