#ifndef SD_LOGGER_H
#define SD_LOGGER_H

#include <Arduino.h>

// Function prototypes
bool initSD();
bool createLogFile();
void logSensorData();
bool rotateLogFile();
void flushLogBuffer();
void closeLogFile();

// TODO: SD card module not yet available - using serial logging as fallback
// When SD card module is added:
// 1. Install SD.h library
// 2. Uncomment SD card code sections
// 3. Update SPI connections
// 4. Test file I/O

#endif // SD_LOGGER_H
