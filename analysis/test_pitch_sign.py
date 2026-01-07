#!/usr/bin/env python3
"""Test pitch sign convention"""

import sys
import math
sys.path.insert(0, '/Users/bhawthorne/dev/vertex/packages/vtx-parser/python')

from vtx_parser import decode_vtx

# Load the file
with open('/Users/bhawthorne/dev/vertex/analysis/data/sample-recordings/hawk_descent_2.vtx', 'rb') as f:
    vtx_file = decode_vtx(f.read())

header = vtx_file.header
samples = vtx_file.records

start_ms = header.start_timestamp

print("Sample timestamp analysis (first 100 samples after 30s):")
print()

count = 0
for sample in samples:
    ts = sample.timestamp
    offset_sec = (ts - start_ms) / 1000.0

    # Look at descent start
    if 30 <= offset_sec < 35:
        # Calculate pitch both ways
        ax = sample.accel_x
        ay = sample.accel_y
        az = sample.accel_z
        mag_yz = math.sqrt(ay**2 + az**2)

        pitch_positive = math.atan2(-ax, mag_yz) * 180 / math.pi
        pitch_negative = math.atan2(ax, mag_yz) * 180 / math.pi
        bno_pitch = sample.pitch

        print(f"T+{offset_sec:5.2f}s: ax={ax:6.2f}  BNO={bno_pitch:6.2f}°  atan2(-ax)={pitch_positive:6.2f}°  atan2(+ax)={pitch_negative:6.2f}°")

        count += 1
        if count >= 20:
            break
