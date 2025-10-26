#ifndef LED_MANAGER_H
#define LED_MANAGER_H

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>

// Function prototypes
void initLED();
void setLed(uint8_t r, uint8_t g, uint8_t b);
void setLedBlink(uint8_t r, uint8_t g, uint8_t b, int interval);
void setLedDoubleBlink(uint8_t r, uint8_t g, uint8_t b);
void setLedBreathing(uint8_t r, uint8_t g, uint8_t b);
void updateBreathingLED();

#endif // LED_MANAGER_H
