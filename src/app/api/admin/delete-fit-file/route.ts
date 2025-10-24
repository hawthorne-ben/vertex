import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Delete FIT file and all associated data
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const { fileId } = body

    if (!fileId) {
      return NextResponse.json(
        { error: 'Missing fileId' },
        { status: 400 }
      )
    }

    console.log(`🗑️ Deleting FIT file ${fileId}`)

    // Get file record first to verify it exists
    const { data: fileRecord, error: fetchError } = await supabase
      .from('fit_files')
      .select('*')
      .eq('id', fileId)
      .single()

    if (fetchError || !fileRecord) {
      console.error('FIT file not found:', fetchError)
      return NextResponse.json(
        { error: 'FIT file not found' },
        { status: 404 }
      )
    }

    console.log(`📁 Found FIT file: ${fileRecord.filename}`)

    // Delete FIT data points first (due to foreign key constraint)
    const { error: dataPointsError } = await supabase
      .from('fit_data_points')
      .delete()
      .eq('fit_file_id', fileId)

    if (dataPointsError) {
      console.error('Error deleting FIT data points:', dataPointsError)
      return NextResponse.json(
        { error: 'Failed to delete FIT data points' },
        { status: 500 }
      )
    }

    console.log(`✅ Deleted FIT data points for file ${fileId}`)

    // Delete storage files (chunks)
    try {
      const { error: storageError } = await supabase.storage
        .from('uploads')
        .remove([fileRecord.storage_path])

      if (storageError) {
        console.warn('Warning: Failed to delete storage files:', storageError)
        // Don't fail the operation if storage cleanup fails
      } else {
        console.log(`✅ Deleted storage files for ${fileRecord.filename}`)
      }
    } catch (storageErr) {
      console.warn('Warning: Storage cleanup failed:', storageErr)
      // Continue with database cleanup
    }

    // Delete FIT file record
    const { error: fileError } = await supabase
      .from('fit_files')
      .delete()
      .eq('id', fileId)

    if (fileError) {
      console.error('Error deleting FIT file record:', fileError)
      return NextResponse.json(
        { error: 'Failed to delete FIT file record' },
        { status: 500 }
      )
    }

    console.log(`✅ Successfully deleted FIT file ${fileId}`)

    return NextResponse.json({
      success: true,
      message: `FIT file ${fileRecord.filename} deleted successfully`
    })

  } catch (error) {
    console.error('FIT file deletion error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
