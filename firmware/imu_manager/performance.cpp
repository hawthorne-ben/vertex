/*
 * Performance Tracker Implementation
 * Monitors system performance metrics
 */

#include "performance.h"

PerformanceTracker::PerformanceTracker()
  : lastReportTime(0),
    loopStartTime(0) {

  memset(&metrics, 0, sizeof(PerformanceMetrics));
}

void PerformanceTracker::init(float initialBatteryVoltage) {
  lastReportTime = millis();
  metrics.sessionStartTime = millis();
  metrics.batteryVoltageStart = initialBatteryVoltage;
  metrics.batteryVoltageCurrent = initialBatteryVoltage;
  metrics.batteryVoltageMin = initialBatteryVoltage;
  metrics.batteryVoltageMax = initialBatteryVoltage;
  metrics.totalVoltageDropMv = 0;
  metrics.voltageDropPerHour = 0;
  metrics.estimatedCurrentMa = 0;
  metrics.estimatedPowerMw = 0;
}

void PerformanceTracker::recordSample() {
  metrics.sampleCount++;
}

void PerformanceTracker::recordLoopStart() {
  loopStartTime = micros();
}

void PerformanceTracker::recordLoopEnd() {
  unsigned long loopEnd = micros();
  metrics.loopTime = loopEnd - loopStartTime;

  if (metrics.loopTime > metrics.maxLoopTime) {
    metrics.maxLoopTime = metrics.loopTime;
  }
}

void PerformanceTracker::updateMetrics(unsigned long sensorReadTime, unsigned long bleNotifyTime) {
  metrics.sensorReadTime = sensorReadTime;
  metrics.bleNotifyTime = bleNotifyTime;
}

void PerformanceTracker::updateBatteryVoltage(float voltage) {
  metrics.batteryVoltageCurrent = voltage;

  // Track min/max
  if (voltage < metrics.batteryVoltageMin) {
    metrics.batteryVoltageMin = voltage;
  }
  if (voltage > metrics.batteryVoltageMax) {
    metrics.batteryVoltageMax = voltage;
  }

  // Calculate voltage drop
  metrics.totalVoltageDropMv = (metrics.batteryVoltageStart - voltage) * 1000.0;

  // Calculate time elapsed in hours
  unsigned long timeElapsedMs = millis() - metrics.sessionStartTime;
  float hoursElapsed = timeElapsedMs / 3600000.0;

  // Calculate discharge rate (mV/hour)
  if (hoursElapsed > 0.001) {  // Avoid division by zero (>3.6 seconds)
    metrics.voltageDropPerHour = metrics.totalVoltageDropMv / hoursElapsed;

    // Estimate current draw using battery discharge
    // Assuming typical LiPo: 500mAh capacity, voltage drops ~0.7V over full discharge
    // Current (mA) = (voltage drop in V) * (battery capacity in mAh) / (time in hours)
    // Using conservative 500mAh estimate
    const float ASSUMED_BATTERY_CAPACITY_MAH = 500.0;
    const float LIPO_VOLTAGE_RANGE = 0.7;  // 4.2V (full) to 3.5V (empty)

    if (metrics.totalVoltageDropMv > 0) {
      float voltageDropV = metrics.totalVoltageDropMv / 1000.0;
      float dischargePercent = voltageDropV / LIPO_VOLTAGE_RANGE;
      metrics.estimatedCurrentMa = (dischargePercent * ASSUMED_BATTERY_CAPACITY_MAH) / hoursElapsed;

      // Estimated power = V * I (in mW)
      metrics.estimatedPowerMw = voltage * metrics.estimatedCurrentMa;
    }
  }
}

void PerformanceTracker::report(unsigned long sampleIntervalMs) {
  unsigned long now = millis();

  if (now - lastReportTime < PERF_REPORT_INTERVAL_MS) {
    return;
  }

  // Read ESP32 internal temperature
  metrics.cpuTemp = temperatureRead();

  float actualHz = (metrics.sampleCount * 1000.0) / PERF_REPORT_INTERVAL_MS;
  float cpuUsage = (metrics.loopTime / (float)sampleIntervalMs / 1000.0) * 100.0;

  Serial.println("\n=== PERFORMANCE METRICS ===");
  Serial.printf("Sample Rate: %.1f Hz (target: %.0f Hz)\n", actualHz, 1000.0 / sampleIntervalMs);
  Serial.printf("Sensor I2C Read: %lu µs (%.1f ms)\n", metrics.sensorReadTime, metrics.sensorReadTime / 1000.0);
  Serial.printf("BLE Notify: %lu µs (%.1f ms)\n", metrics.bleNotifyTime, metrics.bleNotifyTime / 1000.0);
  Serial.printf("Loop Time: %lu µs (%.1f ms)\n", metrics.loopTime, metrics.loopTime / 1000.0);
  Serial.printf("Max Loop: %lu µs (%.1f ms)\n", metrics.maxLoopTime, metrics.maxLoopTime / 1000.0);
  Serial.printf("CPU Usage: %.1f%%\n", cpuUsage);
  Serial.printf("CPU Temp: %.1f°C\n", metrics.cpuTemp);
  Serial.printf("Free Heap: %d bytes\n", ESP.getFreeHeap());

  // Calculate overhead and available headroom
  unsigned long totalTime = metrics.sensorReadTime + metrics.bleNotifyTime;
  Serial.printf("Total Overhead: %lu µs (%.1f ms)\n", totalTime, totalTime / 1000.0);
  Serial.printf("Available Time: %.1f ms\n", (sampleIntervalMs - (totalTime / 1000.0)));
  Serial.printf("Max Theoretical Hz: %.1f Hz (if zero overhead)\n", 1000000.0 / totalTime);

  // Battery and power metrics
  Serial.println("\n--- BATTERY & POWER ---");
  Serial.printf("Battery Voltage: %.3f V (start: %.3f V)\n",
                metrics.batteryVoltageCurrent, metrics.batteryVoltageStart);
  Serial.printf("Voltage Range: %.3f V to %.3f V\n",
                metrics.batteryVoltageMin, metrics.batteryVoltageMax);
  Serial.printf("Voltage Drop: %.1f mV total (%.1f mV/hour)\n",
                metrics.totalVoltageDropMv, metrics.voltageDropPerHour);

  // Calculate session runtime
  unsigned long sessionMs = millis() - metrics.sessionStartTime;
  unsigned long hours = sessionMs / 3600000;
  unsigned long minutes = (sessionMs % 3600000) / 60000;
  unsigned long seconds = (sessionMs % 60000) / 1000;
  Serial.printf("Session Runtime: %02lu:%02lu:%02lu\n", hours, minutes, seconds);

  if (metrics.estimatedCurrentMa > 0.1) {
    Serial.printf("Estimated Current: %.1f mA\n", metrics.estimatedCurrentMa);
    Serial.printf("Estimated Power: %.1f mW\n", metrics.estimatedPowerMw);

    // Calculate remaining runtime estimate
    const float ASSUMED_BATTERY_CAPACITY_MAH = 500.0;
    float remainingCapacityMah = ASSUMED_BATTERY_CAPACITY_MAH *
                                  (metrics.batteryVoltageCurrent - 3.5) / 0.7;
    float remainingHours = remainingCapacityMah / metrics.estimatedCurrentMa;

    if (remainingHours > 0 && remainingHours < 100) {
      Serial.printf("Est. Runtime Remaining: %.1f hours\n", remainingHours);
    }
  } else {
    Serial.println("Estimated Current: N/A (insufficient runtime)");
  }

  Serial.println("==========================\n");

  // Reset for next report
  metrics.sampleCount = 0;
  metrics.maxLoopTime = 0;
  lastReportTime = now;
}
