'use client'

import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface IMUSample {
  timestamp: string
  accel_x: number
  accel_y: number
  accel_z: number
  gyro_x: number
  gyro_y: number
  gyro_z: number
  mag_x?: number | null
  mag_y?: number | null
  mag_z?: number | null
}

interface IMUDataChartsProps {
  samples: IMUSample[]
}

type DataType = 'accel' | 'gyro' | 'mag'

export function IMUDataCharts({ samples }: IMUDataChartsProps) {
  const [dataType, setDataType] = useState<DataType>('accel')

  // Check if magnetometer data exists
  const hasMagData = samples.some(s => s.mag_x !== null && s.mag_y !== null && s.mag_z !== null)

  // Transform data for charts
  const chartData = samples.map((sample, index) => {
    const timestamp = new Date(sample.timestamp)
    const firstTimestamp = new Date(samples[0].timestamp)
    const relativeTime = (timestamp.getTime() - firstTimestamp.getTime()) / 1000 // seconds

    return {
      index,
      time: relativeTime,
      accel_x: sample.accel_x,
      accel_y: sample.accel_y,
      accel_z: sample.accel_z,
      gyro_x: sample.gyro_x,
      gyro_y: sample.gyro_y,
      gyro_z: sample.gyro_z,
      mag_x: sample.mag_x,
      mag_y: sample.mag_y,
      mag_z: sample.mag_z
    }
  })

  const getChartConfig = () => {
    switch (dataType) {
      case 'accel':
        return {
          title: 'Accelerometer',
          unit: 'm/s²',
          lines: [
            { key: 'accel_x', color: '#ef4444', name: 'X' },
            { key: 'accel_y', color: '#22c55e', name: 'Y' },
            { key: 'accel_z', color: '#3b82f6', name: 'Z' }
          ]
        }
      case 'gyro':
        return {
          title: 'Gyroscope',
          unit: 'rad/s',
          lines: [
            { key: 'gyro_x', color: '#ef4444', name: 'X' },
            { key: 'gyro_y', color: '#22c55e', name: 'Y' },
            { key: 'gyro_z', color: '#3b82f6', name: 'Z' }
          ]
        }
      case 'mag':
        return {
          title: 'Magnetometer',
          unit: 'µT',
          lines: [
            { key: 'mag_x', color: '#ef4444', name: 'X' },
            { key: 'mag_y', color: '#22c55e', name: 'Y' },
            { key: 'mag_z', color: '#3b82f6', name: 'Z' }
          ]
        }
    }
  }

  const config = getChartConfig()

  return (
    <div className="space-y-6">
      {/* Selector */}
      <div className="flex gap-2">
        <button
          onClick={() => setDataType('accel')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            dataType === 'accel'
              ? 'bg-stone-900 text-white'
              : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
          }`}
        >
          Accelerometer
        </button>
        <button
          onClick={() => setDataType('gyro')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            dataType === 'gyro'
              ? 'bg-stone-900 text-white'
              : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
          }`}
        >
          Gyroscope
        </button>
        {hasMagData && (
          <button
            onClick={() => setDataType('mag')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              dataType === 'mag'
                ? 'bg-stone-900 text-white'
                : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
            }`}
          >
            Magnetometer
          </button>
        )}
      </div>

      {/* Chart */}
      <div className="border border-stone-200 rounded-lg p-6 bg-white">
        <h3 className="text-lg font-medium text-stone-900 mb-4">
          {config.title} <span className="text-sm text-stone-500">({config.unit})</span>
        </h3>
        
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis 
              dataKey="time" 
              label={{ value: 'Time (seconds)', position: 'insideBottom', offset: -5 }}
              tick={{ fontSize: 12 }}
            />
            <YAxis 
              label={{ value: config.unit, angle: -90, position: 'insideLeft' }}
              tick={{ fontSize: 12 }}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'white', 
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '12px'
              }}
              formatter={(value: number) => value.toFixed(3)}
              labelFormatter={(label) => `Time: ${Number(label).toFixed(2)}s`}
            />
            <Legend wrapperStyle={{ fontSize: '14px' }} />
            {config.lines.map(line => (
              <Line
                key={line.key}
                type="monotone"
                dataKey={line.key}
                stroke={line.color}
                name={line.name}
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>

        {/* Stats */}
        <div className="mt-6 grid grid-cols-3 gap-4 text-sm">
          {config.lines.map(line => {
            const values = chartData.map(d => d[line.key as keyof typeof d] as number).filter(v => v !== null)
            const min = Math.min(...values)
            const max = Math.max(...values)
            const mean = values.reduce((a, b) => a + b, 0) / values.length

            return (
              <div key={line.key} className="p-3 bg-stone-50 rounded-md">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: line.color }}></div>
                  <span className="font-medium text-stone-900">{line.name}-axis</span>
                </div>
                <div className="space-y-1 text-xs text-stone-600">
                  <div>Min: {min.toFixed(3)} {config.unit}</div>
                  <div>Max: {max.toFixed(3)} {config.unit}</div>
                  <div>Mean: {mean.toFixed(3)} {config.unit}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Info */}
      <div className="text-sm text-stone-500 bg-stone-50 border border-stone-200 rounded-lg p-4">
        <p className="mb-2">
          <strong>Displaying:</strong> {chartData.length.toLocaleString()} of {samples.length.toLocaleString()} samples
          {chartData.length < samples.length && ' (downsampled for performance)'}
        </p>
        <p>
          <strong>Time span:</strong> {chartData[0]?.time.toFixed(2)}s to {chartData[chartData.length - 1]?.time.toFixed(2)}s
        </p>
      </div>
    </div>
  )
}

