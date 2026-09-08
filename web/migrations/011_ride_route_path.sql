-- 011: Prerendered route-shape path on rides.
--
-- Why: the route thumbnail on the dashboard and rides list was drawn by
-- fetching /api/rides/[id]/samples, which downloads the ride's FIT file from
-- storage and parses it server-side on every request. The `fields` filter
-- trims the JSON response, not the work. One thumbnail per card on an
-- unpaginated list meant one full FIT parse per ride on page load.
--
-- The shape never changes once a ride is parsed, so it is computed once at
-- parse time and stored here. Thumbnails then cost nothing beyond the row the
-- list already reads.
--
-- route_path is a normalized SVG path in a fixed 0..1000 viewBox with aspect
-- ratio preserved (see src/lib/utils/route-path.ts). Storing it pre-projected
-- rather than as coordinates keeps consumers trivial; route_bounds is retained
-- so a future consumer can reproject or place the track on a real map without
-- re-parsing the FIT.
--
-- NULL means "no drawable track" — either no GPS, or fewer than two valid
-- fixes. Consumers render nothing in that case, which is the same behaviour as
-- before for GPS-less rides.

ALTER TABLE rides ADD COLUMN IF NOT EXISTS route_path TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS route_bounds JSONB;

COMMENT ON COLUMN rides.route_path IS
  'Normalized SVG path (viewBox 0 0 1000 1000, aspect preserved) of the ride''s GPS track, downsampled to ~150 points. NULL when the ride has no drawable track. Generated at FIT parse time by buildRoutePath().';

COMMENT ON COLUMN rides.route_bounds IS
  'Geographic bounds of route_path as {minLat, maxLat, minLon, maxLon}. Kept so the track can be reprojected or placed on a map without re-parsing the FIT file.';
