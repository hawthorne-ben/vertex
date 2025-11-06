"""
Quick test script for real VTX file
"""

from vtx_parser import decode_vtx

# Test with the actual cornering sample file
sample_file = "../../../analysis/data/sample-recordings/cornering_clockwise_1.vtx"

print("Loading VTX file...")
with open(sample_file, "rb") as f:
    data = f.read()

print(f"File size: {len(data):,} bytes\n")

# Decode header only first (fast)
print("=== HEADER INFO ===")
vtx_file = decode_vtx(data, header_only=True)
header = vtx_file.header

print(f"Magic: {repr(header.magic)}")
print(f"Version: {header.version_major}.{header.version_minor}")
print(f"Record count: {header.record_count:,}")
print(f"Sample rate: {header.sample_rate} Hz")
print(f"Duration: {(header.end_timestamp - header.start_timestamp) / 1000:.2f} seconds")
print(f"Start time: {header.start_timestamp}")
print(f"End time: {header.end_timestamp}")
print(f"Record format: 0x{header.record_format:02x}")
print(f"Has magnetometer: {bool(header.record_format & 0x01)}")
print(f"Has quaternion: {bool(header.record_format & 0x02)}")

# Now decode full file
print("\n=== DECODING FULL FILE ===")
try:
    vtx_file = decode_vtx(data)
except ValueError as e:
    print(f"ERROR: {e}")
    print("\nFile appears truncated or has incorrect format in header.")
    print("Attempting to read what's available...")

    # Calculate how many records actually fit
    from vtx_parser import VTXDecoder
    decoder = VTXDecoder(data)
    decoder.read_header()

    available_bytes = len(data) - decoder.header.data_offset
    max_possible_records = available_bytes // decoder.record_size

    print(f"Available data bytes: {available_bytes}")
    print(f"Record size: {decoder.record_size}")
    print(f"Max records that fit: {max_possible_records}")
    print(f"Header claims: {decoder.header.record_count}")

    vtx_file = decode_vtx(data, max_records=max_possible_records)

print(f"Records loaded: {len(vtx_file.records):,}")
print(f"Metadata: {vtx_file.metadata}")

# Show first few records
print("\n=== FIRST 5 RECORDS ===")
for i, record in enumerate(vtx_file.records[:5]):
    print(f"Record {i}:")
    print(f"  Time: {record.timestamp} ms")
    print(f"  Accel: ({record.accel_x:.3f}, {record.accel_y:.3f}, {record.accel_z:.3f}) m/s²")
    print(f"  Gyro: ({record.gyro_x:.3f}, {record.gyro_y:.3f}, {record.gyro_z:.3f}) rad/s")
    if record.mag_x is not None:
        print(f"  Mag: ({record.mag_x:.3f}, {record.mag_y:.3f}, {record.mag_z:.3f}) µT")

# Compute actual sample rate
if len(vtx_file.records) > 1:
    time_diffs_ms = []
    for i in range(len(vtx_file.records) - 1):
        diff = vtx_file.records[i + 1].timestamp - vtx_file.records[i].timestamp
        time_diffs_ms.append(diff)

    avg_diff_ms = sum(time_diffs_ms) / len(time_diffs_ms)
    computed_sample_rate = 1000.0 / avg_diff_ms

    print(f"\n=== COMPUTED SAMPLE RATE ===")
    print(f"Average time between samples: {avg_diff_ms:.3f} ms")
    print(f"Computed sample rate: {computed_sample_rate:.2f} Hz")
    print(f"Header sample rate: {header.sample_rate:.2f} Hz")
    print(f"Difference: {abs(computed_sample_rate - header.sample_rate):.2f} Hz")

# Basic statistics
print("\n=== ACCELERATION STATISTICS ===")
accel_x_values = [r.accel_x for r in vtx_file.records]
accel_y_values = [r.accel_y for r in vtx_file.records]
accel_z_values = [r.accel_z for r in vtx_file.records]

import statistics

print(f"Accel X: mean={statistics.mean(accel_x_values):.3f}, stdev={statistics.stdev(accel_x_values):.3f}")
print(f"Accel Y: mean={statistics.mean(accel_y_values):.3f}, stdev={statistics.stdev(accel_y_values):.3f}")
print(f"Accel Z: mean={statistics.mean(accel_z_values):.3f}, stdev={statistics.stdev(accel_z_values):.3f}")

print("\nTest completed successfully!")
