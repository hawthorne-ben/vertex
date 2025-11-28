/*
 * NeoPixel Manager Implementation
 * State-based visual feedback system
 */

#include "neopixel_manager.h"

NeoPixelManager::NeoPixelManager()
  : pixels(NEOPIXEL_NUM_PIXELS, NEOPIXEL_DATA_PIN, NEO_GRBW + NEO_KHZ800),
    initialized(false),
    enabled(true),
    errorState(false),
    bootStartTime(0),
    currentState(STATE_BOOTING),
    previousState(STATE_BOOTING),
    lastUpdateTime(0),
    animationStep(0),
    brakeStateStartTime(0) {
}

bool NeoPixelManager::init() {
  Serial.println("\n=== NeoPixel Manager Init ===");
  Serial.print("Data Pin: GPIO ");
  Serial.println(NEOPIXEL_DATA_PIN);
  Serial.print("Number of pixels: ");
  Serial.println(NEOPIXEL_NUM_PIXELS);

  // Initialize NeoPixel library
  pixels.begin();
  Serial.println("✓ pixels.begin() called");

  // Clear all pixels
  pixels.clear();
  pixels.show();
  Serial.println("✓ Pixels cleared");

  // Brief test: flash all LEDs white to verify initialization
  Serial.println("Running initialization test (white flash)...");
  for (int i = 0; i < NEOPIXEL_NUM_PIXELS; i++) {
    pixels.setPixelColor(i, pixels.Color(50, 50, 50));  // Dim white
  }
  pixels.show();
  delay(200);

  pixels.clear();
  pixels.show();

  initialized = true;
  bootStartTime = millis();  // Track boot animation start
  currentState = STATE_BOOTING;

  Serial.println("✓ NeoPixel initialization complete");
  Serial.println("  Note: LEDs require 5V (USB power or boost converter)");
  Serial.println("  Starting boot animation\\n");

  return initialized;
}

void NeoPixelManager::update(bool connected, bool streaming, bool braking, uint8_t ledMode) {
  if (!initialized || !enabled) {
    return;
  }

  // LED mode 0 = OFF
  if (ledMode == 0) {
    clearAllPixels();
    pixels.show();
    return;
  }

  // Determine current state based on inputs
  NeoPixelState newState = currentState;

  if (errorState) {
    newState = STATE_ERROR;
  } else if (braking) {
    newState = STATE_BRAKING;  // Brake override (highest priority after error)
  } else if (millis() - bootStartTime < 2000) {
    newState = STATE_BOOTING;
  } else if (!connected) {
    newState = STATE_BROADCASTING;
  } else if (connected && !streaming) {
    newState = STATE_CONNECTED;
  } else if (connected && streaming) {
    newState = STATE_OPERATING;
  }

  // Reset animation if state changed
  if (newState != previousState) {
    animationStep = 0;
    lastUpdateTime = 0;

    // Reset brake timer when entering braking state
    if (newState == STATE_BRAKING) {
      brakeStateStartTime = millis();
    }

    previousState = newState;
    Serial.print("[NEOPIXEL] State change: ");
    Serial.println(newState);
  }

  currentState = newState;

  // Update pattern based on current state
  switch (currentState) {
    case STATE_BOOTING:
      updateBooting();
      break;
    case STATE_BROADCASTING:
      updateBroadcasting();
      break;
    case STATE_CONNECTED:
      updateConnected();
      break;
    case STATE_OPERATING:
      updateOperating();
      break;
    case STATE_BRAKING:
      updateBraking();
      break;
    case STATE_ERROR:
      updateError();
      break;
  }
}

void NeoPixelManager::updateBooting() {
  // Center: Yellow pulse (0.5Hz, breathing effect)
  // Ring: Fast white spinner (60ms per LED) with fade trail
  unsigned long now = millis();

  // Update every 60ms for smooth continuous animation
  if (now - lastUpdateTime < 60) {
    return;
  }
  lastUpdateTime = now;

  clearAllPixels();

  // Center LED: Yellow pulse (0.5Hz = 2000ms period) at 15% brightness
  uint8_t yellowBrightness = breatheValue(2000) * 0.15;  // 15% max brightness
  pixels.setPixelColor(0, pixels.Color(yellowBrightness, yellowBrightness, 0));  // Yellow pulse

  // Outer ring: Fast white spinner with 5-LED fade trail at 15% brightness
  // Dramatic drop between positions 1 and 2, gradual fade after
  for (int i = 0; i < 6; i++) {
    uint8_t ledIndex = ((animationStep - i) % 6) + 1;
    uint8_t brightness;

    if (i == 0) {
      // Lead LED: 100% brightness (of the 15% max)
      brightness = 255 * 0.15;
    } else if (i == 1) {
      // First trail: 35% of lead (still bright)
      brightness = 255 * 0.15 * 0.35;
    } else if (i == 2) {
      // Second trail: 12% of lead (dramatic drop)
      brightness = 255 * 0.15 * 0.12;
    } else if (i == 3) {
      // Third trail: 6% of lead
      brightness = 255 * 0.15 * 0.06;
    } else if (i == 4) {
      // Fourth trail: 3% of lead
      brightness = 255 * 0.15 * 0.03;
    } else {
      // Fifth position: off
      brightness = 0;
    }

    if (brightness > 0) {
      pixels.setPixelColor(ledIndex, pixels.Color(brightness, brightness, brightness));
    }
  }

  pixels.show();
  animationStep++;
}

void NeoPixelManager::updateBroadcasting() {
  // Center: Green pulse (0.5Hz, breathing effect)
  // Ring: Fast white spinner (60ms per LED) with fade trail
  unsigned long now = millis();

  // Update every 60ms for smooth continuous animation
  if (now - lastUpdateTime < 60) {
    return;
  }
  lastUpdateTime = now;

  clearAllPixels();

  // Center LED: Green pulse (0.5Hz = 2000ms period) at 15% brightness
  uint8_t greenBrightness = breatheValue(2000) * 0.15;  // 15% max brightness
  pixels.setPixelColor(0, pixels.Color(0, greenBrightness, 0));  // Green pulse

  // Outer ring: Fast white spinner with 5-LED fade trail at 15% brightness
  // Dramatic drop between positions 1 and 2, gradual fade after
  for (int i = 0; i < 6; i++) {
    uint8_t ledIndex = ((animationStep - i) % 6) + 1;
    uint8_t brightness;

    if (i == 0) {
      // Lead LED: 100% brightness (of the 15% max)
      brightness = 255 * 0.15;
    } else if (i == 1) {
      // First trail: 35% of lead (still bright)
      brightness = 255 * 0.15 * 0.35;
    } else if (i == 2) {
      // Second trail: 12% of lead (dramatic drop)
      brightness = 255 * 0.15 * 0.12;
    } else if (i == 3) {
      // Third trail: 6% of lead
      brightness = 255 * 0.15 * 0.06;
    } else if (i == 4) {
      // Fourth trail: 3% of lead
      brightness = 255 * 0.15 * 0.03;
    } else {
      // Fifth position: off
      brightness = 0;
    }

    if (brightness > 0) {
      pixels.setPixelColor(ledIndex, pixels.Color(brightness, brightness, brightness));
    }
  }

  pixels.show();
  animationStep++;
}

void NeoPixelManager::updateConnected() {
  // Center: Solid blue
  // Ring: Fast blue spinner (60ms per LED) with fade trail
  unsigned long now = millis();

  // Update every 60ms for smooth continuous animation
  if (now - lastUpdateTime < 60) {
    return;
  }
  lastUpdateTime = now;

  clearAllPixels();

  // Center LED: Solid blue at 15% brightness
  pixels.setPixelColor(0, pixels.Color(0, 0, 38));  // Blue (15% of 255)

  // Outer ring: Fast blue spinner with 5-LED fade trail at 15% brightness
  // Dramatic drop between positions 1 and 2, gradual fade after
  for (int i = 0; i < 6; i++) {
    uint8_t ledIndex = ((animationStep - i) % 6) + 1;
    uint8_t brightness;

    if (i == 0) {
      // Lead LED: 100% brightness (of the 15% max)
      brightness = 255 * 0.15;
    } else if (i == 1) {
      // First trail: 35% of lead (still bright)
      brightness = 255 * 0.15 * 0.35;
    } else if (i == 2) {
      // Second trail: 12% of lead (dramatic drop)
      brightness = 255 * 0.15 * 0.12;
    } else if (i == 3) {
      // Third trail: 6% of lead
      brightness = 255 * 0.15 * 0.06;
    } else if (i == 4) {
      // Fourth trail: 3% of lead
      brightness = 255 * 0.15 * 0.03;
    } else {
      // Fifth position: off
      brightness = 0;
    }

    if (brightness > 0) {
      pixels.setPixelColor(ledIndex, pixels.Color(0, 0, brightness));  // Blue trail
    }
  }

  pixels.show();
  animationStep++;
}

void NeoPixelManager::updateOperating() {
  // All 7 LEDs synchronized flash:
  // 100ms BRIGHT → 100ms OFF → 20ms DIM → 780ms OFF (1000ms total)
  unsigned long now = millis();
  unsigned long cycleTime = now % 1000;  // Position in 1Hz cycle

  // Determine which phase we're in
  uint32_t color = 0;  // Default: OFF

  if (cycleTime < 100) {
    // Phase 1: BRIGHT (0-100ms)
    color = pixels.Color(255, 0, 0);  // Full red
  } else if (cycleTime < 200) {
    // Phase 2: OFF (100-200ms)
    color = 0;
  } else if (cycleTime < 220) {
    // Phase 3: DIM (200-220ms)
    color = pixels.Color(25, 0, 0);  // Dim red
  } else {
    // Phase 4: OFF (220-1000ms)
    color = 0;
  }

  // Apply to all 7 LEDs
  setAllPixels(color);
  pixels.show();
}

void NeoPixelManager::updateBraking() {
  // Brake light pattern: 10Hz fast strobe for 500ms, then solid red for remainder
  // Pattern: 500ms of 50ms on/off strobe, then 1500ms solid
  unsigned long now = millis();
  unsigned long timeInBrakingState = now - brakeStateStartTime;
  uint32_t color;

  if (timeInBrakingState < 500) {
    // Phase 1: Fast strobe (10Hz = 50ms on, 50ms off)
    if ((timeInBrakingState % 100) < 50) {
      color = pixels.Color(255, 0, 0);  // Full red
    } else {
      color = 0;  // Off
    }
  } else {
    // Phase 2: Solid red for remainder of brake display duration
    color = pixels.Color(255, 0, 0);  // Full red
  }

  // Apply to all 7 LEDs
  setAllPixels(color);
  pixels.show();
}

void NeoPixelManager::updateError() {
  // Center: Fast red blink (4Hz = 250ms period, 125ms on/off)
  // Ring: Slow red pulse (breathe effect, 2s period)
  unsigned long now = millis();

  // Update every 10ms for smooth breathing
  if (now - lastUpdateTime < 10) {
    return;
  }
  lastUpdateTime = now;

  clearAllPixels();

  // Center LED: Fast red blink (4Hz) at 15% brightness
  if ((now / 125) % 2 == 0) {
    pixels.setPixelColor(0, pixels.Color(38, 0, 0));  // Red (15% of 255)
  }

  // Outer ring: Slow red pulse (2000ms period) at 15% brightness
  uint8_t breathe = breatheValue(2000) * 0.15;  // 15% max brightness
  uint32_t pulseColor = pixels.Color(breathe, 0, 0);  // Red pulse
  for (uint8_t i = 1; i <= 6; i++) {
    pixels.setPixelColor(i, pulseColor);
  }

  pixels.show();
}

void NeoPixelManager::enable() {
  if (!initialized) {
    return;
  }

  enabled = true;
  Serial.println("NeoPixel enabled");
}

void NeoPixelManager::disable() {
  if (!initialized) {
    return;
  }

  enabled = false;

  // Turn off all LEDs
  clearAllPixels();
  pixels.show();

  Serial.println("NeoPixel disabled");
}

void NeoPixelManager::setAllPixels(uint32_t color) {
  for (int i = 0; i < NEOPIXEL_NUM_PIXELS; i++) {
    pixels.setPixelColor(i, color);
  }
}

void NeoPixelManager::clearAllPixels() {
  pixels.clear();
}

uint8_t NeoPixelManager::breatheValue(unsigned long period) {
  // Generate smooth sine-wave breathing effect (0-255)
  unsigned long now = millis();
  float phase = (float)(now % period) / (float)period;  // 0.0 to 1.0
  float sineWave = sin(phase * 2.0 * PI);  // -1.0 to 1.0
  float normalized = (sineWave + 1.0) / 2.0;  // 0.0 to 1.0
  return (uint8_t)(normalized * 255.0);  // 0 to 255
}

void NeoPixelManager::showShutdown() {
  if (!initialized) {
    return;
  }

  // Turn off all LEDs completely (sleep mode)
  uint32_t offColor = pixels.Color(0, 0, 0);
  setAllPixels(offColor);
  pixels.show();

  Serial.println("[NEOPIXEL] LEDs turned off for sleep mode");
}
