/**
 * NeoPixel Jewel 7 - Basic POC
 *
 * Hardware:
 * - ESP32 Feather
 * - NeoPixel Jewel 7
 * - USB power (5V from USB pin)
 *
 * Wiring:
 * - NeoPixel 5V      → USB pin on Feather
 * - NeoPixel GND     → GND (both GND pins)
 * - NeoPixel Data In → GPIO 13
 *
 * This is a simple proof-of-concept to validate wiring.
 * Creates a red strobe pattern suitable for bike tail light.
 */

#include <Adafruit_NeoPixel.h>

#define NEOPIXEL_PIN 13
#define NUM_PIXELS 7

// Try RGBW instead of RGB - your symptoms suggest 4-channel LEDs
// GRBW is most common for RGBW NeoPixels
Adafruit_NeoPixel pixels(NUM_PIXELS, NEOPIXEL_PIN, NEO_GRBW + NEO_KHZ800);

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n\n=== NeoPixel Jewel 7 - POC Test ===");
  Serial.print("Data Pin: GPIO ");
  Serial.println(NEOPIXEL_PIN);
  Serial.print("Number of pixels: ");
  Serial.println(NUM_PIXELS);

  Serial.println("\nInitializing NeoPixels...");
  pixels.begin();
  Serial.println("✓ pixels.begin() called");

  // Don't set brightness - let library use default
  Serial.println("Using default brightness");

  Serial.println("Clearing pixels...");
  pixels.clear();
  pixels.show();
  Serial.println("✓ Initial clear complete");

  Serial.println("\n=== Starting rotation pattern ===\n");
}

void loop() {
  // Rotate through outer 6 LEDs (skip center LED 0)
  // LEDs 1-6 in red, 100ms each

  for(int i = 1; i <= 6; i++) {
    pixels.clear();
    // Red only for tail light
    pixels.setPixelColor(i, pixels.Color(255, 0, 0));
    pixels.show();
    delay(100);
  }
}
