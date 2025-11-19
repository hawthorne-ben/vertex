# NeoPixel Jewel 7 - POC

Simple proof-of-concept to validate NeoPixel wiring on ESP32 Feather.

## Hardware

- ESP32 Feather
- NeoPixel Jewel 7 (7x WS2812B LEDs)
- USB power (testing only - see power notes below)

## Wiring

```
NeoPixel Jewel 7:
├─ 5V      → USB pin on Feather
├─ GND     → GND (connect both GND pins to same ground)
└─ Data In → GPIO 13

Power:
└─ USB cable (provides 5V to USB pin)
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

**Current setup (USB power only)**:
- Works great for testing
- NeoPixels get 5V from USB pin
- Battery connected to JST will power ESP32 but NOT NeoPixels

**For battery operation**:
- Need 3.7V → 5V boost converter (e.g., Adafruit PowerBoost 500)
- Wire LiPo → boost converter → NeoPixel 5V pin
- See main project docs for battery calculations

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
