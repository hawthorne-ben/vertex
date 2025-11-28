/*
 * NeoPixel Manager
 * Controls NeoPixel Jewel 7 status and tail light
 *
 * Features:
 * - State-based visual feedback (boot, broadcasting, connected, operating, error)
 * - Center LED for status, outer ring for animations
 * - Synchronized tail light flash pattern for maximum visibility
 * - Graceful initialization failure handling
 * - Non-blocking updates
 */

#ifndef NEOPIXEL_MANAGER_H
#define NEOPIXEL_MANAGER_H

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include "config.h"

// System states
enum NeoPixelState {
  STATE_BOOTING,       // White chase on all 7 LEDs
  STATE_BROADCASTING,  // Blue blink center + white spinner ring
  STATE_CONNECTED,     // Blue solid center + blue fast spinner ring
  STATE_OPERATING,     // All 7 red synchronized flash (tail light)
  STATE_BRAKING,       // All 7 red fast strobe → solid (brake light override)
  STATE_ERROR          // Red fast blink center + red pulse ring
};

class NeoPixelManager {
public:
  NeoPixelManager();

  // Initialize NeoPixels - returns false if init fails (e.g., no 5V power)
  bool init();

  // Update LED animation (call in main loop)
  void update(bool connected, bool streaming, bool braking, uint8_t ledMode);

  // Check if NeoPixels are initialized and working
  bool isInitialized() const { return initialized; }

  // Enable/disable the LED animation
  void enable();
  void disable();
  bool isEnabled() const { return enabled; }

  // Set error state
  void setError(bool error) { errorState = error; }

  // Show shutdown visual (turn off all LEDs)
  void showShutdown();

private:
  Adafruit_NeoPixel pixels;
  bool initialized;
  bool enabled;
  bool errorState;
  unsigned long bootStartTime;

  // Current state
  NeoPixelState currentState;
  NeoPixelState previousState;

  // Animation timing
  unsigned long lastUpdateTime;
  uint8_t animationStep;
  unsigned long brakeStateStartTime;  // Track when braking state started

  // Pattern implementations
  void updateBooting();
  void updateBroadcasting();
  void updateConnected();
  void updateOperating();
  void updateBraking();
  void updateError();

  // Helper functions
  void setAllPixels(uint32_t color);
  void clearAllPixels();
  uint8_t breatheValue(unsigned long period);  // Breathing effect (0-255)
};

#endif // NEOPIXEL_MANAGER_H
