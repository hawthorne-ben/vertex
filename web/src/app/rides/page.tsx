import { createClient } from '@/lib/supabase/server'
import { RidesListClient } from '@/components/rides-list-client'


export default async function RidesPage() {
  const supabase = await createClient()

  // Get current user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return <div>Please log in to view rides</div>
  }

  // Fetch all rides for the user with their associated FIT recordings
  const { data: rides, error: ridesError } = await supabase
    .from('rides')
    .select(`
      *,
      ride_recordings (
        recording_id,
        recordings (
          id,
          filename,
          file_type,
          storage_path,
          analysis_results
        )
      )
    `)
    .eq('user_id', user.id)
    .order('start_time', { ascending: false })

  if (ridesError) {
    console.error('Failed to fetch rides:', ridesError)
    return <div>Failed to load rides</div>
  }

  // Transform the data to include FIT recording info
  const ridesWithRecordings = (rides || []).map(ride => {
    // Find the FIT recording (there should be exactly one per ride for now)
    const fitRecording = ride.ride_recordings?.find(
      (rr: any) => rr.recordings?.file_type === 'fit'
    )?.recordings

    return {
      ...ride,
      fit_recording_id: fitRecording?.id || null,
      fit_filename: fitRecording?.filename || null,
      fit_storage_path: fitRecording?.storage_path || null,
      analysis_results: fitRecording?.analysis_results || {}
    }
  })

  return (
    <div className="container mx-auto px-4 md:px-6 max-w-6xl">
      <RidesListClient rides={ridesWithRecordings} />
    </div>
  )
}