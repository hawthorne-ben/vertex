# Understanding the BNO055 Sensor

## 1. Calibration Values (0-3)

The **Calibration** card shows four values (System, Gyro, Accel, Mag) that indicate how well-calibrated each sensor is.

### What They Mean:
- **0** = Not calibrated (don't trust the data)
- **1** = Partially calibrated (okay for testing)
- **2** = Well calibrated (good data)
- **3** = Fully calibrated (best quality)

### How to Calibrate:

**Gyroscope** (usually calibrates automatically):
1. Place sensor on flat surface
2. Keep completely still for 2-3 seconds
3. Should reach 3 quickly

**Accelerometer** (requires movement):
1. Tilt sensor slowly through different orientations
2. Move through 6 positions (up, down, left, right, forward, backward)
3. Should reach 3 after ~10-15 seconds

**Magnetometer** (requires figure-8 motion):
1. Hold sensor and make large figure-8 patterns in the air
2. Do this 10-15 times
3. Should reach 3 after movement

**System** (overall calibration):
- Only shows 3 when other sensors are calibrated
- Indicates fusion algorithm has good data to work with

### Why You Don't See 9.8 in Acceleration

**You're looking at LINEAR ACCELERATION**, which has gravity removed!

The BNO055 gives you **two types** of acceleration:

1. **Total Acceleration** (includes gravity):
   - Standing still: Shows ~9.8 m/s² in the "down" direction
   - This is acceleration due to gravity

2. **Linear Acceleration** (gravity removed) ← **What you're seeing**:
   - Standing still: Shows ~0.0 m/s² in all directions
   - Moving forward: Shows positive acceleration in that direction
   - This is the motion you're actually interested in

**Why linear acceleration is better**:
- Separates gravity from actual motion
- Better for detecting braking, cornering, bumps
- More intuitive for cycling analysis

## 2. Coordinate System (X, Y, Z Orientation)

### BNO055 Default Coordinate System

Looking at the sensor face with the text right-side-up:

```
        +Y (Right)
          ↑
          |
    +X ←──┼──→ -X
   (Back) |  (Front)
          |
          ↓
        -Y (Left)
        
    Z-axis points UP (+Z is up, -Z is down)
```

**Standard BNO055 Orientation**:
- **+X axis**: Points to the RIGHT (when text is upright)
- **+Y axis**: Points to the BACK
- **+Z axis**: Points UP (out of the board)

**Important**: This is the BNO055's internal coordinate system, not necessarily how you mount it!

### Mounting Orientation

When you mount the sensor on your bike:
1. The sensor's coordinate system is fixed
2. But you can mount it in any orientation
3. You'll need to know which way is "forward" for your bike

**Common Bike Mounting**:
- Mount with sensor X-axis aligned with bike's forward direction
- Y-axis aligned with bike's right
- Z-axis aligned with bike's down

**Why this matters**:
- Pitch = uphill/downhill riding
- Roll = leaning into corners
- Yaw = turning/steering

## 3. What the Dashboard Shows

### Orientation (Roll/Pitch/Yaw)

**Roll** (Left/Right lean):
- 0° = Upright (sitting straight)
- +30° = Leaning right into a turn
- -30° = Leaning left into a turn

**Pitch** (Up/Down tilt):
- 0° = Flat road
- +15° = Going uphill
- -15° = Going downhill

**Yaw** (Turning):
- Changes as you turn the bike
- 0° = North (or reference direction)
- Rotates as you turn

### Acceleration (X/Y/Z) - Linear (Gravity Removed)

Values typically range from **-2 to +2 m/s²** for normal riding:

**Standing Still**: All near 0
**Braking**: Negative X-acceleration
**Accelerating**: Positive X-acceleration
**Cornering Right**: Positive Y-acceleration
**Cornering Left**: Negative Y-acceleration
**Hit a bump**: Brief spike in Z-acceleration

### Gyroscope (X/Y/Z) - Rotation Rates

Values in **rad/s** (radians per second):

**Not rotating**: All near 0
**Cornering**: Rotation around Z-axis
**Wobble**: Oscillation in X/Y axes

Typical values: **-1 to +1 rad/s** for normal riding

### Calibration Status

Look for all values to be **3** for best data quality.

## 4. Coordinate System FAQ

### Q: Why don't I see 9.8 m/s² in the acceleration?

**A**: You're looking at **linear acceleration** (gravity removed). This is intentional! For cycling analysis, you want to see the actual motion forces, not gravity.

To see gravity:
- Look at "Total Acceleration" (not implemented in current firmware)
- When stationary, it would show ~9.8 in the down direction

### Q: Which axis is which?

**A**: The BNO055 has a **standard coordinate system**, but you need to know how *you* mounted it:

**Standard BNO055 axes** (when looking at sensor face):
- X-axis: Points RIGHT
- Y-axis: Points BACK  
- Z-axis: Points UP

**For your bike mounting**, you'll need to:
1. Decide which direction is "forward"
2. Mount sensor so X or Y aligns with forward
3. Document the orientation for data analysis

### Q: What should the values be when stationary?

**A**:
- **Roll/Pitch/Yaw**: Some angle (depends on table tilt)
- **Linear Acceleration**: Near 0 in all axes (±0.2 m/s²)
- **Gyroscope**: 0 in all axes
- **Calibration**: All should be 3

### Q: The sensor is flat on my table - why isn't pitch 0°?

**A**: Pitch is relative to gravity, not your table. If your table isn't perfectly level, pitch won't be 0°. This is correct!

To calibrate to "level":
- Note the current pitch value (e.g., 2.5°)
- During analysis, subtract this offset
- Or physically level your table

## 5. Understanding the Data

### Normal Riding Values

| Metric | Typical Range | What It Means |
|--------|--------------|---------------|
| Roll | -30° to +30° | Lean angle |
| Pitch | -15° to +15° | Road grade |
| Linear Accel X | -2 to +2 m/s² | Braking/acceleration |
| Linear Accel Y | -1 to +1 m/s² | Lateral forces |
| Linear Accel Z | -0.5 to +0.5 m/s² | Bumps/vibrations |
| Gyro Z | -1 to +1 rad/s | Turning rate |

### Events to Watch For

**Hard Brake**:
- Large negative X-acceleration (-3 to -5 m/s²)
- Negative pitch if downhill

**Corner**:
- Roll angle changes (10° to 40°)
- Positive Y-acceleration for right turns

**Pothole/Bump**:
- Brief spike in Z-acceleration (>2 m/s²)
- May see in other axes too

**Climb**:
- Positive pitch (5° to 15°)
- Sustained effort

## 6. For Your Cycling Application

Once mounted on your bike:

**Axis Alignment**:
- Choose X or Y to align with bike's forward direction
- Use that axis for pitch measurements
- Perpendicular axis for roll (lean angle)

**Data Interpretation**:
- Pitch → Grade of road
- Roll → Cornering lean angle
- Linear Accel X → Forward/back forces (braking/acceleration)
- Linear Accel Y → Lateral forces (cornering)
- Linear Accel Z → Vertical forces (road quality)

**Calibration Best Practice**:
- Calibrate before every ride
- Keep sensor still for gyro (2 seconds)
- Move through orientations for accel
- Do figure-8s for magnetometer
