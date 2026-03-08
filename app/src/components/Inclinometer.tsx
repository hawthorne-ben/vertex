/**
 * Inclinometer — 2D tilt indicator using accelerometer data.
 * Shows a spirit-level style circle with a dot representing gravity direction.
 * Accel values in milli-g; at rest on a flat surface: x≈0, y≈0, z≈1000.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';

interface Props {
  /** Acceleration in milli-g */
  accelX: number;
  accelY: number;
  accelZ: number;
  /** Whether IMU is healthy */
  imuOk: boolean;
  size?: number;
  colors: {
    ring: string;
    dot: string;
    crosshair: string;
    error: string;
    text: string;
    textSecondary: string;
  };
}

const Inclinometer: React.FC<Props> = ({
  accelX,
  accelY,
  accelZ,
  imuOk,
  size = 120,
  colors,
}) => {
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size / 2) - 8;
  const dotRadius = 8;

  // Compute tilt from gravity vector projected onto XY plane.
  // Normalize so the dot reaches the edge at ~90° tilt (1g lateral).
  // Clamp to stay within the circle.
  const magnitude = Math.sqrt(accelX * accelX + accelY * accelY);
  const maxMg = 1000; // 1g = full radius
  const fraction = Math.min(magnitude / maxMg, 1);
  const angle = Math.atan2(accelY, accelX);

  const dotX = cx + fraction * (radius - dotRadius) * Math.cos(angle);
  const dotY = cy - fraction * (radius - dotRadius) * Math.sin(angle);

  // Tilt angle in degrees (from vertical)
  const tiltDeg = Math.round(
    Math.atan2(magnitude, Math.abs(accelZ)) * (180 / Math.PI)
  );

  if (!imuOk) {
    return (
      <View style={[styles.container, { width: size, height: size }]}>
        <Svg width={size} height={size}>
          <Circle cx={cx} cy={cy} r={radius} stroke={colors.error} strokeWidth={1.5} fill="none" opacity={0.3} />
          <Line x1={cx - 12} y1={cy - 12} x2={cx + 12} y2={cy + 12} stroke={colors.error} strokeWidth={2} />
          <Line x1={cx + 12} y1={cy - 12} x2={cx - 12} y2={cy + 12} stroke={colors.error} strokeWidth={2} />
        </Svg>
        <Text style={[styles.label, { color: colors.error }]}>IMU Error</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { width: size }]}>
      <Svg width={size} height={size}>
        {/* Outer ring */}
        <Circle cx={cx} cy={cy} r={radius} stroke={colors.ring} strokeWidth={1.5} fill="none" />
        {/* Crosshair */}
        <Line x1={cx} y1={cy - radius + 4} x2={cx} y2={cy + radius - 4} stroke={colors.crosshair} strokeWidth={0.5} opacity={0.4} />
        <Line x1={cx - radius + 4} y1={cy} x2={cx + radius - 4} y2={cy} stroke={colors.crosshair} strokeWidth={0.5} opacity={0.4} />
        {/* Center reference dot */}
        <Circle cx={cx} cy={cy} r={2} fill={colors.crosshair} opacity={0.3} />
        {/* Tilt dot */}
        <Circle cx={dotX} cy={dotY} r={dotRadius} fill={colors.dot} opacity={0.85} />
      </Svg>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {tiltDeg}°
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
  },
});

export default Inclinometer;
