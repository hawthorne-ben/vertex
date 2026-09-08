/**
 * The exact columns the recordings list renders.
 *
 * Shared between the server component that renders page 1 and the API route
 * that serves later pages, so the two cannot drift into returning
 * differently-shaped rows.
 */
export const RECORDING_LIST_SELECT =
  'id, filename, status, file_size_bytes, start_time, end_time, sample_count, sample_rate, error_message, uploaded_at'

/** Default rows per page. Mirrors the client's DEFAULT_PAGE_SIZE. */
export const RECORDING_LIST_PAGE_SIZE = 10
