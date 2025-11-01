  Problem

  - Serial monitor requires USB connection
  - USB connection charges the battery
  - Can't measure real battery drain while charging

  Solutions

  Option 1: Log to SD Card (Hardware Required) 📝

  Add an SD card module to log metrics without USB:
  - Records all performance data to CSV file
  - Remove SD card and analyze data on computer
  - No USB connection needed during testing

  Pros: Complete data capture, works offlineCons: Requires SD card module (~$5),
  can't see real-time data

  Option 2: BLE Logging to Android App 📱⭐ RECOMMENDED

  Stream performance metrics over BLE to your Android app:
  - Add a new BLE characteristic for performance data
  - Display metrics in real-time on your phone
  - No USB connection needed

  Pros: Real-time monitoring, no extra hardware, uses existing BLECons: Requires
  Android app updates

  Option 3: Snapshot on Next Boot 💾

  Store metrics in ESP32 RTC memory (survives deep sleep):
  - Run on battery for X minutes
  - Button press saves snapshot to RTC memory
  - Plug in USB and read saved metrics from previous session

  Pros: No extra hardware, simple implementationCons: Not real-time, only see data
  after the fact

  Option 4: Two-Phase Testing (Quick & Simple) ⚡ EASIEST

  1. USB plugged in (charging): Measure everything EXCEPT battery voltage drop
    - CPU usage, loop timing, I2C speed, BLE overhead
    - These don't change based on power source
  2. Battery only: Just watch the LED blink pattern
    - Fast blink = connected & streaming
    - Run for 30-60 minutes
    - Plug back in USB and check how much voltage dropped
    - Calculate: Current = (voltage_drop * 500mAh / 0.7V) / hours_elapsed

  This gives you power consumption without real-time monitoring!

  Option 5: Remove Monitoring Code for Battery Tests

  Create a "silent mode" compile flag:
  #define SILENT_MODE  // Disable all Serial.print() calls
  Then run on battery, time how long it takes to drop 0.1V, calculate current.

  My Recommendation

  Immediate: Use Option 4 (Two-Phase Testing)
  - Get timing/overhead metrics now (USB connected, doesn't matter if charging)
  - For battery drain tests: unplug, run 30-60 min, plug back in, calculate

  Medium-term: Add Option 2 (BLE Performance Characteristic)
  - I can add a BLE characteristic that streams performance data
  - Update Android app to display it
  - Get real-time power monitoring without USB

  Long-term: Add INA219 current sensor
  - Measures current even while USB is connected (measures battery line
  specifically)
  - No more estimation, real measurements
  - Can log to SD card or stream over BLE

  ---
  Would you like me to:
  1. A) Just document how to use Option 4 (two-phase testing) - simplest
  2. B) Add a BLE performance data characteristic now (streams metrics to phone)
  3. C) Add "silent mode" compile flag (disable Serial for battery tests)
  4. D) Add SD card logging support
  5. E) Some combination?

  For quick testing, Option 4 works great and requires no code changes. But if you
  want real-time monitoring on battery, Option B (BLE characteristic) would be
  ideal for your use case.

  What's your preference?
