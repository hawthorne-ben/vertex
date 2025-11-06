# IMU Data Analysis & Post-Processing Guide

## Overview

This document outlines the development environment and analysis approaches for processing IMU (Inertial Measurement Unit) data from cycling recordings. We'll cover basic signal processing techniques using trigonometry and statistics, as well as more advanced algorithms for complex analysis.

## Development Environment Setup

### Python-Based Analysis Environment

**Recommended Setup:**
```bash
# Create a dedicated analysis environment
python -m venv venv-analysis
source venv-analysis/bin/activate  # or `venv-analysis\Scripts\activate` on Windows

# Install core dependencies
pip install numpy scipy pandas matplotlib scikit-learn jupyter ipykernel

# Install signal processing libraries
pip install filterpy  # Kalman filtering
pip install imufusion  # Sensor fusion algorithms

# Install visualization
pip install plotly seaborn

# Install development tools
pip install pytest black flake8 mypy
```

**Jupyter Notebook Setup:**
```bash
# Install Jupyter
pip install jupyter notebook jupyterlab

# Create analysis notebooks directory
mkdir -p analysis/notebooks
mkdir -p analysis/scripts
mkdir -p analysis/data/sample-recordings

# Start Jupyter
jupyter lab
```

### Project Structure

```
analysis/
├── notebooks/
│   ├── 01_data_exploration.ipynb
│   ├── 02_axis_identification.ipynb
│   ├── 03_basic_calculations.ipynb
│   └── 04_advanced_analysis.ipynb
├── scripts/
│   ├── load_vtx.py          # VTX file loader
│   ├── process_imu.py       # Core IMU processing
│   ├── calculate_metrics.py # Metrics calculations
│   └── visualization.py     # Plotting utilities
├── data/
│   ├── sample-recordings/
│   └── processed/
└── tests/
    └── test_processing.py
```

### VTX File Loader

Create `analysis/scripts/load_vtx.py`:
```python
import struct
from typing import Dict
import numpy as np
import pandas as pd
import sys
import os

# Add the web/src path to import VTXDecoder
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../web/src'))

def load_vtx_file(filepath: str) -> Dict:
    """
    Load VTX file and return structured data

    Returns:
        {
            'header': {
                'version': int,
                'sample_count': int,
                'sample_rate': float,  # Computed from timestamps
                'duration': float,     # In seconds
            },
            'samples': pd.DataFrame with columns:
                - timestamp (ms)
                - time_sec (seconds, computed)
                - accel_x, accel_y, accel_z (m/s²)
                - gyro_x, gyro_y, gyro_z (rad/s)
                - (other fields from VTX format)
        }
    """
    # Read the binary file
    with open(filepath, 'rb') as f:
        data = f.read()

    # Parse using VTXDecoder (adapt based on your actual format)
    # For now, this is a placeholder - you'll need to implement based on your VTX format
    # The actual implementation will depend on your binary format specification

    # Placeholder structure - replace with actual VTX parsing
    samples_data = []

    # TODO: Parse VTX binary format
    # This should extract timestamp, accel_x/y/z, gyro_x/y/z from binary data

    # Create DataFrame
    df = pd.DataFrame(samples_data)

    # Add computed time column in seconds
    if 'timestamp' in df.columns:
        df['time_sec'] = (df['timestamp'] - df['timestamp'].iloc[0]) / 1000.0

        # Compute sample rate
        if len(df) > 1:
            time_diffs = df['time_sec'].diff().dropna()
            sample_rate = 1.0 / time_diffs.mean()
            duration = df['time_sec'].iloc[-1]
        else:
            sample_rate = None
            duration = 0.0
    else:
        sample_rate = None
        duration = 0.0

    header = {
        'version': 1,  # TODO: Extract from VTX header
        'sample_count': len(df),
        'sample_rate': sample_rate,
        'duration': duration,
    }

    return {
        'header': header,
        'samples': df
    }
```

**Note**: You'll need to implement the actual VTX binary parsing based on your format specification. The function above provides the structure and computed fields (sample rate, duration in seconds).

## Understanding the Coordinate System

### IMU Coordinate System (BNO055/Common)

- **X-axis**: Forward/Backward (points forward when mounted correctly)
- **Y-axis**: Left/Right (points left)
- **Z-axis**: Up/Down (points up)

**Important**: The actual orientation depends on how the sensor is mounted on the bike. We need to identify the primary axes first.

### Global vs. Local Coordinate System

For cycling analysis:
- **Forward motion**: Acceleration along forward axis
- **Lateral motion**: Acceleration along left/right axis (cornering)
- **Vertical motion**: Gravity + vertical acceleration (bumps, inclines)

## Basic Analysis: Trigonometry & Statistics

### 1. Identifying Primary Axes

**Goal**: Determine which IMU axis corresponds to forward/backward, left/right, and up/down.

**Approach using Statistics:**

```python
import numpy as np
import pandas as pd

def identify_primary_axes(accel_data: pd.DataFrame) -> Dict[str, str]:
    """
    Identify primary axes based on acceleration patterns during cycling.
    
    Method:
    1. Forward axis: Highest variance during steady-state (constant motion)
    2. Vertical axis: Closest to 9.8 m/s² mean (gravity)
    3. Lateral axis: Remaining axis
    
    Returns:
        {
            'forward': 'x' | 'y' | 'z',
            'lateral': 'x' | 'y' | 'z',
            'vertical': 'x' | 'y' | 'z'
        }
    """
    variances = {
        'x': accel_data['accel_x'].var(),
        'y': accel_data['accel_y'].var(),
        'z': accel_data['accel_z'].var()
    }
    
    means = {
        'x': accel_data['accel_x'].mean(),
        'y': accel_data['accel_y'].mean(),
        'z': accel_data['accel_z'].mean()
    }
    
    # Vertical axis: closest to gravity (9.8 m/s² or -9.8 m/s²)
    gravity = 9.8
    vertical_axis = min(['x', 'y', 'z'], 
                       key=lambda ax: abs(abs(means[ax]) - gravity))
    
    # Forward axis: highest variance (most motion during cycling)
    remaining_axes = [ax for ax in ['x', 'y', 'z'] if ax != vertical_axis]
    forward_axis = max(remaining_axes, key=lambda ax: variances[ax])
    
    # Lateral axis: remaining one
    lateral_axis = [ax for ax in remaining_axes if ax != forward_axis][0]
    
    return {
        'forward': forward_axis,
        'lateral': lateral_axis,
        'vertical': vertical_axis
    }
```

**Alternative: Frequency Domain Analysis**
- Forward axis: Lower frequency content (pedaling rhythm ~1-2 Hz)
- Lateral axis: Higher frequency content (steering corrections)
- Vertical axis: Contains gravity component (DC offset)

### 2. Noise Reduction: Basic Filtering

**Simple Moving Average:**
```python
def simple_moving_average(data: np.ndarray, window_size: int = 10) -> np.ndarray:
    """Apply simple moving average filter"""
    return np.convolve(data, np.ones(window_size)/window_size, mode='same')
```

**Exponential Moving Average (Better for real-time):**
```python
def exponential_moving_average(data: np.ndarray, alpha: float = 0.1) -> np.ndarray:
    """Apply exponential moving average filter"""
    result = np.zeros_like(data)
    result[0] = data[0]
    for i in range(1, len(data)):
        result[i] = alpha * data[i] + (1 - alpha) * result[i-1]
    return result
```

**Butterworth Low-Pass Filter (Recommended):**
```python
from scipy import signal

def butterworth_lowpass(data: np.ndarray,
                       cutoff: float = 5.0,
                       sample_rate: float = None,
                       order: int = 4) -> np.ndarray:
    """
    Apply Butterworth low-pass filter

    Args:
        cutoff: Cutoff frequency in Hz (remove noise above this)
        sample_rate: Sample rate in Hz (if None, will be estimated from data)
        order: Filter order (higher = sharper cutoff)

    Note: Sample rate should be determined from actual data timestamps, not assumed.
    """
    if sample_rate is None:
        raise ValueError("Sample rate must be provided or computed from timestamps")

    nyquist = sample_rate / 2
    normal_cutoff = cutoff / nyquist

    if normal_cutoff >= 1.0:
        raise ValueError(f"Cutoff frequency ({cutoff} Hz) must be less than Nyquist frequency ({nyquist} Hz)")

    b, a = signal.butter(order, normal_cutoff, btype='low', analog=False)
    return signal.filtfilt(b, a, data)
```

### 3. Basic Calculations

#### 3.1 Total Acceleration (G-Force)

**Simple magnitude calculation:**
```python
def calculate_total_acceleration(accel_x: np.ndarray, 
                                 accel_y: np.ndarray, 
                                 accel_z: np.ndarray) -> np.ndarray:
    """
    Calculate total acceleration magnitude (G-force)
    
    Returns: Acceleration in m/s²
    """
    return np.sqrt(accel_x**2 + accel_y**2 + accel_z**2)
```

**G-force (in g units):**
```python
def calculate_g_force(accel_x: np.ndarray,
                      accel_y: np.ndarray,
                      accel_z: np.ndarray) -> np.ndarray:
    """
    Calculate G-force (acceleration in multiples of gravity)
    
    Returns: G-force values (1.0 = 1g = 9.8 m/s²)
    """
    total_accel = calculate_total_acceleration(accel_x, accel_y, accel_z)
    return total_accel / 9.8
```

#### 3.2 Lean Angle (Bank Angle)

**Method 1: Gravity Component Analysis**

During steady cornering, the bike leans into the turn. The acceleration vector rotates:
- Vertical component decreases (cos of lean angle)
- Lateral component increases (sin of lean angle)

```python
def calculate_lean_angle_from_gravity(accel_lateral: np.ndarray,
                                     accel_vertical: np.ndarray,
                                     gravity: float = 9.8) -> np.ndarray:
    """
    Calculate lean angle from gravity component shift

    Theory:
    - During steady cornering, the bike leans and gravity vector rotates
    - In the bike's frame of reference:
      * Vertical component = gravity * cos(lean_angle)
      * Lateral component = gravity * sin(lean_angle)
    - Lean angle = atan2(lateral, vertical)

    Important:
    - This assumes the vertical axis already includes gravity (e.g., reads ~9.8 m/s² when stationary)
    - Best during steady-state cornering (not during acceleration/braking)
    - Sign convention: positive = lean right, negative = lean left (depends on axis orientation)

    Returns: Lean angle in radians
    """
    # Calculate lean angle directly from lateral and vertical components
    # The vertical component should already include gravity when stationary
    lean_angle = np.arctan2(accel_lateral, accel_vertical)

    return lean_angle  # in radians

def calculate_lean_angle_from_gravity_corrected(accel_lateral: np.ndarray,
                                               accel_vertical: np.ndarray,
                                               accel_forward: np.ndarray,
                                               gravity: float = 9.8) -> np.ndarray:
    """
    Calculate lean angle with gravity correction for acceleration/braking

    This version attempts to remove forward/vertical acceleration to isolate gravity vector.
    More accurate during acceleration/braking but requires good filtering.

    Returns: Lean angle in radians
    """
    # Estimate gravity-only component by removing dynamic acceleration
    # This is simplified - more accurate methods use complementary filters
    total_accel = np.sqrt(accel_lateral**2 + accel_vertical**2 + accel_forward**2)

    # Normalize to gravity magnitude
    gravity_lateral = accel_lateral * (gravity / total_accel)
    gravity_vertical = accel_vertical * (gravity / total_accel)

    lean_angle = np.arctan2(gravity_lateral, gravity_vertical)

    return lean_angle
```

**Method 2: Using Gyroscope (Rate of Change)**

```python
def calculate_lean_angle_from_gyro(gyro_roll: np.ndarray,
                                   timestamps: np.ndarray,
                                   initial_lean: float = 0.0) -> np.ndarray:
    """
    Calculate lean angle by integrating gyroscope roll rate
    
    Args:
        gyro_roll: Roll angular velocity (rad/s)
        timestamps: Timestamps in seconds
        initial_lean: Initial lean angle (rad)
    
    Returns: Lean angle in radians
    """
    dt = np.diff(timestamps)
    dt = np.concatenate([[dt[0]], dt])  # Handle first sample
    
    # Integrate: lean = initial + ∫(gyro_roll * dt)
    lean_angle = np.cumsum(gyro_roll * dt) + initial_lean
    
    return lean_angle
```

**Method 3: Combined Approach (Accelerometer + Gyroscope)**

```python
def calculate_lean_angle_combined(accel_lateral: np.ndarray,
                                   accel_vertical: np.ndarray,
                                   gyro_roll: np.ndarray,
                                   timestamps: np.ndarray,
                                   alpha: float = 0.98) -> np.ndarray:
    """
    Complementary filter: Combine accelerometer and gyroscope
    
    - Accelerometer: Good for steady-state, noisy during motion
    - Gyroscope: Good for dynamic motion, drifts over time
    
    Args:
        alpha: Gyroscope weight (0.98 = trust gyro 98%, accel 2%)
    
    Returns: Lean angle in radians
    """
    lean_from_accel = calculate_lean_angle_from_gravity(
        accel_lateral, accel_vertical
    )
    lean_from_gyro = calculate_lean_angle_from_gyro(
        gyro_roll, timestamps
    )
    
    # Complementary filter
    lean_combined = (alpha * lean_from_gyro + 
                    (1 - alpha) * lean_from_accel)
    
    return lean_combined
```

#### 3.3 Braking Force

**Forward Acceleration Analysis:**

```python
def calculate_braking_force(accel_forward: np.ndarray,
                            sample_rate: float = 100.0) -> np.ndarray:
    """
    Calculate braking force from forward acceleration
    
    Negative forward acceleration = braking
    Positive forward acceleration = acceleration
    
    Returns: Braking force in m/s² (negative = braking)
    """
    # Filter out noise first
    filtered_accel = butterworth_lowpass(
        accel_forward, 
        cutoff=2.0,  # Low cutoff for braking (slow changes)
        sample_rate=sample_rate
    )
    
    # Braking is negative forward acceleration
    braking_force = -filtered_accel  # Negative = braking
    
    return braking_force
```

**Braking G-Force:**
```python
def calculate_braking_g_force(accel_forward: np.ndarray,
                              sample_rate: float = 100.0) -> np.ndarray:
    """
    Calculate braking force in G units
    
    Returns: Braking force in g (negative = braking)
    """
    braking_force = calculate_braking_force(accel_forward, sample_rate)
    return braking_force / 9.8
```

#### 3.4 Cornering Forces (Lateral G-Force)

```python
def calculate_cornering_force(accel_lateral: np.ndarray,
                              sample_rate: float = 100.0) -> np.ndarray:
    """
    Calculate lateral (cornering) acceleration
    
    Positive = turning right, Negative = turning left
    
    Returns: Lateral acceleration in m/s²
    """
    # Filter lateral acceleration
    filtered_accel = butterworth_lowpass(
        accel_lateral,
        cutoff=5.0,  # Higher cutoff for cornering (can be faster)
        sample_rate=sample_rate
    )
    
    return filtered_accel
```

### 4. Basic Statistical Analysis

**Peak Detection:**
```python
from scipy.signal import find_peaks

def find_braking_events(braking_force: np.ndarray,
                        threshold: float = -0.5) -> Tuple[np.ndarray, Dict]:
    """
    Find braking events above threshold
    
    Returns: (peak_indices, peak_properties)
    """
    # Only look at negative values (braking)
    braking_force_negative = -braking_force
    
    peaks, properties = find_peaks(
        braking_force_negative,
        height=abs(threshold),
        distance=100  # Minimum distance between peaks (1 second at 100Hz)
    )
    
    return peaks, properties
```

**Cornering Detection:**
```python
def identify_corners(lateral_accel: np.ndarray,
                    timestamps: np.ndarray,
                    threshold: float = 2.0) -> List[Dict]:
    """
    Identify cornering events from lateral acceleration
    
    Returns: List of corner events with start/end times and peak force
    """
    # Filter first
    filtered = butterworth_lowpass(lateral_accel, cutoff=5.0)
    
    # Find peaks above threshold
    peaks, properties = find_peaks(
        np.abs(filtered),
        height=threshold,
        distance=50  # Minimum 0.5 seconds between corners
    )
    
    corners = []
    for peak_idx in peaks:
        # Find start and end of corner (where accel drops below threshold/2)
        peak_time = timestamps[peak_idx]
        peak_force = filtered[peak_idx]
        
        # Look backwards for start
        start_idx = peak_idx
        while start_idx > 0 and np.abs(filtered[start_idx]) > threshold / 2:
            start_idx -= 1
        
        # Look forwards for end
        end_idx = peak_idx
        while end_idx < len(filtered) - 1 and np.abs(filtered[end_idx]) > threshold / 2:
            end_idx += 1
        
        corners.append({
            'start_time': timestamps[start_idx],
            'end_time': timestamps[end_idx],
            'peak_time': peak_time,
            'peak_force': peak_force,
            'duration': timestamps[end_idx] - timestamps[start_idx]
        })
    
    return corners
```

## Advanced Analysis: Complex Algorithms

### What Requires More Complex Algorithms

#### 1. Sensor Fusion (Kalman Filtering)

**Problem**: 
- Accelerometer: Noisy but absolute (gravity reference)
- Gyroscope: Smooth but drifts over time
- Magnetometer: Can be affected by magnetic interference

**Solution**: Kalman Filter or Complementary Filter

**When to use:**
- Accurate orientation tracking over long periods
- Reducing noise and drift simultaneously
- Real-time processing

**Implementation:**
```python
from filterpy.kalman import KalmanFilter
import numpy as np

def setup_orientation_kalman_filter(dt: float = 0.01) -> KalmanFilter:
    """
    Setup Kalman filter for orientation estimation
    
    State: [roll, pitch, yaw, roll_rate, pitch_rate, yaw_rate]
    """
    kf = KalmanFilter(dim_x=6, dim_z=3)  # 6 states, 3 measurements
    
    # State transition matrix (constant velocity model)
    kf.F = np.array([
        [1, 0, 0, dt, 0, 0],
        [0, 1, 0, 0, dt, 0],
        [0, 0, 1, 0, 0, dt],
        [0, 0, 0, 1, 0, 0],
        [0, 0, 0, 0, 1, 0],
        [0, 0, 0, 0, 0, 1]
    ])
    
    # Measurement matrix (we measure angles from accelerometer)
    kf.H = np.array([
        [1, 0, 0, 0, 0, 0],
        [0, 1, 0, 0, 0, 0],
        [0, 0, 1, 0, 0, 0]
    ])
    
    # Process noise covariance
    kf.Q = np.eye(6) * 0.1
    
    # Measurement noise covariance
    kf.R = np.eye(3) * 0.5
    
    return kf
```

#### 2. Quaternion-Based Orientation

**Problem**: Gimbal lock with Euler angles, need smooth rotation

**Solution**: Use quaternions for orientation representation

**When to use:**
- Complex 3D rotations
- Avoiding gimbal lock
- Smooth interpolation between orientations

**Library**: `scipy.spatial.transform` or `pyquaternion`

#### 3. Machine Learning for Pattern Recognition

**Problems that benefit from ML:**
- **Activity Classification**: Distinguishing riding vs. stationary vs. walking
- **Event Detection**: Identifying specific events (braking, cornering, bumps)
- **Anomaly Detection**: Finding unusual patterns in data
- **Data Quality Assessment**: Detecting sensor issues or mounting problems

**Approach:**
```python
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split

def extract_features(accel_data: np.ndarray, 
                    gyro_data: np.ndarray,
                    window_size: int = 100) -> np.ndarray:
    """
    Extract features from IMU data windows
    
    Features:
    - Mean, std, min, max of each axis
    - Energy in frequency bands
    - Correlation between axes
    """
    features = []
    
    for i in range(0, len(accel_data) - window_size, window_size // 2):
        window_accel = accel_data[i:i+window_size]
        window_gyro = gyro_data[i:i+window_size]
        
        # Statistical features
        feat = [
            np.mean(window_accel, axis=0),
            np.std(window_accel, axis=0),
            np.min(window_accel, axis=0),
            np.max(window_accel, axis=0),
            np.mean(window_gyro, axis=0),
            np.std(window_gyro, axis=0),
        ]
        
        # Frequency domain features
        fft_accel = np.fft.fft(window_accel, axis=0)
        power = np.abs(fft_accel)**2
        feat.append(np.sum(power[:window_size//4], axis=0))  # Low freq energy
        feat.append(np.sum(power[window_size//4:], axis=0))  # High freq energy
        
        features.append(np.concatenate(feat))
    
    return np.array(features)
```

#### 4. Peak Detection and Event Segmentation

**Advanced Techniques:**
- **Wavelet Transform**: Better frequency localization than FFT
- **Hidden Markov Models (HMM)**: Model state transitions (cornering → braking → acceleration)
- **Change Point Detection**: Identify when behavior changes

**Example: Change Point Detection**
```python
from ruptures import Binseg, KernelCPD

def detect_riding_segments(accel_data: np.ndarray,
                          n_segments: int = 10) -> List[Tuple[int, int]]:
    """
    Segment data into different riding phases
    
    Returns: List of (start_idx, end_idx) tuples
    """
    algo = Binseg(model="rbf").fit(accel_data)
    change_points = algo.predict(n_bkps=n_segments - 1)
    
    segments = []
    start = 0
    for cp in change_points:
        segments.append((start, cp))
        start = cp
    
    return segments
```

## Testing Strategy

### Unit Tests

```python
# tests/test_processing.py

import pytest
import numpy as np
from analysis.scripts.process_imu import (
    calculate_lean_angle_from_gravity,
    calculate_braking_force,
    identify_primary_axes
)

def test_lean_angle_calculation():
    """Test lean angle calculation with known values"""
    # Create synthetic data: 30 degree lean
    lean_angle_rad = np.radians(30)
    gravity = 9.8
    
    accel_lateral = gravity * np.sin(lean_angle_rad)
    accel_vertical = gravity * np.cos(lean_angle_rad)
    
    calculated_lean = calculate_lean_angle_from_gravity(
        np.array([accel_lateral]),
        np.array([accel_vertical])
    )
    
    assert np.isclose(calculated_lean[0], lean_angle_rad, atol=0.1)

def test_braking_force():
    """Test braking force calculation"""
    # Forward deceleration of 2 m/s² = braking
    accel_forward = np.array([-2.0])
    braking = calculate_braking_force(accel_forward)
    
    assert np.isclose(braking[0], 2.0)  # Should be positive (braking force)
```

### Integration Tests

Test with real sample files:
```python
def test_full_processing_pipeline():
    """Test complete processing pipeline"""
    data = load_vtx_file('data/sample-recordings/ride_001.vtx')
    
    # Process
    axes = identify_primary_axes(data['samples'])
    lean_angles = calculate_lean_angle_combined(...)
    braking_events = find_braking_events(...)
    
    # Verify outputs
    assert len(lean_angles) == len(data['samples'])
    assert len(braking_events[0]) > 0
```

## Recommended Starting Point

### Step 1: Data Exploration (CRITICAL FIRST STEP)
1. **Load sample ride file** using `load_vtx_file()`
2. **Inspect basic properties**:
   - Sample count
   - Computed sample rate (verify it's consistent)
   - Duration
   - Available sensor channels
3. **Plot raw data** for ALL axes:
   - Accelerometer X, Y, Z (all on one plot)
   - Gyroscope X, Y, Z (all on one plot)
4. **Identify patterns visually**:
   - Which axis shows gravity (~9.8 m/s² constant offset)?
   - Which axis shows the most variation during riding?
   - Can you see the 4 corners in the data?
5. **Check data quality**:
   - Are there any missing samples or gaps?
   - Is the noise level acceptable?
   - Are there any obvious sensor glitches?

**Output from Step 1**: Clear understanding of your data structure, sample rate, and axis orientation.

### Step 2: Axis Identification
1. **Run statistical analysis** using `identify_primary_axes()`
2. **Validate results** by comparing to visual inspection:
   - Does vertical axis match the one with ~9.8 m/s² offset?
   - Does forward axis show the most variation?
3. **Document findings**: Note which physical axis (X/Y/Z) corresponds to forward/lateral/vertical
4. **Create axis-corrected data**: Remap columns if needed for consistent naming

**Output from Step 2**: Confirmed axis mapping (e.g., "Z is vertical, X is forward, Y is lateral")

### Step 3: Basic Filtering
1. **Apply low-pass filter** to each axis using measured sample rate
2. **Compare filtered vs. raw** visually
3. **Adjust filter parameters** if needed (cutoff frequency, order)
4. **Verify corners are still visible** after filtering

**Output from Step 3**: Clean data ready for calculations

### Step 4: Basic Calculations
1. **Calculate lean angles** using `calculate_lean_angle_from_gravity()`
2. **Plot lean angle over time** - you should see 4 peaks for the 4 right turns
3. **Calculate cornering forces** from lateral acceleration
4. **Identify corner events** using peak detection
5. **Verify event count**: Should detect 4 corners

**Output from Step 4**: Validated lean angle calculation that matches expected 4 corners

### Step 5: Validation Against Known Data
For your "Cornering Clockwise 1.vtx" file with 4 right turns:
1. **Verify corner count**: Should detect exactly 4 corners
2. **Check lean angle direction**: Right turns should show consistent sign
3. **Inspect corner timing**: Should be roughly evenly spaced around the block
4. **Check lean angle magnitude**: Typical cycling corners are 10-30 degrees depending on speed

**Output from Step 5**: Confidence that calculations are correct

### Step 6: Advanced Features (After validation)
1. Implement complementary filter for better lean angle
2. Add braking force analysis
3. Add machine learning for event classification
4. Implement sensor fusion for orientation tracking

## Tools and Libraries Reference

### Core Libraries
- **NumPy**: Numerical computing
- **SciPy**: Scientific computing (signal processing, statistics)
- **Pandas**: Data manipulation and analysis
- **Matplotlib/Plotly**: Visualization

### Signal Processing
- **scipy.signal**: Filtering, peak detection, spectral analysis
- **filterpy**: Kalman filtering
- **ruptures**: Change point detection

### Machine Learning
- **scikit-learn**: Classification, feature extraction
- **TensorFlow/PyTorch**: Deep learning (if needed)

### Visualization
- **matplotlib**: Basic plotting
- **plotly**: Interactive plots
- **seaborn**: Statistical visualizations

## Next Steps

1. **Set up development environment** (Python venv + Jupyter)
2. **Load sample ride file** and explore data
3. **Identify primary axes** using statistical methods
4. **Implement basic calculations** (lean angles, braking, G-forces)
5. **Validate results** against known riding patterns
6. **Iterate and refine** filtering and calculation methods
7. **Add advanced features** as needed (Kalman filtering, ML, etc.)

## References

- [Kalman Filter Tutorial](https://github.com/rlabbe/Kalman-and-Bayesian-Filters-in-Python)
- [IMU Sensor Fusion](https://www.pieter-jan.com/node/11)
- [Scipy Signal Processing](https://docs.scipy.org/doc/scipy/reference/signal.html)
- [Complementary Filter](https://www.pieter-jan.com/node/11)

