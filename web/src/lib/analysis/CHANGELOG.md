# IMU Analysis Algorithm Changelog

Patch = tuning constant change. Minor = new metric or structural pipeline change. Major = breaking schema or output format change.

To recompute affected rides after a bump:
```bash
npx tsx --env-file=.env.migrate.local scripts/recompute-all-rides.ts
# or for a single ride:
ONLY_RIDE_ID=<uuid> npx tsx --env-file=.env.migrate.local scripts/recompute-all-rides.ts
```

---

## 0.1.0 — 2026-06-16

Initial versioned baseline. Prior history carried version strings (up to 9.2.0) with no defined semantic contract or changelog. Reset to 0.1.0.

Pipeline at this version:
- 6-axis input (accel xyz, gyro xyz) at native sample rate (25Hz V1, 104Hz V2)
- Braking pre-pass: zero-phase Butterworth on accel_x/z (5Hz), pitch-from-accel, forward-backward EMA baseline (0.1Hz)
- Pass 1: BPF gyro_x/z + accel_x at 0.3–10.0Hz (stability); HPF accel_z at 0.5Hz (roughness); HPF accel_y at 1.0Hz (position)
- Pass 2: windowed RMS — stability/roughness 3.0s window 0.5s hop; braking 0.75s window 0.2s hop
- Pass 3: interpolate to 5Hz output; position detection via accel_y amplitude vs gyro_z
- Stability weight: gyro_roll × 0.7 + gyro_yaw × 0.3 (empirically derived)
- Output: four metric streams — pedaling_efficiency, riding_position, surface_roughness, braking
