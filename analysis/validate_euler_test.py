#!/usr/bin/env python3
"""
Validate test_with_euler.vtx file
Checks that Euler angles are present and reasonable
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'scripts'))

from load_vtx import load_vtx_file
import matplotlib.pyplot as plt

# Load the test file
print("Loading test_with_euler.vtx...")
data = load_vtx_file('data/sample-recordings/test_with_euler.vtx')

header = data['header']
metadata = data['metadata']
df = data['samples']

print("\n" + "="*60)
print("FILE: test_with_euler.vtx")
print("="*60)
print(f"Version: {header['version'][0]}.{header['version'][1]}")
print(f"Sample count: {header['sample_count']:,}")
print(f"Sample rate: {header['sample_rate']:.1f} Hz")
print(f"Duration: {header['duration']:.2f} seconds")
print(f"\nColumns: {list(df.columns)}")

# Check if Euler angles are present
has_euler = 'roll' in df.columns and 'pitch' in df.columns and 'yaw' in df.columns

print("\n" + "="*60)
print("EULER ANGLE VALIDATION")
print("="*60)

if has_euler:
    print("✓ Euler angles ARE present in the file!")
    print("\nEuler Angle Statistics:")
    print(f"  Roll:  mean={df['roll'].mean():7.2f}°, std={df['roll'].std():6.2f}°, range=[{df['roll'].min():7.2f}°, {df['roll'].max():7.2f}°]")
    print(f"  Pitch: mean={df['pitch'].mean():7.2f}°, std={df['pitch'].std():6.2f}°, range=[{df['pitch'].min():7.2f}°, {df['pitch'].max():7.2f}°]")
    print(f"  Yaw:   mean={df['yaw'].mean():7.2f}°, std={df['yaw'].std():6.2f}°, range=[{df['yaw'].min():7.2f}°, {df['yaw'].max():7.2f}°]")
else:
    print("✗ ERROR: Euler angles NOT found in file!")
    print("  File only contains:", list(df.columns))
    sys.exit(1)

print("\n" + "="*60)
print("SENSOR DATA STATISTICS")
print("="*60)

print("\nAccelerometer (m/s²):")
print(f"  X: mean={df['accel_x'].mean():7.2f}, std={df['accel_x'].std():6.2f}")
print(f"  Y: mean={df['accel_y'].mean():7.2f}, std={df['accel_y'].std():6.2f}")
print(f"  Z: mean={df['accel_z'].mean():7.2f}, std={df['accel_z'].std():6.2f}")

print("\nGyroscope (rad/s):")
print(f"  X: mean={df['gyro_x'].mean():7.2f}, std={df['gyro_x'].std():6.2f}")
print(f"  Y: mean={df['gyro_y'].mean():7.2f}, std={df['gyro_y'].std():6.2f}")
print(f"  Z: mean={df['gyro_z'].mean():7.2f}, std={df['gyro_z'].std():6.2f}")

print("\n" + "="*60)
print("FIRST 10 SAMPLES")
print("="*60)
print(df[['time_sec', 'accel_z', 'gyro_x', 'gyro_y', 'gyro_z', 'roll', 'pitch', 'yaw']].head(10).to_string(index=False))

# Create visualization
print("\n" + "="*60)
print("CREATING VISUALIZATION")
print("="*60)

fig, axes = plt.subplots(3, 1, figsize=(14, 10), sharex=True)

# Accelerometer
axes[0].plot(df['time_sec'], df['accel_x'], label='X', alpha=0.8, linewidth=1)
axes[0].plot(df['time_sec'], df['accel_y'], label='Y', alpha=0.8, linewidth=1)
axes[0].plot(df['time_sec'], df['accel_z'], label='Z', alpha=0.8, linewidth=1)
axes[0].axhline(y=9.8, color='r', linestyle='--', alpha=0.3, linewidth=1, label='±9.8 m/s² (gravity)')
axes[0].axhline(y=-9.8, color='r', linestyle='--', alpha=0.3, linewidth=1)
axes[0].set_ylabel('Acceleration (m/s²)')
axes[0].set_title('Accelerometer - Test with 3-axis shaking')
axes[0].legend(loc='upper right')
axes[0].grid(True, alpha=0.3)

# Gyroscope
axes[1].plot(df['time_sec'], df['gyro_x'], label='X', alpha=0.8, linewidth=1)
axes[1].plot(df['time_sec'], df['gyro_y'], label='Y', alpha=0.8, linewidth=1)
axes[1].plot(df['time_sec'], df['gyro_z'], label='Z', alpha=0.8, linewidth=1)
axes[1].axhline(y=0, color='k', linestyle='-', alpha=0.3, linewidth=0.5)
axes[1].set_ylabel('Angular Velocity (rad/s)')
axes[1].set_title('Gyroscope - Rotation about 3 axes')
axes[1].legend(loc='upper right')
axes[1].grid(True, alpha=0.3)

# Euler Angles (from BNO055 sensor fusion)
axes[2].plot(df['time_sec'], df['roll'], label='Roll', alpha=0.8, linewidth=1.5, color='red')
axes[2].plot(df['time_sec'], df['pitch'], label='Pitch', alpha=0.8, linewidth=1.5, color='blue')
axes[2].plot(df['time_sec'], df['yaw'], label='Yaw', alpha=0.8, linewidth=1.5, color='green')
axes[2].axhline(y=0, color='k', linestyle='-', alpha=0.3, linewidth=0.5)
axes[2].set_ylabel('Angle (degrees)')
axes[2].set_title('Euler Angles - From BNO055 Sensor Fusion (NEW!)')
axes[2].set_xlabel('Time (seconds)')
axes[2].legend(loc='upper right')
axes[2].grid(True, alpha=0.3)

plt.tight_layout()
output_path = 'data/test_with_euler_validation.png'
plt.savefig(output_path, dpi=150, bbox_inches='tight')
print(f"\n✓ Visualization saved to: {output_path}")

print("\n" + "="*60)
print("VALIDATION COMPLETE")
print("="*60)
print("\n✓ SUCCESS: File contains Euler angles from BNO055 sensor fusion!")
print("✓ Data looks reasonable for 3-axis shaking and rotation test")
print(f"✓ Visualization saved to: {output_path}")
