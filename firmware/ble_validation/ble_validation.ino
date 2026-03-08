/*
 * BLE Validation - Bluedroid (known working)
 * Confirming phone can still discover this board.
 */

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>

#define LED_PIN 21
#define SERVICE_UUID "12345678-1234-5678-1234-56789abcdef0"

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("=== BLE Validation (Bluedroid) ===");

  BLEDevice::init("Vertex-V2");
  BLEServer* server = BLEDevice::createServer();
  BLEService* svc = server->createService(SERVICE_UUID);
  svc->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  BLEDevice::startAdvertising();

  Serial.println("Advertising as 'Vertex-V2' (Bluedroid)");
}

void loop() {
  rgbLedWriteOrdered(LED_PIN, LED_COLOR_ORDER_RGB, 0, 30, 0);
  delay(100);
  rgbLedWriteOrdered(LED_PIN, LED_COLOR_ORDER_RGB, 0, 0, 0);
  delay(900);
}
