import { describeRoughness } from '@/lib/utils/formatting'

export interface HeroInsights {
  /** One human-readable sentence about the latest ride vs. recent form (D1). */
  summary: string | null
  /** Streak highlight, e.g. "3rd straight week improving" (D4), or null. */
  streak: string | null
}

interface SummaryRow {
  ride_started_at: string
  avg_stability_percent: number | null
  avg_roughness: number | null
}

/**
 * FIT-derived facts about the latest ride, used to build a reasonable summary
 * sentence when the latest ride has no IMU (stability/roughness) analysis.
 */
export interface LatestRideFacts {
  distance_meters: number | null
  elevation_gain_meters: number | null
  duration_seconds: number | null
  riding_time_seconds: number | null
  /** True when this ride has an IMU analysis summary (stability available). */
  hasImuData: boolean
}

/**
 * Compute the dashboard hero's human summary sentence (D1) and streak
 * highlight (D4) from the user's recent ride summaries. Pure function over
 * rows so it is trivially testable; the caller supplies the query result.
 *
 * `rows` must be ordered by ride_started_at ASCENDING and contain only rides
 * that HAVE IMU stability data. When the latest ride lacks IMU data, pass
 * `latest` so the sentence falls back to FIT-only facts instead of describing
 * an older ride as if it were the latest.
 */
export function computeHeroInsights(rows: SummaryRow[], latestFacts?: LatestRideFacts): HeroInsights {
  // If the latest ride has no IMU data, the stability history (which excludes
  // it) describes an older ride — that's misleading. Fall back to a FIT-only
  // sentence about the latest ride instead.
  if (latestFacts && !latestFacts.hasImuData) {
    return { summary: describeFitOnlyRide(latestFacts), streak: null }
  }

  const stabilityRows = rows.filter(r => r.avg_stability_percent != null)
  if (stabilityRows.length === 0) {
    return { summary: latestFacts ? describeFitOnlyRide(latestFacts) : null, streak: null }
  }

  const latest = stabilityRows[stabilityRows.length - 1]
  const latestStability = latest.avg_stability_percent as number

  // Baseline = average of the prior rides (excluding the latest), so the
  // sentence compares "this ride" against "your recent form".
  const prior = stabilityRows.slice(0, -1)
  const priorAvg = prior.length
    ? prior.reduce((s, r) => s + (r.avg_stability_percent as number), 0) / prior.length
    : null

  const parts: string[] = []

  if (priorAvg != null) {
    const delta = latestStability - priorAvg
    if (delta >= 3) {
      parts.push(`your steadiest riding in a while — stability up ${Math.round(delta)} points`)
    } else if (delta <= -3) {
      parts.push(`a shakier ride than usual — stability down ${Math.round(-delta)} points`)
    } else {
      parts.push(`stability held steady around ${Math.round(latestStability)}%`)
    }
  } else {
    parts.push(`stability came in at ${Math.round(latestStability)}%`)
  }

  // Roughness clause, if available.
  if (latest.avg_roughness != null) {
    const roughnessRows = rows.filter(r => r.avg_roughness != null)
    const roughPrior = roughnessRows.slice(0, -1)
    const roughAvg = roughPrior.length
      ? roughPrior.reduce((s, r) => s + (r.avg_roughness as number), 0) / roughPrior.length
      : null
    if (roughAvg != null && latest.avg_roughness < roughAvg - 0.05) {
      parts.push('and roads were smoother than usual')
    } else if (roughAvg != null && latest.avg_roughness > roughAvg + 0.05) {
      parts.push('and the roads were rougher than usual')
    } else {
      parts.push(`on ${describeRoughness(latest.avg_roughness).toLowerCase()}`)
    }
  }

  const sentence = parts.join(' ')
  const summary = sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.'

  return { summary, streak: computeStreak(stabilityRows) }
}

/**
 * A streak of consecutive rides where stability improved over the previous
 * ride. Reported only when it's genuinely notable (3+).
 */
function computeStreak(stabilityRows: SummaryRow[]): string | null {
  if (stabilityRows.length < 3) return null
  let streak = 0
  for (let i = stabilityRows.length - 1; i > 0; i--) {
    const cur = stabilityRows[i].avg_stability_percent as number
    const prev = stabilityRows[i - 1].avg_stability_percent as number
    if (cur > prev) streak++
    else break
  }
  if (streak < 2) return null
  // streak counts improving *transitions*; +1 for the ride count reads naturally.
  return `${streak + 1} rides improving in a row`
}

/**
 * Build a summary sentence for a ride with no IMU analysis, using only FIT
 * facts (distance / elevation / moving time). Keeps the hero informative
 * without implying stability/road data that doesn't exist.
 */
function describeFitOnlyRide(latest: LatestRideFacts): string | null {
  const clauses: string[] = []

  if (latest.distance_meters != null && latest.distance_meters > 0) {
    const miles = latest.distance_meters * 0.000621371
    clauses.push(`covered ${miles.toFixed(1)} mi`)
  }

  const moving = latest.riding_time_seconds ?? latest.duration_seconds
  if (moving != null && moving > 0) {
    const mins = Math.round(moving / 60)
    const timeStr = mins >= 60
      ? `${Math.floor(mins / 60)}h ${mins % 60}m`
      : `${mins}m`
    clauses.push(`in ${timeStr}`)
  }

  if (latest.elevation_gain_meters != null && latest.elevation_gain_meters > 0) {
    const feet = Math.round(latest.elevation_gain_meters * 3.28084)
    clauses.push(`with ${feet.toLocaleString()} ft of climbing`)
  }

  if (clauses.length === 0) {
    return 'Ride recorded — connect an IMU sensor to see stability and road data.'
  }

  const sentence = `You ${clauses.join(' ')}`
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.'
}
