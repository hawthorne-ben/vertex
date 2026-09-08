/**
 * The exact columns the rides list renders.
 *
 * Deliberately not `*`. The rides table carries fields no card reads —
 * description, notes, conditions, merged_vtx_path, route_bounds — and
 * route_path alone is ~1.5 KB per row. Selecting everything made the list
 * payload roughly 2.5 KB per ride, which is fine at 50 rides and not at 500.
 *
 * Shared between the server component that renders page 1 and the API route
 * that serves later pages, so the two can never drift into returning
 * differently-shaped rows.
 */
export const RIDE_LIST_SELECT = `
  id,
  user_id,
  name,
  start_time,
  end_time,
  duration_seconds,
  distance_meters,
  elevation_gain_meters,
  route_path,
  created_at,
  updated_at,
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
`

/** Default rows per page. Mirrors the client's DEFAULT_PAGE_SIZE. */
export const RIDE_LIST_PAGE_SIZE = 10

/**
 * Flatten the joined shape into what RideCard expects: the FIT recording's
 * filename/path lifted onto the ride, and analysis_results promoted from the
 * recording. Used by both the first-page server render and the paged route.
 */
export function toRideListRow(ride: any) {
  const fitRecording = ride.ride_recordings?.find(
    (rr: any) => rr.recordings?.file_type === 'fit',
  )?.recordings

  const { ride_recordings, ...rideFields } = ride

  return {
    ...rideFields,
    fit_recording_id: fitRecording?.id ?? null,
    fit_filename: fitRecording?.filename ?? null,
    fit_storage_path: fitRecording?.storage_path ?? null,
    analysis_results: fitRecording?.analysis_results ?? {},
  }
}
