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
 * Compute the dashboard hero's human summary sentence (D1) and streak
 * highlight (D4) from the user's recent ride summaries. Pure function over
 * rows so it is trivially testable; the caller supplies the query result.
 *
 * `rows` must be ordered by ride_started_at ASCENDING.
 */
export function computeHeroInsights(rows: SummaryRow[]): HeroInsights {
  const stabilityRows = rows.filter(r => r.avg_stability_percent != null)
  if (stabilityRows.length === 0) {
    return { summary: null, streak: null }
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
