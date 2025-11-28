# NeoPixel Jewel 7 - POC

Simple proof-of-concept to validate NeoPixel wiring on ESP32 Feather.

## Hardware

- ESP32 Feather
- NeoPixel Jewel 7 (7x WS2812B LEDs)
- USB power (testing only - see power notes below)

## Wiring

```
NeoPixel Jewel 7:
├─ 5V      → 3.7V-5V Boost Converter 5V output
├─ GND     → Common GND
└─ Data In → GPIO 13

Boost Converter (3.7V→5V):
├─ VIN     → ESP32 BAT pin (3.7V from battery)
├─ GND     → Common GND
├─ 5V      → NeoPixel 5V
└─ EN      → VIN (always on) OR GPIO 27 (software control)
```

## Arduino IDE Setup

1. Install library: `Adafruit NeoPixel` (via Library Manager)
2. Select board: `Adafruit ESP32 Feather`
3. Upload `neopixel.ino`

## Expected Behavior

Red strobe pattern:
- 50ms ON (all 7 LEDs red, full brightness)
- 100ms OFF
- Repeats continuously

This creates an attention-grabbing tail light effect.

## Power Notes

**Production setup (Battery + Boost Converter)**:
- 3.7V LiPo battery powers ESP32 via BAT pin
- Boost converter (3.7V→5V) powers NeoPixels at 5V
- EN pin can be tied to VIN (always on) or GPIO 27 (software controlled)
- Recommended: Adafruit MiniBoost 5V @ 1A or similar

**Testing with USB power**:
- Can temporarily power NeoPixels from USB 5V pin during development
- Not suitable for production (no battery operation)
- Use boost converter for final assembly

## Power Draw

- 7 LEDs at full red: ~140mA @ 5V
- With 50% duty cycle strobe: ~70mA average
- ESP32: ~100mA
- **Total system**: ~170mA average

## Next Steps

1. Validate wiring with this POC
2. Add boost converter for battery operation
3. Integrate with main IMU firmware for motion-reactive patterns
4. Add ambient light sensor for auto-dimming
