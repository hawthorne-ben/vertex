#include "ntp_sync.h"
#include "config.h"
#include <WiFi.h>
#include <time.h>

bool syncNTP() {
  Serial.println("[NTP] Configuring time...");
  
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
  
  // Wait for time sync (max 10 seconds)
  int attempts = 0;
  struct tm timeinfo;
  while (!getLocalTime(&timeinfo) && attempts < 20) {
    delay(500);
    attempts++;
  }
  
  if (attempts < 20) {
    Serial.print("[NTP] Time synchronized: ");
    Serial.println(&timeinfo, "%Y-%m-%d %H:%M:%S");
    return true;
  } else {
    Serial.println("[NTP] Time sync failed!");
    return false;
  }
}
