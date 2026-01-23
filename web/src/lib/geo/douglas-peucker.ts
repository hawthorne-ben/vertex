/**
 * Douglas-Peucker algorithm for polyline simplification
 * Reduces the number of points in a GPS track while preserving its shape
 *
 * @param points Array of [lat, lon] coordinates
 * @param epsilon Tolerance in degrees (larger = more aggressive simplification)
 * @returns Simplified array of [lat, lon] coordinates
 */
export function douglasPeucker(
  points: [number, number][],
  epsilon: number = 0.0001 // ~11 meters at equator
): [number, number][] {
  if (points.length <= 2) {
    return points
  }

  // Find the point with maximum distance from the line segment
  let maxDistance = 0
  let maxIndex = 0
  const end = points.length - 1

  for (let i = 1; i < end; i++) {
    const distance = perpendicularDistance(points[i], points[0], points[end])
    if (distance > maxDistance) {
      maxDistance = distance
      maxIndex = i
    }
  }

  // If max distance is greater than epsilon, recursively simplify
  if (maxDistance > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), epsilon)
    const right = douglasPeucker(points.slice(maxIndex), epsilon)

    // Concatenate results, removing duplicate middle point
    return [...left.slice(0, -1), ...right]
  } else {
    // All points between start and end can be removed
    return [points[0], points[end]]
  }
}

/**
 * Calculate perpendicular distance from a point to a line segment
 */
function perpendicularDistance(
  point: [number, number],
  lineStart: [number, number],
  lineEnd: [number, number]
): number {
  const [px, py] = point
  const [x1, y1] = lineStart
  const [x2, y2] = lineEnd

  const dx = x2 - x1
  const dy = y2 - y1

  // Handle degenerate case where line segment is a point
  if (dx === 0 && dy === 0) {
    return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
  }

  // Calculate perpendicular distance
  const numerator = Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1)
  const denominator = Math.sqrt(dx ** 2 + dy ** 2)

  return numerator / denominator
}

/**
 * Simplify GPS track with metadata preservation
 * Returns simplified points with mapping to original indices
 */
export function simplifyGPSTrack<T extends { lat: number; lon: number }>(
  track: T[],
  epsilon: number = 0.0001
): { simplified: T[]; originalIndices: number[] } {
  if (track.length <= 2) {
    return {
      simplified: track,
      originalIndices: track.map((_, i) => i),
    }
  }

  // Convert to coordinate pairs with indices
  const points: [number, number][] = track.map(p => [p.lat, p.lon])
  const indices: number[] = track.map((_, i) => i)

  // Run simplification with index tracking
  const result = douglasPeuckerWithIndices(points, indices, epsilon)

  return {
    simplified: result.indices.map(i => track[i]),
    originalIndices: result.indices,
  }
}

/**
 * Douglas-Peucker with index tracking
 */
function douglasPeuckerWithIndices(
  points: [number, number][],
  indices: number[],
  epsilon: number
): { points: [number, number][]; indices: number[] } {
  if (points.length <= 2) {
    return { points, indices }
  }

  let maxDistance = 0
  let maxIndex = 0
  const end = points.length - 1

  for (let i = 1; i < end; i++) {
    const distance = perpendicularDistance(points[i], points[0], points[end])
    if (distance > maxDistance) {
      maxDistance = distance
      maxIndex = i
    }
  }

  if (maxDistance > epsilon) {
    const left = douglasPeuckerWithIndices(
      points.slice(0, maxIndex + 1),
      indices.slice(0, maxIndex + 1),
      epsilon
    )
    const right = douglasPeuckerWithIndices(
      points.slice(maxIndex),
      indices.slice(maxIndex),
      epsilon
    )

    return {
      points: [...left.points.slice(0, -1), ...right.points],
      indices: [...left.indices.slice(0, -1), ...right.indices],
    }
  } else {
    return {
      points: [points[0], points[end]],
      indices: [indices[0], indices[end]],
    }
  }
}
