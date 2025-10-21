#!/usr/bin/env python3
"""
Synthetic IMU Data Generator for Vertex

Generates realistic cycling IMU data (BNO055 format) for testing the data pipeline.
Creates scenarios like acceleration, cornering, braking with configurable noise.

Usage:
    python generate_synthetic_imu.py --output ride_001.csv --duration 120 --sample-rate 100

Output format matches BNO055:
    timestamp, accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z, mag_x, mag_y, mag_z
"""

import argparse
import csv
import math
import random
from dataclasses import dataclass, replace
from typing import List, Tuple


@dataclass
class IMUSample:
    """Single IMU sensor reading"""
    timestamp: float  # seconds
    accel_x: float    # m/s² (forward/back)
    accel_y: float    # m/s² (left/right)
    accel_z: float    # m/s² (up/down, includes gravity)
    gyro_x: float     # rad/s (pitch rate)
    gyro_y: float     # rad/s (roll rate)
    gyro_z: float     # rad/s (yaw rate)
    mag_x: float      # µT (magnetometer X)
    mag_y: float      # µT (magnetometer Y)
    mag_z: float      # µT (magnetometer Z)


class MotionScenario:
    """Base class for motion scenarios"""
    
    def __init__(self, duration: float, sample_rate: float):
        self.duration = duration
        self.sample_rate = sample_rate
        self.dt = 1.0 / sample_rate
        
    def generate(self, start_time: float = 0.0) -> List[IMUSample]:
        """Generate IMU samples for this scenario"""
        samples = []
        num_samples = int(self.duration * self.sample_rate)
        
        for i in range(num_samples):
            t = start_time + i * self.dt
            sample = self._compute_sample(t - start_time)
            # Replace timestamp with absolute time
            sample = replace(sample, timestamp=t)
            samples.append(sample)
            
        return samples
    
    def _compute_sample(self, t: float) -> IMUSample:
        """Override this to define motion dynamics
        
        Args:
            t: Time relative to start of this scenario (not absolute time)
        
        Returns:
            IMUSample with timestamp set to 0 (will be overwritten by generate())
        """
        raise NotImplementedError


class StationaryScenario(MotionScenario):
    """Bike at rest - only gravity visible"""
    
    def _compute_sample(self, t: float) -> IMUSample:
        return IMUSample(
            timestamp=0.0,  # Will be overwritten by generate()
            accel_x=0.0,
            accel_y=0.0,
            accel_z=-9.81,  # Gravity pointing down
            gyro_x=0.0,
            gyro_y=0.0,
            gyro_z=0.0,
            mag_x=20.0,  # Rough north-pointing magnetometer
            mag_y=0.0,
            mag_z=-40.0
        )


class AccelerationScenario(MotionScenario):
    """Linear acceleration from 0 to target speed"""
    
    def __init__(self, duration: float, sample_rate: float, 
                 target_speed: float = 10.0, accel_rate: float = 2.0):
        """
        Args:
            target_speed: m/s (10 m/s ≈ 36 km/h ≈ 22 mph)
            accel_rate: m/s² acceleration
        """
        super().__init__(duration, sample_rate)
        self.target_speed = target_speed
        self.accel_rate = accel_rate
        self.accel_time = target_speed / accel_rate
        
    def _compute_sample(self, t: float) -> IMUSample:
        # Ramp up acceleration, then coast
        if t < self.accel_time:
            accel_x = self.accel_rate
        else:
            accel_x = 0.0
            
        return IMUSample(
            timestamp=0.0,
            accel_x=accel_x,
            accel_y=0.0,
            accel_z=-9.81,
            gyro_x=0.0,
            gyro_y=0.0,
            gyro_z=0.0,
            mag_x=20.0,
            mag_y=0.0,
            mag_z=-40.0
        )


class CornerScenario(MotionScenario):
    """Constant-speed cornering (circular arc)"""
    
    def __init__(self, duration: float, sample_rate: float,
                 speed: float = 10.0, radius: float = 20.0, direction: str = 'left'):
        """
        Args:
            speed: m/s constant speed through corner
            radius: meters, turning radius
            direction: 'left' or 'right'
        """
        super().__init__(duration, sample_rate)
        self.speed = speed
        self.radius = radius
        self.direction = direction
        
        # Physics: centripetal acceleration = v²/r
        self.lateral_g = (speed ** 2) / radius
        
        # Angular velocity (yaw rate)
        self.yaw_rate = speed / radius  # rad/s
        if direction == 'right':
            self.lateral_g *= -1
            self.yaw_rate *= -1
            
        # Lean angle to balance lateral G (simplified)
        self.lean_angle = math.atan2(self.lateral_g, 9.81)
        
    def _compute_sample(self, t: float) -> IMUSample:
        # In body frame: lateral accel + rotated gravity
        # Simplified: assume bike leans to balance forces
        
        # Gravity component in body frame when leaned
        grav_x = 9.81 * math.sin(self.lean_angle)
        grav_y = 0.0  # Balanced lean
        grav_z = -9.81 * math.cos(self.lean_angle)
        
        return IMUSample(
            timestamp=0.0,
            accel_x=grav_x,  # Forward component of gravity
            accel_y=self.lateral_g,  # Centripetal
            accel_z=grav_z,  # Vertical component
            gyro_x=0.0,  # No pitch change
            gyro_y=0.0,  # Constant lean (no roll rate)
            gyro_z=self.yaw_rate,  # Turning rate
            mag_x=20.0 * math.cos(self.yaw_rate * t),  # Rotating magnetometer
            mag_y=20.0 * math.sin(self.yaw_rate * t),
            mag_z=-40.0
        )


class BrakingScenario(MotionScenario):
    """Deceleration from initial speed to stop"""
    
    def __init__(self, duration: float, sample_rate: float,
                 initial_speed: float = 10.0, decel_rate: float = 3.0):
        """
        Args:
            initial_speed: m/s starting speed
            decel_rate: m/s² deceleration (positive value)
        """
        super().__init__(duration, sample_rate)
        self.initial_speed = initial_speed
        self.decel_rate = decel_rate
        self.stop_time = initial_speed / decel_rate
        
    def _compute_sample(self, t: float) -> IMUSample:
        # Decelerate until stopped
        if t < self.stop_time:
            accel_x = -self.decel_rate
        else:
            accel_x = 0.0
            
        return IMUSample(
            timestamp=0.0,
            accel_x=accel_x,
            accel_y=0.0,
            accel_z=-9.81,
            gyro_x=0.0,
            gyro_y=0.0,
            gyro_z=0.0,
            mag_x=20.0,
            mag_y=0.0,
            mag_z=-40.0
        )


class VibrationScenario(MotionScenario):
    """Adds road vibration to simulate rough surface"""
    
    def __init__(self, duration: float, sample_rate: float,
                 base_scenario: MotionScenario,
                 vibration_freq: float = 15.0, vibration_amplitude: float = 2.0):
        """
        Args:
            base_scenario: Underlying motion to add vibration to
            vibration_freq: Hz, typical road buzz frequency
            vibration_amplitude: m/s², magnitude of vibration
        """
        super().__init__(duration, sample_rate)
        self.base_scenario = base_scenario
        self.vibration_freq = vibration_freq
        self.vibration_amplitude = vibration_amplitude
        
    def _compute_sample(self, t: float) -> IMUSample:
        base = self.base_scenario._compute_sample(t)
        
        # Add sinusoidal vibration (simplified - real roads are more complex)
        vib_z = self.vibration_amplitude * math.sin(2 * math.pi * self.vibration_freq * t)
        
        base.accel_z += vib_z
        return base


def add_noise(samples: List[IMUSample], 
              accel_noise: float = 0.05, 
              gyro_noise: float = 0.01) -> List[IMUSample]:
    """Add realistic sensor noise to samples
    
    Args:
        accel_noise: m/s² standard deviation
        gyro_noise: rad/s standard deviation
    """
    noisy_samples = []
    
    for sample in samples:
        noisy_sample = IMUSample(
            timestamp=sample.timestamp,
            accel_x=sample.accel_x + random.gauss(0, accel_noise),
            accel_y=sample.accel_y + random.gauss(0, accel_noise),
            accel_z=sample.accel_z + random.gauss(0, accel_noise),
            gyro_x=sample.gyro_x + random.gauss(0, gyro_noise),
            gyro_y=sample.gyro_y + random.gauss(0, gyro_noise),
            gyro_z=sample.gyro_z + random.gauss(0, gyro_noise),
            mag_x=sample.mag_x + random.gauss(0, 0.5),
            mag_y=sample.mag_y + random.gauss(0, 0.5),
            mag_z=sample.mag_z + random.gauss(0, 0.5)
        )
        noisy_samples.append(noisy_sample)
        
    return noisy_samples


def write_csv(samples: List[IMUSample], filename: str):
    """Write samples to CSV file in BNO055 format"""
    with open(filename, 'w', newline='') as f:
        writer = csv.writer(f)
        
        # Header
        writer.writerow([
            'timestamp_ms', 'accel_x', 'accel_y', 'accel_z',
            'gyro_x', 'gyro_y', 'gyro_z',
            'mag_x', 'mag_y', 'mag_z'
        ])
        
        # Data rows
        for sample in samples:
            writer.writerow([
                f"{sample.timestamp * 1000:.1f}",  # Convert to milliseconds
                f"{sample.accel_x:.6f}",
                f"{sample.accel_y:.6f}",
                f"{sample.accel_z:.6f}",
                f"{sample.gyro_x:.6f}",
                f"{sample.gyro_y:.6f}",
                f"{sample.gyro_z:.6f}",
                f"{sample.mag_x:.3f}",
                f"{sample.mag_y:.3f}",
                f"{sample.mag_z:.3f}"
            ])


def generate_test_ride(sample_rate: float = 100.0) -> List[IMUSample]:
    """Generate a complete test ride with multiple scenarios
    
    Sequence:
    1. Start stationary (5s)
    2. Accelerate (5s)
    3. Cruise straight (10s)
    4. Left corner (8s)
    5. Straight (5s)
    6. Right corner (8s)
    7. Straight (5s)
    8. Brake to stop (4s)
    9. Stationary (5s)
    
    Total: ~55 seconds, 5500 samples at 100Hz
    """
    all_samples = []
    current_time = 0.0
    
    # 1. Stationary start
    print("Generating: Stationary (start)")
    scenario = StationaryScenario(5.0, sample_rate)
    samples = scenario.generate(current_time)
    all_samples.extend(samples)
    current_time += 5.0
    
    # 2. Accelerate to 10 m/s
    print("Generating: Acceleration")
    scenario = AccelerationScenario(5.0, sample_rate, target_speed=10.0, accel_rate=2.0)
    samples = scenario.generate(current_time)
    all_samples.extend(samples)
    current_time += 5.0
    
    # 3. Cruise straight
    print("Generating: Straight cruise")
    scenario = StationaryScenario(10.0, sample_rate)  # TODO: add constant velocity scenario
    samples = scenario.generate(current_time)
    all_samples.extend(samples)
    current_time += 10.0
    
    # 4. Left corner
    print("Generating: Left corner")
    scenario = CornerScenario(8.0, sample_rate, speed=10.0, radius=20.0, direction='left')
    samples = scenario.generate(current_time)
    all_samples.extend(samples)
    current_time += 8.0
    
    # 5. Straight
    print("Generating: Straight")
    scenario = StationaryScenario(5.0, sample_rate)
    samples = scenario.generate(current_time)
    all_samples.extend(samples)
    current_time += 5.0
    
    # 6. Right corner
    print("Generating: Right corner")
    scenario = CornerScenario(8.0, sample_rate, speed=10.0, radius=25.0, direction='right')
    samples = scenario.generate(current_time)
    all_samples.extend(samples)
    current_time += 8.0
    
    # 7. Straight
    print("Generating: Straight")
    scenario = StationaryScenario(5.0, sample_rate)
    samples = scenario.generate(current_time)
    all_samples.extend(samples)
    current_time += 5.0
    
    # 8. Brake to stop
    print("Generating: Braking")
    scenario = BrakingScenario(4.0, sample_rate, initial_speed=10.0, decel_rate=2.5)
    samples = scenario.generate(current_time)
    all_samples.extend(samples)
    current_time += 4.0
    
    # 9. Stationary end
    print("Generating: Stationary (end)")
    scenario = StationaryScenario(5.0, sample_rate)
    samples = scenario.generate(current_time)
    all_samples.extend(samples)
    
    return all_samples


def main():
    parser = argparse.ArgumentParser(description='Generate synthetic IMU data for Vertex')
    parser.add_argument('--output', '-o', default='synthetic_ride.csv',
                        help='Output CSV filename')
    parser.add_argument('--sample-rate', '-r', type=float, default=100.0,
                        help='Sample rate in Hz (default: 100)')
    parser.add_argument('--noise', '-n', type=float, default=0.05,
                        help='Noise level (default: 0.05 m/s²)')
    parser.add_argument('--no-noise', action='store_true',
                        help='Disable noise (perfect data)')
    
    args = parser.parse_args()
    
    print(f"Generating synthetic IMU data at {args.sample_rate} Hz...")
    
    # Generate ride
    samples = generate_test_ride(sample_rate=args.sample_rate)
    
    # Add noise unless disabled
    if not args.no_noise:
        print(f"Adding sensor noise (σ={args.noise} m/s²)...")
        samples = add_noise(samples, accel_noise=args.noise, gyro_noise=args.noise/5)
    
    # Write to CSV
    print(f"Writing {len(samples)} samples to {args.output}...")
    write_csv(samples, args.output)
    
    duration = samples[-1].timestamp
    print(f"\nGenerated {len(samples)} samples ({duration:.1f} seconds)")
    print(f"File: {args.output}")
    print(f"Sample rate: {args.sample_rate} Hz")
    print(f"File size: ~{len(samples) * 100 / 1024:.1f} KB")


if __name__ == '__main__':
    main()

