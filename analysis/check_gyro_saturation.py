#!/usr/bin/env python3
"""
Analyze gyro data from VTX file to check for saturation
"""

import sys
import os
import numpy as np
import matplotlib.pyplot as plt

# Add parent directory to path for vtx_parser import
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'packages', 'vtx-parser', 'python'))

from vtx_parser import VTXDecoder

def analyze_gyro_saturation(vtx_path):
    """Analyze gyro data for saturation patterns"""

    print(f"\n{'='*60}")
    print(f"Gyro Saturation Analysis: {os.path.basename(vtx_path)}")
    print(f"{'='*60}\n")

    # Read VTX file
    print("Loading VTX file...")
    decoder = VTXDecoder(vtx_path)
    vtx_data = decoder.decode()

    print(f"Loaded {len(vtx_data['records'])} IMU records")
    if 'gps_records' in vtx_data and vtx_data['gps_records']:
        print(f"Loaded {len(vtx_data['gps_records'])} GPS records")

    # Extract gyro data
    records = vtx_data['records']
    gyro_x = np.array([r['gyro_x'] for r in records])
    gyro_y = np.array([r['gyro_y'] for r in records])
    gyro_z = np.array([r['gyro_z'] for r in records])
    timestamps = np.array([r['timestamp'] for r in records]) / 1000.0  # Convert to seconds

    # Time vector
    time_mins = (timestamps - timestamps[0]) / 60.0

    print(f"\n{'='*60}")
    print("GYRO STATISTICS (rad/s)")
    print(f"{'='*60}")

    for axis_name, axis_data in [('X', gyro_x), ('Y', gyro_y), ('Z', gyro_z)]:
        print(f"\n{axis_name} Axis:")
        print(f"  Min:      {np.min(axis_data):8.3f} rad/s  ({np.min(axis_data) * 180/np.pi:8.1f} deg/s)")
        print(f"  Max:      {np.max(axis_data):8.3f} rad/s  ({np.max(axis_data) * 180/np.pi:8.1f} deg/s)")
        print(f"  Mean:     {np.mean(axis_data):8.3f} rad/s  ({np.mean(axis_data) * 180/np.pi:8.1f} deg/s)")
        print(f"  Std Dev:  {np.std(axis_data):8.3f} rad/s  ({np.std(axis_data) * 180/np.pi:8.1f} deg/s)")
        print(f"  Range:    {np.max(axis_data) - np.min(axis_data):8.3f} rad/s  ({(np.max(axis_data) - np.min(axis_data)) * 180/np.pi:8.1f} deg/s)")

    # Calculate magnitude
    gyro_mag = np.sqrt(gyro_x**2 + gyro_y**2 + gyro_z**2)
    print(f"\nMagnitude:")
    print(f"  Max:      {np.max(gyro_mag):8.3f} rad/s  ({np.max(gyro_mag) * 180/np.pi:8.1f} deg/s)")
    print(f"  Mean:     {np.mean(gyro_mag):8.3f} rad/s  ({np.mean(gyro_mag) * 180/np.pi:8.1f} deg/s)")
    print(f"  95th %ile:{np.percentile(gyro_mag, 95):8.3f} rad/s  ({np.percentile(gyro_mag, 95) * 180/np.pi:8.1f} deg/s)")
    print(f"  99th %ile:{np.percentile(gyro_mag, 99):8.3f} rad/s  ({np.percentile(gyro_mag, 99) * 180/np.pi:8.1f} deg/s)")

    # BNO055 gyro range limits
    print(f"\n{'='*60}")
    print("BNO055 GYRO RANGE LIMITS")
    print(f"{'='*60}")
    print("\nDefault range for OPERATION_MODE_IMUPLUS: ±2000 deg/s (±34.9 rad/s)")
    print("\nAvailable ranges:")
    ranges_deg = [125, 250, 500, 1000, 2000]
    ranges_rad = [r * np.pi / 180 for r in ranges_deg]
    for deg, rad in zip(ranges_deg, ranges_rad):
        status = "✓ SAFE" if np.max(gyro_mag) < rad * 0.95 else "⚠ NEAR LIMIT" if np.max(gyro_mag) < rad else "✗ SATURATED"
        print(f"  ±{deg:4d} deg/s (±{rad:5.1f} rad/s) - {status}")

    # Check for clipping patterns (multiple consecutive samples at same extreme value)
    print(f"\n{'='*60}")
    print("SATURATION PATTERN DETECTION")
    print(f"{'='*60}")

    def find_clipping(data, threshold=0.95):
        """Find sequences where data stays at extreme values"""
        max_val = np.max(np.abs(data))
        clip_threshold = max_val * threshold
        is_clipped = np.abs(data) > clip_threshold

        # Find runs of consecutive clipped values
        runs = []
        in_run = False
        start_idx = 0

        for i in range(len(is_clipped)):
            if is_clipped[i] and not in_run:
                in_run = True
                start_idx = i
            elif not is_clipped[i] and in_run:
                in_run = False
                if i - start_idx >= 3:  # At least 3 consecutive samples
                    runs.append((start_idx, i, i - start_idx))

        return runs

    for axis_name, axis_data in [('X', gyro_x), ('Y', gyro_y), ('Z', gyro_z)]:
        runs = find_clipping(axis_data)
        if runs:
            print(f"\n{axis_name} Axis: Found {len(runs)} potential saturation events (3+ consecutive samples near peak)")
            total_samples = sum(r[2] for r in runs)
            pct = 100 * total_samples / len(axis_data)
            print(f"  Total saturated samples: {total_samples} ({pct:.2f}% of data)")
            if len(runs) <= 5:
                for start, end, count in runs[:5]:
                    time_start = time_mins[start]
                    print(f"    - {count} samples at t={time_start:.2f} min (indices {start}-{end})")
        else:
            print(f"\n{axis_name} Axis: ✓ No saturation patterns detected")

    # Create visualization
    print(f"\n{'='*60}")
    print("GENERATING PLOTS")
    print(f"{'='*60}")

    fig, axes = plt.subplots(4, 1, figsize=(14, 10), sharex=True)
    fig.suptitle(f'Gyroscope Analysis: {os.path.basename(vtx_path)}', fontsize=14, fontweight='bold')

    # Gyro X
    axes[0].plot(time_mins, gyro_x, 'r-', alpha=0.7, linewidth=0.5)
    axes[0].axhline(0, color='k', linestyle='--', alpha=0.3)
    axes[0].axhline(34.9, color='g', linestyle='--', alpha=0.5, label='±2000 deg/s limit')
    axes[0].axhline(-34.9, color='g', linestyle='--', alpha=0.5)
    axes[0].set_ylabel('Gyro X (rad/s)')
    axes[0].legend(loc='upper right')
    axes[0].grid(True, alpha=0.3)

    # Gyro Y
    axes[1].plot(time_mins, gyro_y, 'g-', alpha=0.7, linewidth=0.5)
    axes[1].axhline(0, color='k', linestyle='--', alpha=0.3)
    axes[1].axhline(34.9, color='g', linestyle='--', alpha=0.5, label='±2000 deg/s limit')
    axes[1].axhline(-34.9, color='g', linestyle='--', alpha=0.5)
    axes[1].set_ylabel('Gyro Y (rad/s)')
    axes[1].legend(loc='upper right')
    axes[1].grid(True, alpha=0.3)

    # Gyro Z
    axes[2].plot(time_mins, gyro_z, 'b-', alpha=0.7, linewidth=0.5)
    axes[2].axhline(0, color='k', linestyle='--', alpha=0.3)
    axes[2].axhline(34.9, color='g', linestyle='--', alpha=0.5, label='±2000 deg/s limit')
    axes[2].axhline(-34.9, color='g', linestyle='--', alpha=0.5)
    axes[2].set_ylabel('Gyro Z (rad/s)')
    axes[2].legend(loc='upper right')
    axes[2].grid(True, alpha=0.3)

    # Magnitude
    axes[3].plot(time_mins, gyro_mag, 'purple', alpha=0.7, linewidth=0.5)
    axes[3].axhline(34.9, color='g', linestyle='--', alpha=0.5, label='2000 deg/s limit')
    axes[3].set_ylabel('Magnitude (rad/s)')
    axes[3].set_xlabel('Time (minutes)')
    axes[3].legend(loc='upper right')
    axes[3].grid(True, alpha=0.3)

    plt.tight_layout()

    output_path = vtx_path.replace('.vtx', '_gyro_analysis.png')
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    print(f"✓ Saved plot: {output_path}")

    print(f"\n{'='*60}")
    print("CONCLUSION")
    print(f"{'='*60}")

    max_gyro_all = max(np.max(np.abs(gyro_x)), np.max(np.abs(gyro_y)), np.max(np.abs(gyro_z)))
    max_gyro_deg = max_gyro_all * 180 / np.pi

    if max_gyro_all < 34.9 * 0.95:
        print(f"\n✓ NO SATURATION DETECTED")
        print(f"  Peak gyro: {max_gyro_all:.1f} rad/s ({max_gyro_deg:.0f} deg/s)")
        print(f"  Limit: 34.9 rad/s (2000 deg/s)")
        print(f"  Margin: {((34.9 - max_gyro_all) / 34.9 * 100):.1f}%")
    else:
        print(f"\n⚠ POSSIBLE SATURATION")
        print(f"  Peak gyro: {max_gyro_all:.1f} rad/s ({max_gyro_deg:.0f} deg/s)")
        print(f"  Approaching limit: 34.9 rad/s (2000 deg/s)")

    print()

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print("Usage: python check_gyro_saturation.py <path_to_vtx_file>")
        sys.exit(1)

    vtx_path = sys.argv[1]
    if not os.path.exists(vtx_path):
        print(f"Error: File not found: {vtx_path}")
        sys.exit(1)

    analyze_gyro_saturation(vtx_path)
