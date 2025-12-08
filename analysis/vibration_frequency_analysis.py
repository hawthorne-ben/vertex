#!/usr/bin/env python3
"""
Vibration Frequency Analysis for Damping Material Selection

Analyzes acceleration data to determine dominant vibration frequencies
and recommends appropriate damping materials.
"""

import sys
import numpy as np
import matplotlib.pyplot as plt
from scipy import signal
from scipy.fft import rfft, rfftfreq
sys.path.append('../packages/vtx-parser/python')
from vtx_parser import decode_vtx

def analyze_vibration_spectrum(vtx_file_path, window_seconds=10):
    """
    Analyze vibration frequency spectrum from VTX file

    Args:
        vtx_file_path: Path to .vtx file
        window_seconds: Length of time window to analyze (default 10s)

    Returns:
        dict with frequency analysis results
    """
    print(f"\n{'='*70}")
    print(f"Vibration Frequency Analysis: {vtx_file_path.split('/')[-1]}")
    print(f"{'='*70}\n")

    # Load data
    data = decode_vtx(vtx_file_path)
    samples = data.samples

    # Calculate sample rate
    timestamps = samples['timestamp_ms'].values
    dt = np.mean(np.diff(timestamps)) / 1000.0  # Convert to seconds
    sample_rate = 1.0 / dt

    print(f"Sample rate: {sample_rate:.2f} Hz")
    print(f"Nyquist frequency: {sample_rate/2:.2f} Hz")
    print(f"Recording duration: {timestamps[-1]/1000:.1f} seconds")

    # Select analysis window
    window_samples = int(window_seconds * sample_rate)
    if len(samples) < window_samples:
        window_samples = len(samples)
        print(f"\nWarning: File shorter than {window_seconds}s, using full duration")

    # Get middle section (avoid startup transients)
    start_idx = len(samples) // 2
    end_idx = start_idx + window_samples
    if end_idx > len(samples):
        start_idx = 0
        end_idx = window_samples

    print(f"Analyzing window: {start_idx} to {end_idx} ({window_samples} samples)")

    # Extract acceleration data
    accel_x = samples['accel_x'].values[start_idx:end_idx]
    accel_y = samples['accel_y'].values[start_idx:end_idx]
    accel_z = samples['accel_z'].values[start_idx:end_idx]

    # Compute acceleration magnitude
    accel_mag = np.sqrt(accel_x**2 + accel_y**2 + accel_z**2)

    print(f"\nAcceleration statistics (m/s²):")
    print(f"  X-axis: min={accel_x.min():.2f}, max={accel_x.max():.2f}, std={accel_x.std():.2f}")
    print(f"  Y-axis: min={accel_y.min():.2f}, max={accel_y.max():.2f}, std={accel_y.std():.2f}")
    print(f"  Z-axis: min={accel_z.min():.2f}, max={accel_z.max():.2f}, std={accel_z.std():.2f}")
    print(f"  Magnitude: mean={accel_mag.mean():.2f}, std={accel_mag.std():.2f}")

    # Compute PSD for each axis
    results = {}

    for axis_name, axis_data in [('X', accel_x), ('Y', accel_y), ('Z', accel_z)]:
        # Remove DC component
        axis_data = axis_data - np.mean(axis_data)

        # Compute PSD using Welch's method
        freqs, psd = signal.welch(axis_data, fs=sample_rate, nperseg=min(256, len(axis_data)//4))

        # Find dominant frequencies
        peak_indices = signal.find_peaks(psd, height=np.max(psd)*0.1)[0]  # Peaks > 10% of max
        peak_freqs = freqs[peak_indices]
        peak_powers = psd[peak_indices]

        # Sort by power
        sorted_indices = np.argsort(peak_powers)[::-1][:5]  # Top 5 peaks
        peak_freqs = peak_freqs[sorted_indices]
        peak_powers = peak_powers[sorted_indices]

        results[axis_name] = {
            'freqs': freqs,
            'psd': psd,
            'peak_freqs': peak_freqs,
            'peak_powers': peak_powers,
            'total_power': np.sum(psd)
        }

        print(f"\n{axis_name}-axis dominant frequencies:")
        for i, (freq, power) in enumerate(zip(peak_freqs, peak_powers)):
            print(f"  {i+1}. {freq:.1f} Hz (power: {power:.2e})")

    # Analyze frequency bands
    bands = {
        'Low (0-10 Hz)': (0, 10),
        'Mid-Low (10-40 Hz)': (10, 40),
        'Mid (40-80 Hz)': (40, 80),
        'High (80-160 Hz)': (80, 160),
        'Very High (>160 Hz)': (160, sample_rate/2)
    }

    print(f"\n{'='*70}")
    print("Power Distribution by Frequency Band:")
    print(f"{'='*70}")

    for axis_name in ['X', 'Y', 'Z']:
        freqs = results[axis_name]['freqs']
        psd = results[axis_name]['psd']
        total_power = results[axis_name]['total_power']

        print(f"\n{axis_name}-axis:")
        for band_name, (low, high) in bands.items():
            # Find indices in frequency range
            band_mask = (freqs >= low) & (freqs < high)
            band_power = np.sum(psd[band_mask])
            percent = (band_power / total_power) * 100
            print(f"  {band_name:25s}: {percent:6.2f}%")

    return results, sample_rate, data


def plot_frequency_analysis(results, sample_rate, output_file='vibration_spectrum.png'):
    """Create visualization of frequency analysis"""
    fig, axes = plt.subplots(3, 1, figsize=(12, 10))
    fig.suptitle('Vibration Frequency Spectrum Analysis', fontsize=16, fontweight='bold')

    for idx, axis_name in enumerate(['X', 'Y', 'Z']):
        ax = axes[idx]
        freqs = results[axis_name]['freqs']
        psd = results[axis_name]['psd']
        peak_freqs = results[axis_name]['peak_freqs']

        # Plot PSD
        ax.semilogy(freqs, psd, 'b-', linewidth=1, alpha=0.7, label='Power Spectral Density')

        # Mark dominant frequencies
        for peak_freq in peak_freqs[:3]:  # Top 3
            peak_idx = np.argmin(np.abs(freqs - peak_freq))
            ax.plot(peak_freq, psd[peak_idx], 'ro', markersize=8)
            ax.axvline(peak_freq, color='r', linestyle='--', alpha=0.3)
            ax.text(peak_freq, psd[peak_idx]*1.5, f'{peak_freq:.1f} Hz',
                   rotation=90, va='bottom', fontsize=8)

        # Add frequency band regions
        ax.axvspan(0, 10, alpha=0.1, color='green', label='Bike dynamics (0-10 Hz)')
        ax.axvspan(40, 80, alpha=0.1, color='red', label='Primary vibration (40-80 Hz)')
        ax.axvspan(80, 160, alpha=0.1, color='orange', label='High vibration (80-160 Hz)')

        ax.set_xlabel('Frequency (Hz)')
        ax.set_ylabel(f'{axis_name}-axis PSD (m²/s⁴/Hz)')
        ax.set_title(f'{axis_name}-axis Acceleration Spectrum')
        ax.grid(True, alpha=0.3)
        ax.legend(loc='upper right', fontsize=8)
        ax.set_xlim(0, min(200, sample_rate/2))

    plt.tight_layout()
    plt.savefig(output_file, dpi=150, bbox_inches='tight')
    print(f"\n✓ Frequency spectrum plot saved to: {output_file}")
    return fig


def recommend_damping_materials(results):
    """
    Recommend appropriate damping materials based on frequency analysis
    """
    print(f"\n{'='*70}")
    print("DAMPING MATERIAL RECOMMENDATIONS")
    print(f"{'='*70}\n")

    # Determine dominant frequency range
    all_peaks = []
    for axis_name in ['X', 'Y', 'Z']:
        all_peaks.extend(results[axis_name]['peak_freqs'])

    if len(all_peaks) > 0:
        dominant_freq = np.median(all_peaks)
        min_freq = np.min(all_peaks)
        max_freq = np.max(all_peaks)

        print(f"Dominant vibration characteristics:")
        print(f"  Frequency range: {min_freq:.1f} - {max_freq:.1f} Hz")
        print(f"  Median frequency: {dominant_freq:.1f} Hz")

        # Material recommendations based on frequency
        print(f"\n{'─'*70}")

        if dominant_freq < 40:
            print("✓ GOOD NEWS: Lower frequency vibrations (<40 Hz)")
            print("\nRecommended materials (in order):")
            print("  1. Sorbothane 50 durometer (3-6mm)")
            print("     - Optimal: 10-100 Hz range")
            print("     - Cost: $20-30")
            print("     - Source: McMaster-Carr, Thorlabs, IsolateIt.com")
            print("\n  2. Soft silicone gel pads")
            print("     - Good: 5-80 Hz range")
            print("     - Cost: $10-15")
            print("     - Source: Amazon, electronics suppliers")

        elif 40 <= dominant_freq < 100:
            print("⚠ MODERATE: Mid-frequency vibrations (40-100 Hz)")
            print("\nRecommended materials (in order):")
            print("  1. Sorbothane 30-50 durometer (3-6mm)")
            print("     - Optimal: 10-100 Hz range")
            print("     - Cost: $20-30")
            print("     - Source: McMaster-Carr (part #6384K61 for 1/8\" sheet)")
            print("     - Why: Specifically engineered for this frequency band")
            print("\n  2. Kyosho Zeal gel (3-5mm) + MASS DAMPER (20-50g)")
            print("     - Marginal at this frequency without added mass")
            print("     - Cost: $10-15")
            print("     - Source: Amazon, RC hobby shops")
            print("     - Note: Designed for 100-300Hz, needs mass to shift response lower")

        else:
            print("✓ HIGH FREQUENCY: Vibrations (>100 Hz)")
            print("\nRecommended materials (in order):")
            print("  1. Kyosho Zeal gel (3-5mm)")
            print("     - Optimal: 100-300 Hz range")
            print("     - Cost: $10-15")
            print("     - Source: Amazon (Kyosho Z8006)")
            print("\n  2. Sorbothane 70 durometer (3mm)")
            print("     - Good: 50-200 Hz range")
            print("     - Cost: $20-30")

        print(f"\n{'─'*70}")
        print("\nMASS DAMPING RECOMMENDATIONS:")
        print(f"  Target frequency: {dominant_freq:.1f} Hz")
        print(f"  Recommended mass: 30-50g (to shift resonance to ~{dominant_freq*0.5:.1f} Hz)")
        print("\n  Mass options:")
        print("    - 6-9 US quarters (33-50g)")
        print("    - M3 brass standoffs (15mm length ≈ 5-6g each, use 4-6)")
        print("    - Small brass plate cut to board size")

        print(f"\n{'─'*70}")
        print("\nPURCHASE LINKS:")
        print("\nSorbothane (BEST for your frequency range):")
        print("  - McMaster-Carr: 6384K61 (1/8\" x 12\" x 12\" sheet, 50 duro) ~$25")
        print("  - Thorlabs: Various sizes, $20-40")
        print("  - IsolateIt.com: Custom cuts available")

        print("\nKyosho Zeal (if > 80 Hz):")
        print("  - Amazon: Search 'Kyosho Z8006 Vibration Absorption Sheet'")
        print("  - A-Main Hobbies: KYOZ8006-3B")

        print("\nAlternatives:")
        print("  - 3M VHB 5952 foam tape (Home Depot/Amazon) ~$10")
        print("  - Silicone gel pads (Amazon) ~$10-15")

    else:
        print("⚠ Warning: No clear dominant frequencies detected")
        print("  Recommend starting with Sorbothane 50 durometer (most versatile)")


def main():
    import glob

    # Find sample recordings
    sample_dir = 'data/sample-recordings'
    vtx_files = glob.glob(f'{sample_dir}/*.vtx')

    if not vtx_files:
        print(f"No .vtx files found in {sample_dir}")
        return

    print(f"Found {len(vtx_files)} VTX files:\n")
    for i, f in enumerate(vtx_files):
        print(f"  {i+1}. {f.split('/')[-1]}")

    # Analyze the most recent ride (or let user choose)
    # For now, analyze one representative file
    test_file = None
    for f in vtx_files:
        if 'pedro_to_home' in f or 'bridge' in f or 'hawk' in f:
            test_file = f
            break

    if not test_file and vtx_files:
        test_file = vtx_files[0]

    if test_file:
        results, sample_rate, data = analyze_vibration_spectrum(test_file, window_seconds=10)
        plot_frequency_analysis(results, sample_rate)
        recommend_damping_materials(results)

    print(f"\n{'='*70}")
    print("Analysis complete!")
    print(f"{'='*70}\n")


if __name__ == '__main__':
    main()
