#!/usr/bin/env python3
"""Quick script to check accelerometer axes during hawk descent"""

import sys
import math
sys.path.insert(0, '/Users/bhawthorne/dev/vertex/packages/vtx-parser/python')

from vtx_parser import decode_vtx

# Load the file
with open('/Users/bhawthorne/dev/vertex/analysis/data/sample-recordings/hawk_descent_2.vtx', 'rb') as f:
    vtx_file = decode_vtx(f.read())

header = vtx_file.header
samples = vtx_file.records

duration_ms = header.end_timestamp - header.start_timestamp

print(f"Total samples: {len(samples)}")
print(f"Recording duration: {duration_ms/1000:.1f} seconds")
print(f"Sample rate: {header.sample_rate} Hz")
print()

# Find samples around 48:30 (start of descent)
start_ms = header.start_timestamp
descent_start_time = start_ms + 30 * 1000  # 30 seconds into recording

# Get samples in first 5 seconds of riding (flat/level)
flat_samples = []
descent_samples = []

for sample in samples:
    ts = sample.timestamp
    offset_sec = (ts - start_ms) / 1000.0

    # Flat section: 0-30 seconds
    if offset_sec < 30:
        flat_samples.append(sample)
    # Descent section: 30-35 seconds
    elif 30 <= offset_sec < 35:
        descent_samples.append(sample)

# Calculate average accel during flat and descent
def mean(values):
    return sum(values) / len(values) if values else 0.0

flat_accel_x = mean([s.accel_x for s in flat_samples])
flat_accel_y = mean([s.accel_y for s in flat_samples])
flat_accel_z = mean([s.accel_z for s in flat_samples])

descent_accel_x = mean([s.accel_x for s in descent_samples])
descent_accel_y = mean([s.accel_y for s in descent_samples])
descent_accel_z = mean([s.accel_z for s in descent_samples])

flat_mag = math.sqrt(flat_accel_x**2 + flat_accel_y**2 + flat_accel_z**2)
descent_mag = math.sqrt(descent_accel_x**2 + descent_accel_y**2 + descent_accel_z**2)

print("Average Accelerometer (flat, 0-30s):")
print(f"  X: {flat_accel_x:6.2f} m/s²")
print(f"  Y: {flat_accel_y:6.2f} m/s²")
print(f"  Z: {flat_accel_z:6.2f} m/s²")
print(f"  Magnitude: {flat_mag:.2f} m/s²")
print()

print("Average Accelerometer (descent start, 30-35s):")
print(f"  X: {descent_accel_x:6.2f} m/s²")
print(f"  Y: {descent_accel_y:6.2f} m/s²")
print(f"  Z: {descent_accel_z:6.2f} m/s²")
print(f"  Magnitude: {descent_mag:.2f} m/s²")
print()

print("Change (descent - flat):")
print(f"  ΔX: {descent_accel_x - flat_accel_x:+6.2f} m/s²")
print(f"  ΔY: {descent_accel_y - flat_accel_y:+6.2f} m/s²")
print(f"  ΔZ: {descent_accel_z - flat_accel_z:+6.2f} m/s²")
print()

# Check BNO055 orientation during same periods
flat_pitch = mean([s.pitch for s in flat_samples])
descent_pitch = mean([s.pitch for s in descent_samples])

print("BNO055 Orientation:")
print(f"  Flat pitch: {flat_pitch:6.2f}°")
print(f"  Descent pitch: {descent_pitch:6.2f}°")
print(f"  Change: {descent_pitch - flat_pitch:+6.2f}° (negative = nose down ✓)")
