/*
  Rui Santos & Sara Santos - Random Nerd Tutorials
  Complete project details at https://RandomNerdTutorials.com/esp32-web-bluetooth/
  Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files.
  The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
*/
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Arduino.h>
#include "DFRobotDFPlayerMini.h"

// ---------- DFPlayer ----------
HardwareSerial mp3Serial(2);
DFRobotDFPlayerMini player;

// ---------- State ----------
int currentTrack = 0;     // 0 = stopped, 1..4 playing
int winnerIndex  = -1;

static const int PRESS_THRESHOLD = 200;
static const int SWITCH_MARGIN   = 80;
static const uint32_t RELEASE_MS = 150;

static const int FIXED_VOLUME = 30;

uint32_t lastAboveThresholdMs = 0;

BLEServer* pServer = NULL;
BLECharacteristic* pSensorCharacteristic = NULL;
BLECharacteristic* pLedCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;

// Define sensor pins (ADC pins on ESP32)
const int sensorPins[] = {34, 35, 32, 33}; 
const int numSensors = 4;
const int ledPin = 2; // Use the appropriate GPIO pin for your setup

// See the following for generating UUIDs:
// https://www.uuidgenerator.net/
#define SERVICE_UUID        "19b10000-e8f2-537e-4f6c-d104768a1214"
#define SENSOR_CHARACTERISTIC_UUID "19b10001-e8f2-537e-4f6c-d104768a1214"
#define LED_CHARACTERISTIC_UUID "19b10002-e8f2-537e-4f6c-d104768a1214"

class MyServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
  };

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
  }
};

class MyCharacteristicCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pLedCharacteristic) {
    String value = pLedCharacteristic->getValue();
    if (value.length() > 0) {
      Serial.print("Characteristic event, written: ");
      Serial.println(static_cast<int>(value[0])); // Print the integer value

      int receivedValue = static_cast<int>(value[0]);
      if (receivedValue == 1) {
        digitalWrite(ledPin, HIGH);
      } else {
        digitalWrite(ledPin, LOW);
      }
    }
  }
};

void setup() {
  Serial.begin(115200);
  pinMode(ledPin, OUTPUT);
  
  // Initialize sensor pins
  for(int i = 0; i < numSensors; i++) {
    pinMode(sensorPins[i], INPUT);
  }

  // Create the BLE Device
  BLEDevice::init("ESP32");

  // Create the BLE Server
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  // Create the BLE Service
  BLEService *pService = pServer->createService(SERVICE_UUID);

  // Create a BLE Characteristic
  pSensorCharacteristic = pService->createCharacteristic(
                      SENSOR_CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ   |
                      BLECharacteristic::PROPERTY_WRITE  |
                      BLECharacteristic::PROPERTY_NOTIFY |
                      BLECharacteristic::PROPERTY_INDICATE
                    );

  // Create the ON button Characteristic
  pLedCharacteristic = pService->createCharacteristic(
                      LED_CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_WRITE
                    );

  // Register the callback for the ON button characteristic
  pLedCharacteristic->setCallbacks(new MyCharacteristicCallbacks());

  // https://www.bluetooth.com/specifications/gatt/viewer?attributeXmlFile=org.bluetooth.descriptor.gatt.client_characteristic_configuration.xml
  // Create a BLE Descriptor
  pSensorCharacteristic->addDescriptor(new BLE2902());
  pLedCharacteristic->addDescriptor(new BLE2902());

  // Start the service
  pService->start();

  // Start advertising
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(false);
  pAdvertising->setMinPreferred(0x0);  // set value to 0x00 to not advertise this parameter
  BLEDevice::startAdvertising();
  Serial.println("Waiting a client connection to notify...");

  // ---------- DFPlayer Init ----------
  mp3Serial.begin(9600, SERIAL_8N1, 16, 17);
  delay(300);

  if (!player.begin(mp3Serial)) {
    Serial.println("DFPlayer init failed!");
    // We don't want to halt BLE if Audio fails, so we won't loop forever here
  } else {
    player.outputDevice(DFPLAYER_DEVICE_SD);
    player.EQ(DFPLAYER_EQ_NORMAL);
    player.volume(FIXED_VOLUME);
    Serial.println("DFPlayer Ready. Files: 0001.mp3 .. 0004.mp3");
  }
}

void loop() {
  // ---- Read Sensors ----
  int sensorValues[numSensors];
  int maxValue = 0;
  int maxIndex = -1;
  unsigned long timestamp = millis();

  for (int i = 0; i < numSensors; i++) {
    sensorValues[i] = analogRead(sensorPins[i]);
    if (sensorValues[i] > maxValue) {
      maxValue = sensorValues[i];
      maxIndex = i;
    }
  }

  // ---- Audio Logic (Always Active) ----
  // press tracking with release delay
  if (maxValue >= PRESS_THRESHOLD) {
    lastAboveThresholdMs = timestamp;
  }

  bool pressed = (timestamp - lastAboveThresholdMs) <= RELEASE_MS;

  if (!pressed) {
    if (currentTrack != 0) {
      player.stop();
      currentTrack = 0;
      winnerIndex = -1;
      // Serial.println("STOP");
    }
  } else {
    // Determine winner
    if (winnerIndex == -1) {
      winnerIndex = maxIndex;
    } else {
      int prevVal = sensorValues[winnerIndex];
      // Switch if another sensor is significantly stronger
      if (maxIndex != winnerIndex && maxValue >= prevVal + SWITCH_MARGIN) {
        winnerIndex = maxIndex;
      }
    }

    int desiredTrack = winnerIndex + 1; // 1..4

    // Play ONLY on change
    if (desiredTrack != currentTrack) {
      currentTrack = desiredTrack;
      player.play(currentTrack);
      Serial.print("Play track ");
      Serial.println(currentTrack);
    }
  }

  // ---- BLE Logic ----
  // notify changed value
  if (deviceConnected) {
    String json = "[";

    for (int i = 0; i < numSensors; i++) {
      if (i > 0) json += ",";
      
      // Construct Sensor Object: { "id": 1, "data": [ { "time": "...", "amplitude": 75.5 } ] }
      json += "{\"id\":";
      json += i;
      json += ",\"data\":[{\"time\":\"";
      json += timestamp; // Sending millis as a simplified timestamp
      json += "\",\"amplitude\":";
      json += sensorValues[i];
      json += "}]}";
    }
    json += "]";

    pSensorCharacteristic->setValue(json.c_str());
    pSensorCharacteristic->notify();
    
    // Serial debugging (optional, can be commented out for speed)
    // Serial.print("Notified: ");
    // Serial.println(json);
  }

  // disconnecting
  if (!deviceConnected && oldDeviceConnected) {
    Serial.println("Device disconnected.");
    delay(500); // give the bluetooth stack the chance to get things ready
    pServer->startAdvertising(); // restart advertising
    Serial.println("Start advertising");
    oldDeviceConnected = deviceConnected;
  }
  // connecting
  if (deviceConnected && !oldDeviceConnected) {
    // do stuff here on connecting
    oldDeviceConnected = deviceConnected;
    Serial.println("Device Connected");
  }

  delay(25); // Faster loop for audio responsiveness
}