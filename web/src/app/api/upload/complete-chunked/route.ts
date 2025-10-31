import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Complete chunked upload - delegates to /api/upload/recording
 * This endpoint exists for backward compatibility with the chunking client
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const authHeader = request.headers.get('authorization')

    // Forward to the new recording upload endpoint
    const recordingUrl = new URL('/api/upload/recording', request.url)
    const response = await fetch(recordingUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader || ''
      },
      body: JSON.stringify(body)
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status })
    }

    // Return response in format expected by client
    return NextResponse.json({
      success: true,
      fileId: data.recordingId,
      message: data.message
    })

  } catch (error) {
    console.error('Complete chunked upload error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
