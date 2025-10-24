import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

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

    // Step 2: Delete all associated samples (single query - CASCADE will handle this)
    // First, count the samples to report how many were deleted
    console.log(`🗑️ Checking sample count for file ${fileId}`)
    const { count, error: countError } = await supabase
      .from('imu_samples')
      .select('*', { count: 'exact', head: true })
      .eq('imu_file_id', fileId)
    
    if (countError) {
      console.error('Failed to count samples:', countError)
      // Non-critical, continue with deletion
    }
    
    const sampleCount = count || 0
    console.log(`📊 Found ${sampleCount} samples to delete`)
    
    // Delete all samples for this file in one query
    console.log(`🗑️ Deleting samples for file ${fileId}`)
    const { error: samplesDeleteError } = await supabase
      .from('imu_samples')
      .delete()
      .eq('imu_file_id', fileId)
    
    if (samplesDeleteError) {
      console.error('Failed to delete samples:', samplesDeleteError)
      return NextResponse.json({ 
        error: `Failed to delete samples: ${samplesDeleteError.message}` 
      }, { status: 500 })
    }
    
    console.log(`✅ Successfully deleted ${sampleCount} samples for file ${fileId}`)

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
      message: `File ${fileData.filename} and ${sampleCount} associated samples deleted successfully` 
    })

  } catch (error) {
    console.error('Error deleting file:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}
