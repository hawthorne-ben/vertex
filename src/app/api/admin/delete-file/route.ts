import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function DELETE(request: NextRequest) {
  try {
    const { fileId } = await request.json()
    
    if (!fileId) {
      return NextResponse.json({ error: 'fileId is required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Step 1: Get file info before deletion
    const { data: fileData, error: fileError } = await supabase
      .from('imu_data_files')
      .select('*')
      .eq('id', fileId)
      .single()

    if (fileError || !fileData) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Step 2: Delete all associated samples first
    const { error: samplesError } = await supabase
      .from('imu_samples')
      .delete()
      .eq('imu_file_id', fileId)

    if (samplesError) {
      console.error('Failed to delete samples:', samplesError)
      return NextResponse.json({ error: 'Failed to delete samples' }, { status: 500 })
    }

    // Step 3: Delete the file record
    const { error: fileDeleteError } = await supabase
      .from('imu_data_files')
      .delete()
      .eq('id', fileId)

    if (fileDeleteError) {
      console.error('Failed to delete file record:', fileDeleteError)
      return NextResponse.json({ error: 'Failed to delete file record' }, { status: 500 })
    }

    // Step 4: Delete from storage (if storage_path exists)
    if (fileData.storage_path) {
      const { error: storageError } = await supabase.storage
        .from('uploads')
        .remove([fileData.storage_path])
      
      if (storageError) {
        console.warn('Storage deletion failed (non-critical):', storageError)
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `File ${fileData.filename} and all associated samples deleted successfully` 
    })

  } catch (error) {
    console.error('Error deleting file:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}
