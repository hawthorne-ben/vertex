#include "led_manager.h"
#include "config.h"

extern Adafruit_NeoPixel pixel;

// Current breathing state
static float breathingBrightness = 0;
static bool breathingFading = false;
static uint8_t breathingR = 0, breathingG = 0, breathingB = 0;
static bool breathingActive = false;

void initLED() {
  pixel.begin();
  pixel.setBrightness(LED_BRIGHTNESS);
}

void setLed(uint8_t r, uint8_t g, uint8_t b) {
  breathingActive = false; // Stop breathing
  pixel.setPixelColor(0, pixel.Color(r, g, b));
  pixel.show();
}

void setLedBlink(uint8_t r, uint8_t g, uint8_t b, int interval) {
  static unsigned long lastBlink = 0;
  static bool state = false;
  
  breathingActive = false; // Stop breathing
  
  if (millis() - lastBlink > interval) {
    state = !state;
    if (state) {
      pixel.setPixelColor(0, pixel.Color(r, g, b));
    } else {
      pixel.setPixelColor(0, pixel.Color(0, 0, 0));
    }
    pixel.show();
    lastBlink = millis();
  }
}

void setLedDoubleBlink(uint8_t r, uint8_t g, uint8_t b) {
  static unsigned long lastBlink = 0;
  static int blinkCount = 0;
  
  breathingActive = false; // Stop breathing
  
  unsigned long now = millis();
  if (now - lastBlink > 100) {  // 100ms per blink
    blinkCount++;
    if (blinkCount == 1 || blinkCount == 2) {
      pixel.setPixelColor(0, pixel.Color(r, g, b));
    } else if (blinkCount == 3 || blinkCount == 4) {
      pixel.setPixelColor(0, pixel.Color(0, 0, 0));
    } else if (blinkCount >= 8) {
      blinkCount = 0;  // Reset for double blink
    }
    pixel.show();
    lastBlink = now;
  }
}

void setLedBreathing(uint8_t r, uint8_t g, uint8_t b) {
  breathingR = r;
  breathingG = g;
  breathingB = b;
  breathingActive = true;
  breathingBrightness = 0;
  breathingFading = false;
}

void updateBreathingLED() {
  if (!breathingActive) return;
  
  // Breathing effect: fade in/out
  if (breathingFading) {
    breathingBrightness -= 2;
    if (breathingBrightness <= 0) {
      breathingFading = false;
    }
  } else {
    breathingBrightness += 2;
    if (breathingBrightness >= 100) {
      breathingFading = true;
    }
  }
  
  uint8_t r_scaled = (breathingR * breathingBrightness) / 100;
  uint8_t g_scaled = (breathingG * breathingBrightness) / 100;
  uint8_t b_scaled = (breathingB * breathingBrightness) / 100;
  
  pixel.setPixelColor(0, pixel.Color(r_scaled, g_scaled, b_scaled));
  pixel.show();
}
