# Vibration Damping Hardware Guide

## The Problem

Your BNO055 is experiencing **±7,000 deg/s gyro saturation** from road vibration at 40-160 Hz. Firmware fixes alone won't solve this - you need mechanical damping.

---

## Recommended Solutions (Easiest to Hardest)

### ⭐ Option 1: Kyosho Zeal Gel (BEST for small electronics)

**What it is:** Double-sided vibration absorption gel tape designed for RC helicopter gyros (very similar application to your IMU!)

**Why it's perfect:**
- ✅ Designed for small, lightweight electronics (your use case!)
- ✅ Used extensively in drones/RC for IMU/gyro mounting
- ✅ Excellent at 40-160 Hz vibration absorption
- ✅ Very sticky, can be washed and reused
- ✅ No additional mounting hardware needed

**Specifications:**
- **3mm thickness** (Blue) - For light boards like yours (145mm x 45mm sheet)
- **5mm thickness** (Green) - For heavier electronics

**Where to buy:**
- Amazon: "Kyosho Z8006 Zeal Vibration Absorption Sheet" (~$10-15)
- A-Main Hobbies: KYOZ8006-3B (3mm blue)
- Any RC hobby shop

**How to use in your enclosure:**
1. Cut small squares (10mm x 10mm) from sheet
2. Place 4 pieces on corners of BNO055 board
3. Press into 3D printed enclosure base
4. No screws needed - gel holds it firmly

**Pros:**
- ✅ Designed for this exact problem
- ✅ RC community swears by it
- ✅ Easy to implement
- ✅ Cheap (~$10)
- ✅ Can remove/reposition

**Cons:**
- ⚠️ Need to order from hobby shop (not Home Depot)

---

### Option 2: 3M VHB Foam Tape + Mass

**What it is:** Double-sided foam tape with viscoelastic properties

**Recommended product:** 3M VHB 4910 or 5952 (1/16" thick)

**Implementation:**
1. Attach small brass/steel weight (~20-50g) to BNO055 board with screws
2. Apply 3M VHB foam tape to bottom of weight
3. Stick assembly into 3D printed enclosure
4. Foam isolates vibration, mass adds inertia

**Why mass helps:** Research shows "the lighter the electronics, the harder to dampen." Adding 20-50g makes damping 5-10x more effective.

**Where to buy:**
- Amazon: "3M VHB Tape"
- McMaster-Carr: Various thicknesses
- Hardware stores (less selection)

**Pros:**
- ✅ Easy to source
- ✅ Very strong adhesive
- ✅ Weather resistant
- ✅ Can adjust mass separately

**Cons:**
- ⚠️ Need to find/attach weight
- ⚠️ More complex assembly
- ⚠️ Heavier overall

---

### Option 3: Off-the-Shelf Drone/RC Flight Controller Mount

**What it is:** Pre-made vibration isolation mount from drone industry

**Recommended products:**
- "Anti-Vibration Shock Absorber for APM/Pixhawk" (~$5-10 on Amazon/AliExpress)
- Glass fiber plate with rubber damping balls
- Multiple stiffness options

**Typical specs:**
- Mounting plate: 50mm x 50mm
- 4 rubber damping balls at corners
- M3 mounting holes

**Implementation:**
1. Mount BNO055 board to center plate
2. Mount assembly in your enclosure via the corner balls
3. May need to design mount points in your 3D print

**Where to buy:**
- Amazon: Search "Pixhawk anti vibration mount"
- AliExpress: ~$2-3 (slow shipping)
- Drone hobby shops

**Pros:**
- ✅ Proven in drone applications (same vibration issues)
- ✅ Complete solution
- ✅ Cheap ($5-10)
- ✅ Adjustable damping (different ball stiffness)

**Cons:**
- ⚠️ Might be too large for your enclosure (50mm x 50mm)
- ⚠️ Need to modify 3D model for mount points
- ⚠️ Overkill for your small board

---

### Option 4: Sorbothane (Premium solution)

**What it is:** Viscoelastic polyurethane - the gold standard for vibration isolation

**Performance:** Absorbs >50% of vibration energy at 10-30,000 Hz (perfect for your 40-160 Hz)

**Where to buy:**
- Thorlabs: Small adhesive feet (expensive but quality)
- IsolateIt.com: Sheets you can cut
- McMaster-Carr: Various sizes/hardnesses

**Recommended:** 1/8" (3.2mm) sheet, 30 durometer (soft)

**Implementation:**
1. Cut 4 small squares (10mm x 10mm)
2. Stick to corners of BNO055 board
3. Press into enclosure base

**Pros:**
- ✅ Best performance (lab-grade)
- ✅ Lasts forever (millions of cycles)
- ✅ Precise engineering data available

**Cons:**
- ❌ Expensive ($20-40)
- ❌ Overkill for your application
- ❌ May be too soft without additional mass

---

### Option 5: DIY Foam from Drone Community

**What it is:** The cheap DIY approach used by drone builders

**Materials:**
- Soft packing foam (like shipping foam)
- OR silicone earplugs (cut in half)
- Double-sided carpet tape

**Implementation:**
1. Cut 4 small cubes (5mm x 5mm x 10mm) of soft foam
2. Stick to corners of BNO055 with carpet tape
3. Press into enclosure

**Where to get foam:**
- Packing foam from Amazon box
- 3M Double-sided foam tape (craft stores)
- Silicone earplugs (drugstore)

**Pros:**
- ✅ Free/nearly free
- ✅ Easy to experiment
- ✅ Can try different foam types

**Cons:**
- ⚠️ Inconsistent performance
- ⚠️ Foam degrades over time
- ⚠️ Trial and error required

---

## 3D Printing Integration Strategies

### Strategy A: Corner Posts (for gel/foam on corners)

```
┌─────────────────┐
│   BNO055 Board  │
│   [IMU Chip]    │
│                 │
│ ●             ● │  ← Gel/foam pads
└─────────────────┘
  |             |
  |             |    ← 3D printed posts
┌─────────────────┐
│  Enclosure Base │
└─────────────────┘
```

**3D Model Changes:**
1. Add 4 small posts (2-3mm tall) at corners of mounting area
2. Posts provide targets for gel/foam compression
3. BNO055 "floats" on gel between board and posts

**CAD tips:**
- Post diameter: 4-5mm
- Height: 2-3mm (to compress gel/foam slightly)
- Chamfer tops for easier assembly

---

### Strategy B: Suspended Platform (for complete isolation)

```
    ┌───────────┐
    │ BNO055    │
    │ Board     │
    └───────────┘
         |
    [Gel/Foam]
         |
    ┌───────────┐
    │ Platform  │  ← Printed platform
    └───────────┘
    /           \
  [Damper]   [Damper]  ← Corner rubber balls or foam
  /             \
┌─────────────────┐
│  Enclosure Base │
└─────────────────┘
```

**3D Model Changes:**
1. Design a small platform (30mm x 30mm x 2mm)
2. Add corner mounting points for dampers
3. Platform suspends in enclosure
4. BNO055 mounts to platform with gel

**Pros:** Best isolation
**Cons:** More complex, takes up vertical space

---

### Strategy C: Mass-Loaded Mount (for heavy damping)

```
┌─────────────────┐
│   BNO055 Board  │
└─────────────────┘
┌─────────────────┐
│ Brass/Steel     │  ← Metal weight (20-50g)
│ Weight Plate    │     (can be 3D printed pocket for coins!)
└─────────────────┘
    [Gel/Foam]
┌─────────────────┐
│  Enclosure Base │
└─────────────────┘
```

**3D Model Changes:**
1. Design a pocket/cavity below IMU mounting area
2. Size for 4-8 US quarters (5.6g each = 22-45g total)
3. Or add mounting holes for brass plate
4. BNO055 screws to weight, weight sits on gel/foam

**Clever trick:** Use quarters or washers as ballast - cheap and effective!

---

## My Recommendation

### Phase 1: Quick Test (Order Today)
**Get Kyosho Zeal 3mm gel** (~$10, Amazon Prime)

**Assembly:**
1. Cut four 10mm x 10mm squares from sheet
2. Stick to corners of BNO055 board (blue gel side down)
3. Press board (gel side down) into your enclosure
4. Done in 5 minutes!

**Modify your 3D print:**
- Add 4 corner posts (5mm dia x 2mm tall) where BNO055 sits
- This gives gel something to compress against

**Why start here:**
- ✅ Fastest to test ($10, arrives in 2 days)
- ✅ Proven solution (RC community uses for gyros)
- ✅ Non-permanent (can try other options)
- ✅ Minimal enclosure changes

### Phase 2: If Still Noisy (After Test)
Add mass:
- Attach 4-6 quarters (22-33g) to board with double-sided tape
- Or 3D print a weight pocket
- Or use brass M3 standoffs as ballast

### Phase 3: If STILL Noisy (Nuclear Option)
Try Sorbothane or complete isolation mount (Strategy B above)

---

## Testing Your Solution

After installing damping, record a 2-minute test ride and check:

### Success Criteria:
```python
# Load new test file
data = load_vtx_file('test_with_damping.vtx')
df = data['samples']

# Check gyro readings
print("Gyro X max:", np.degrees(df['gyro_x'].max()), "deg/s")
print("Gyro Y max:", np.degrees(df['gyro_y'].max()), "deg/s")
print("Gyro Z max:", np.degrees(df['gyro_z'].max()), "deg/s")

# Target: <200 deg/s for all axes
# Current (bad): ±7,000 deg/s
```

**Good results:** ±50-200 deg/s (reasonable bike rotation)
**Acceptable:** ±200-500 deg/s (still workable)
**Bad:** ±1000+ deg/s (need more damping)

---

## Expected Performance

### Current State (no damping)
```
Road vibration: 40-160 Hz @ high amplitude
↓
BNO055 gyro: ±7,000 deg/s saturation
↓
Euler angles: Unbounded accumulation
↓
Data: UNUSABLE
```

### With Gel Damping
```
Road vibration: 40-160 Hz @ high amplitude
↓
Gel damping: -10 to -20 dB attenuation
↓
BNO055 gyro: ±50-200 deg/s (reasonable)
↓
Euler angles: Clean, bounded ±180°
↓
Data: USABLE ✓
```

### With Gel + Mass
```
Road vibration: 40-160 Hz @ high amplitude
↓
Mass inertia: Mechanical low-pass filter
↓
Gel damping: -20 to -30 dB attenuation
↓
BNO055 gyro: ±10-50 deg/s (excellent)
↓
Euler angles: Very clean
↓
Data: EXCELLENT ✓✓
```

---

## Budget Comparison

| Solution | Cost | Performance | Ease | Speed |
|----------|------|-------------|------|-------|
| Kyosho Zeal Gel | $10 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 2 days |
| 3M VHB + Mass | $15 | ⭐⭐⭐⭐ | ⭐⭐⭐ | 3 days |
| RC Mount | $5-10 | ⭐⭐⭐⭐⭐ | ⭐⭐ | 1-2 weeks |
| Sorbothane | $20-40 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 3-5 days |
| DIY Foam | $0-5 | ⭐⭐ | ⭐⭐⭐ | Today |

---

## Quick Shopping List (Get Started Now)

### Option 1: Premium (Best performance, arrives fast)
- [ ] Kyosho Zeal 3mm Gel (Amazon, $10-15)
- [ ] 8x M3 brass washers for ballast (Home Depot, $2)

### Option 2: Budget (Good performance, DIY)
- [ ] 3M Double-sided foam tape (Home Depot, $5)
- [ ] 8x US quarters for weight (your pocket, $2)
- [ ] Small packing foam (Amazon box, free)

### Option 3: Premium Lab Grade
- [ ] Sorbothane 1/8" sheet (McMaster/Thorlabs, $20-30)
- [ ] Brass plate or washers for weight ($5-10)

---

## Bottom Line

**Order Kyosho Zeal gel TODAY** ($10 on Amazon). It's:
- ✅ Designed exactly for this problem
- ✅ Used by thousands of RC/drone builders for IMU vibration
- ✅ Cheap and easy
- ✅ Perfect for small electronics
- ✅ Non-permanent (can try other things)

Your 3D printed enclosure just needs 4 small corner posts (2-3mm tall) where the BNO055 sits. The gel goes between the board and the posts.

Test with just gel first. If gyro is still >500 deg/s, add mass (quarters or brass) between the gel and enclosure.

**This will likely solve 80-90% of your vibration problem** for $10 and 5 minutes of work.

---

## Resources

- [Ardupilot Vibration Damping Guide](https://ardupilot.org/copter/docs/common-vibration-damping.html) - Drone community best practices
- [Kyosho Zeal on Amazon](https://www.amazon.com/Kyosho-Z8006-Vibration-Absorption-Sheet/dp/B002U2GS2K)
- [SBG Systems - Handling Vibrations](https://www.sbg-systems.com/support/technology/how-to-handle-vibrations/) - Professional IMU manufacturer guidance

**Next:** Order gel → Install → Test ride → Profit! 🚴‍♂️
