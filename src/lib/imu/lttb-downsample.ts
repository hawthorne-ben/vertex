/**
 * LTTB (Largest Triangle Three Buckets) Downsampling Algorithm
 * 
 * Intelligently downsamples time series data while preserving visual features
 * (peaks, valleys, trends) better than naive sampling.
 * 
 * Reference: https://github.com/sveinn-steinarsson/flot-downsample
 */

interface DataPoint {
  timestamp: string | Date
  [key: string]: number | string | Date | null
}

/**
 * Downsample a dataset using the LTTB algorithm
 * 
 * @param data - Array of data points with at least a timestamp field
 * @param threshold - Target number of points after downsampling
 * @returns Downsampled array
 */
export function downsampleLTTB<T extends DataPoint>(
  data: T[],
  threshold: number
): T[] {
  if (threshold >= data.length || threshold <= 2) {
    return data // No downsampling needed
  }

  const dataLength = data.length
  const bucketSize = (dataLength - 2) / (threshold - 2)

  const sampled: T[] = []
  sampled.push(data[0]) // Always include first point

  let sampledIndex = 0

  for (let i = 0; i < threshold - 2; i++) {
    // Calculate point average for next bucket (for a)
    let avgX = 0
    let avgRangeStart = Math.floor((i + 1) * bucketSize) + 1
    let avgRangeEnd = Math.floor((i + 2) * bucketSize) + 1
    
    if (avgRangeEnd >= dataLength) {
      avgRangeEnd = dataLength
    }

    const avgRangeLength = avgRangeEnd - avgRangeStart

    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += getTimestamp(data[j])
    }
    avgX /= avgRangeLength

    // Get the range for this bucket
    let rangeOffs = Math.floor(i * bucketSize) + 1
    const rangeTo = Math.floor((i + 1) * bucketSize) + 1

    // Point a (previous selected point)
    const pointAX = getTimestamp(data[sampledIndex])

    let maxArea = -1
    let maxAreaPoint: T | null = null
    let nextSampledIndex = 0

    for (let j = rangeOffs; j < rangeTo; j++) {
      // Calculate triangle area over three buckets
      const pointBX = getTimestamp(data[j])

      // Calculate the area of the triangle formed by point a, this point, and the average of the next bucket
      // Area = 0.5 * |x1(y2 - y3) + x2(y3 - y1) + x3(y1 - y2)|
      // Simplified for time series (y-values are implicit indices)
      const area = Math.abs(
        (pointAX - avgX) * (j - sampledIndex) +
        (pointBX - pointAX) * (sampledIndex - i - 1) +
        (avgX - pointBX) * (i + 1 - j)
      )

      if (area > maxArea) {
        maxArea = area
        maxAreaPoint = data[j]
        nextSampledIndex = j
      }
    }

    if (maxAreaPoint) {
      sampled.push(maxAreaPoint)
      sampledIndex = nextSampledIndex
    }
  }

  sampled.push(data[dataLength - 1]) // Always include last point

  return sampled
}

/**
 * Helper to extract numeric timestamp from a data point
 */
function getTimestamp(point: DataPoint): number {
  const ts = point.timestamp
  if (typeof ts === 'string') {
    return new Date(ts).getTime()
  } else if (ts instanceof Date) {
    return ts.getTime()
  }
  return 0
}

/**
 * Downsample multiple series data (e.g., X/Y/Z axes) consistently
 * Uses the same sampling points for all series based on primary metric
 * 
 * @param data - Array of data points
 * @param threshold - Target number of points
 * @param primaryMetric - Metric to use for LTTB calculation (default: first numeric field)
 * @returns Downsampled array with all fields preserved
 */
export function downsampleMultiSeries<T extends DataPoint>(
  data: T[],
  threshold: number,
  primaryMetric?: keyof T
): T[] {
  if (threshold >= data.length || threshold <= 2) {
    return data
  }

  // For multi-series IMU data, we want to preserve the same time points
  // across all axes, so we use LTTB on the magnitude or a primary metric
  
  // If no primary metric specified, calculate magnitude from first 3 numeric fields
  if (!primaryMetric) {
    const numericFields = Object.keys(data[0]).filter(
      key => key !== 'timestamp' && typeof data[0][key] === 'number'
    )
    
    if (numericFields.length >= 3) {
      // Calculate magnitude for LTTB (preserves peaks across all axes)
      const dataWithMagnitude = data.map(point => {
        const x = point[numericFields[0]] as number
        const y = point[numericFields[1]] as number
        const z = point[numericFields[2]] as number
        return {
          ...point,
          _magnitude: Math.sqrt(x * x + y * y + z * z)
        }
      })
      
      const sampled = downsampleLTTB(dataWithMagnitude, threshold)
      
      // Remove temporary magnitude field
      return sampled.map(({ _magnitude, ...rest }) => rest as unknown as T)
    }
  }

  // Fallback to simple LTTB on primary metric or first field
  return downsampleLTTB(data, threshold)
}

