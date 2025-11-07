"""
Smart normalization: Handles accumulated rotations properly

The simple modulo normalization can cause issues when angles have
accumulated over many rotations. This script uses a smarter approach:
1. Look at rate of change (derivative)
2. Identify reasonable baseline
3. Normalize relative to that baseline
"""

import sys
import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# Add scripts to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'scripts'))
from load_vtx import load_vtx_file


def smart_normalize_angle_series(angles_deg):
    """
    Smart normalization for a time series of angles
    Handles accumulated rotations by looking at derivatives

    Args:
        angles_deg: Array of angles in degrees (possibly unbounded)

    Returns:
        Normalized angles in [-180, 180] range, preserving dynamics
    """
    # Calculate differences between consecutive samples
    diffs = np.diff(angles_deg)

    # Wrap differences to [-180, 180] - this gives us the actual rotation rate
    diffs_wrapped = np.fmod(diffs + 180.0, 360.0)
    diffs_wrapped = np.where(diffs_wrapped < 0, diffs_wrapped + 360.0, diffs_wrapped) - 180.0

    # Reconstruct the angle series from the wrapped differences
    # Start from a reasonable initial value (use first sample wrapped to [-180, 180])
    start_angle = np.fmod(angles_deg[0] + 180.0, 360.0)
    start_angle = start_angle - 180.0 if start_angle >= 0 else start_angle + 180.0

    # Integrate the wrapped differences
    normalized = np.zeros_like(angles_deg)
    normalized[0] = start_angle

    for i in range(len(diffs_wrapped)):
        normalized[i + 1] = normalized[i] + diffs_wrapped[i]
        # Keep in bounds
        while normalized[i + 1] > 180.0:
            normalized[i + 1] -= 360.0
        while normalized[i + 1] < -180.0:
            normalized[i + 1] += 360.0

    return normalized


def process_file(input_filepath):
    """Process VTX file with smart normalization"""

    print("="*60)
    print("SMART EULER ANGLE NORMALIZATION")
    print("="*60)

    # Load file
    print(f"\nLoading: {input_filepath}")
    data = load_vtx_file(input_filepath)
    header = data['header']
    df = data['samples']

    print(f"Duration: {header['duration']:.2f}s ({header['duration']/60:.1f} min)")
    print(f"Samples: {header['sample_count']:,}")

    # Check euler angles exist
    if not all(col in df.columns for col in ['roll', 'pitch', 'yaw']):
        print("\n❌ ERROR: No euler angles in file!")
        return None

    print("\n" + "="*60)
    print("BEFORE NORMALIZATION")
    print("="*60)

    for angle in ['roll', 'pitch', 'yaw']:
        deg_values = np.degrees(df[angle].values)
        print(f"\n{angle.upper()}:")
        print(f"  Range: [{deg_values.min():.1f}°, {deg_values.max():.1f}°]")
        print(f"  Mean: {deg_values.mean():.1f}°")

    print("\n" + "="*60)
    print("APPLYING SMART NORMALIZATION")
    print("="*60)
    print("\nUsing differential reconstruction to preserve dynamics...")

    # Apply smart normalization
    df['roll_norm'] = smart_normalize_angle_series(np.degrees(df['roll'].values))
    df['pitch_norm'] = smart_normalize_angle_series(np.degrees(df['pitch'].values))
    df['yaw_norm'] = smart_normalize_angle_series(np.degrees(df['yaw'].values))

    print("\n" + "="*60)
    print("AFTER NORMALIZATION")
    print("="*60)

    for angle in ['roll', 'pitch', 'yaw']:
        values = df[f'{angle}_norm'].values
        print(f"\n{angle.upper()}:")
        print(f"  Range: [{values.min():.1f}°, {values.max():.1f}°]")
        print(f"  Mean: {values.mean():.1f}°")
        print(f"  Std: {values.std():.1f}°")

        if values.min() >= -180 and values.max() <= 180:
            print(f"  ✓ Within [-180°, 180°]")

    # Visualize
    print("\n" + "="*60)
    print("GENERATING VISUALIZATION")
    print("="*60)

    fig, axes = plt.subplots(4, 1, figsize=(14, 12), sharex=True)

    # Roll
    axes[0].plot(df['time_sec'], df['roll_norm'], linewidth=1, alpha=0.8, color='blue')
    axes[0].axhline(y=0, color='k', linestyle='-', alpha=0.3, linewidth=0.5)
    axes[0].set_ylabel('Roll (degrees)')
    axes[0].set_title('Roll Angle - Bike Leaning (Smart Normalized)')
    axes[0].grid(True, alpha=0.3)
    axes[0].set_ylim(-45, 45)  # Typical range for bike lean

    # Highlight turns
    left = df['roll_norm'] < -10
    right = df['roll_norm'] > 10
    axes[0].fill_between(df['time_sec'], -45, 45, where=left,
                         alpha=0.2, color='red', label='Left (>10°)')
    axes[0].fill_between(df['time_sec'], -45, 45, where=right,
                         alpha=0.2, color='green', label='Right (>10°)')
    axes[0].legend()

    # Pitch
    axes[1].plot(df['time_sec'], df['pitch_norm'], linewidth=1, alpha=0.8, color='green')
    axes[1].axhline(y=0, color='k', linestyle='-', alpha=0.3, linewidth=0.5)
    axes[1].set_ylabel('Pitch (degrees)')
    axes[1].set_title('Pitch Angle - Forward/Back Tilt (Smart Normalized)')
    axes[1].grid(True, alpha=0.3)
    axes[1].set_ylim(-30, 30)  # Typical range for bike pitch

    # Yaw
    axes[2].plot(df['time_sec'], df['yaw_norm'], linewidth=1, alpha=0.8, color='red')
    axes[2].axhline(y=0, color='k', linestyle='-', alpha=0.3, linewidth=0.5)
    axes[2].set_ylabel('Yaw (degrees)')
    axes[2].set_title('Yaw Angle - Heading (Smart Normalized)')
    axes[2].grid(True, alpha=0.3)
    axes[2].set_ylim(-180, 180)

    # Combined
    axes[3].plot(df['time_sec'], df['roll_norm'], linewidth=1, alpha=0.7,
                color='blue', label='Roll')
    axes[3].plot(df['time_sec'], df['pitch_norm'], linewidth=1, alpha=0.7,
                color='green', label='Pitch')
    # Only plot yaw if it's varying significantly
    if df['yaw_norm'].std() > 5:
        axes[3].plot(df['time_sec'], df['yaw_norm'], linewidth=1, alpha=0.7,
                    color='red', label='Yaw')
    axes[3].axhline(y=0, color='k', linestyle='-', alpha=0.3, linewidth=0.5)
    axes[3].set_ylabel('Angle (degrees)')
    axes[3].set_xlabel('Time (seconds)')
    axes[3].set_title('All Euler Angles (Smart Normalized)')
    axes[3].legend()
    axes[3].grid(True, alpha=0.3)

    plt.tight_layout()

    output_path = input_filepath.replace('.vtx', '_smart_normalized.png')
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    print(f"\n✓ Saved: {output_path}")
    plt.show()

    # Save CSV
    csv_path = input_filepath.replace('.vtx', '_smart_normalized.csv')
    output_df = df[['timestamp', 'time_sec', 'roll_norm', 'pitch_norm', 'yaw_norm',
                    'accel_x', 'accel_y', 'accel_z',
                    'gyro_x', 'gyro_y', 'gyro_z',
                    'mag_x', 'mag_y', 'mag_z']].copy()
    output_df.rename(columns={'roll_norm': 'roll', 'pitch_norm': 'pitch', 'yaw_norm': 'yaw'}, inplace=True)
    output_df.to_csv(csv_path, index=False)
    print(f"✓ Saved: {csv_path}")

    # Analysis
    print("\n" + "="*60)
    print("RIDING ANALYSIS")
    print("="*60)

    print(f"\nRoll (lean) statistics:")
    print(f"  Mean lean: {df['roll_norm'].mean():.1f}°")
    print(f"  Std deviation: {df['roll_norm'].std():.1f}°")
    print(f"  Max left: {df['roll_norm'].min():.1f}°")
    print(f"  Max right: {df['roll_norm'].max():.1f}°")

    left_pct = (df['roll_norm'] < -10).sum() / len(df) * 100
    right_pct = (df['roll_norm'] > 10).sum() / len(df) * 100
    straight_pct = 100 - left_pct - right_pct

    print(f"\nTime distribution:")
    print(f"  Left turns:  {left_pct:5.1f}%")
    print(f"  Straight:    {straight_pct:5.1f}%")
    print(f"  Right turns: {right_pct:5.1f}%")

    print(f"\nPitch statistics:")
    print(f"  Mean: {df['pitch_norm'].mean():.1f}°")
    print(f"  Range: [{df['pitch_norm'].min():.1f}°, {df['pitch_norm'].max():.1f}°]")

    print(f"\nYaw statistics:")
    print(f"  Mean: {df['yaw_norm'].mean():.1f}°")
    print(f"  Std: {df['yaw_norm'].std():.1f}°")
    print(f"  Total variation: {df['yaw_norm'].max() - df['yaw_norm'].min():.1f}°")

    print("\n" + "="*60)
    print("✓ COMPLETE")
    print("="*60)

    return df


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python normalize_euler_smart.py <input.vtx>")
        print("\nExample:")
        print("  python normalize_euler_smart.py data/sample-recordings/pedro_to_home.vtx")
        sys.exit(1)

    input_file = sys.argv[1]

    if not os.path.exists(input_file):
        print(f"Error: File not found: {input_file}")
        sys.exit(1)

    df = process_file(input_file)
