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
#include <SPI.h>
#include <SD.h>
#include "driver/i2s_std.h"

// ---------- Audio & Pin Configuration ----------
const float VOL = 1.0f;

#define I2S_BCLK_PIN  GPIO_NUM_27
#define I2S_WS_PIN    GPIO_NUM_14
#define I2S_DOUT_PIN  GPIO_NUM_22
#define SD_CS_PIN     5
#define SPI_SCK       18
#define SPI_MISO      19
#define SPI_MOSI      23

// Define sensor pins (ADC pins on ESP32)
const int sensorPins[] = {34, 35, 32, 33}; 
const int numSensors = 4;
const int ledPin = 2; // Use the appropriate GPIO pin for your setup

// Audio Task Globals
volatile int targetTrack = 0;   
volatile float targetPan = 0.5f;
i2s_chan_handle_t tx_handle = NULL;

// ---------- BLE State ----------
BLEServer* pServer = NULL;
BLECharacteristic* pSensorCharacteristic = NULL;
BLECharacteristic* pLedCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;

// See the following for generating UUIDs:
// https://www.uuidgenerator.net/
#define SERVICE_UUID        "19b10000-e8f2-537e-4f6c-d104768a1214"
#define SENSOR_CHARACTERISTIC_UUID "19b10001-e8f2-537e-4f6c-d104768a1214"
#define LED_CHARACTERISTIC_UUID "19b10002-e8f2-537e-4f6c-d104768a1214"

// ---------- Audio Task ----------
void audioTask(void *parameter) {
  File wavFile;
  // Increase buffer size slightly for stability if needed, or keep 512
  const size_t bufSize = 1024; 
  int16_t *buffer = (int16_t *)heap_caps_malloc(bufSize, MALLOC_CAP_DMA);
  
  if (buffer == NULL) {
    Serial.println("Failed to allocate audio buffer");
    vTaskDelete(NULL);
    return;
  }

  int currentTrackID = 0;
  bool firstBuffer = false;
  
  // Enable the channel
  i2s_channel_enable(tx_handle);

  while (true) {
    // Check if we need to switch tracks
    if (targetTrack != currentTrackID) {
      if (wavFile) wavFile.close();
      currentTrackID = targetTrack;
      
      if (currentTrackID > 0) {
        char path[16];
        // Format: /0001.wav, /0002.wav, etc. matches common SD structure
        snprintf(path, sizeof(path), "/%04d.wav", currentTrackID);
        
        if (SD.exists(path)) {
            wavFile = SD.open(path);
            if (wavFile) {
              // Skip WAV header (typical 44 bytes)
              wavFile.seek(44);
              firstBuffer = true; 
            } else {
              currentTrackID = 0;
            }
        } else {
            // File doesn't exist
            currentTrackID = 0;
        }
      }
    }

    if (currentTrackID > 0 && wavFile && wavFile.available()) {
      float gainL = (1.0f - targetPan) * VOL;
      float gainR = targetPan * VOL;

      size_t bytesRead = wavFile.read((uint8_t*)buffer, bufSize);
      size_t samples = bytesRead / 2; // 16-bit samples

      // Apply volume/panning
      for (int i = 0; i < samples; i+=2) {
         // Simple fade-in for first buffer to avoid clicks could go here
         float smoothFactor = 1.0f;
         if (firstBuffer) {
           smoothFactor = (float)i / samples; 
         }
         
         // Stereo processing: even indices are Left (usually), odd are Right
         // Note: buffer contains interleaved 16-bit samples [L, R, L, R...]
         if (i+1 < samples) {
             buffer[i]   = (int16_t)((float)buffer[i]   * gainL * smoothFactor);
             buffer[i+1] = (int16_t)((float)buffer[i+1] * gainR * smoothFactor);
         }
      }
      
      firstBuffer = false; 
      size_t bytesWritten = 0;
      i2s_channel_write(tx_handle, buffer, bytesRead, &bytesWritten, portMAX_DELAY);
      
      // Loop the track if we reach the end but target hasn't changed
      if (bytesRead < bufSize) {
          wavFile.seek(44); 
      }
    } else {
      // Silence when no track is playing
      memset(buffer, 0, bufSize);
      size_t bytesWritten = 0;
      i2s_channel_write(tx_handle, buffer, bufSize, &bytesWritten, portMAX_DELAY);
      // Small delay to yield to other tasks
      vTaskDelay(10 / portTICK_PERIOD_MS);
    }
  }
}

// ---------- BLE Callbacks ----------
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
  analogReadResolution(12); // Ensure we use 12-bit resolution matching new sketch
  for(int i = 0; i < numSensors; i++) {
    pinMode(sensorPins[i], INPUT);
  }

  // ---------- SD & I2S Setup ----------
  // Initialize SPI for SD Card
  SPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI, SD_CS_PIN);
  if (!SD.begin(SD_CS_PIN)) {
    Serial.println("SD Init Failed!");
    // We continue mostly so BLE can still work, but audio won't
  } else {
    Serial.println("SD Card Ready");
  }

  // Initialize I2S
  i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  i2s_new_channel(&chan_cfg, &tx_handle, NULL);
  i2s_std_config_t std_cfg = {
      .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(22050), // Matches typical WAV sample rate
      .slot_cfg = I2S_STD_MSB_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
      .gpio_cfg = {
        .mclk = I2S_GPIO_UNUSED, 
        .bclk = I2S_BCLK_PIN, 
        .ws = I2S_WS_PIN, 
        .dout = I2S_DOUT_PIN, 
        .din = I2S_GPIO_UNUSED
      }
  };
  i2s_channel_init_std_mode(tx_handle, &std_cfg);
  
  // Start Audio Task on Core 0 (leaving Core 1 for Arduino Loop/BLE)
  xTaskCreatePinnedToCore(audioTask, "AudioTask", 4096, NULL, 10, NULL, 0);
  Serial.println("Audio Task Started.");

  // ---------- BLE Init ----------
  BLEDevice::init("ESP32");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pSensorCharacteristic = pService->createCharacteristic(
                      SENSOR_CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ   |
                      BLECharacteristic::PROPERTY_WRITE  |
                      BLECharacteristic::PROPERTY_NOTIFY |
                      BLECharacteristic::PROPERTY_INDICATE
                    );

  pLedCharacteristic = pService->createCharacteristic(
                      LED_CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_WRITE
                    );

  pLedCharacteristic->setCallbacks(new MyCharacteristicCallbacks());

  pSensorCharacteristic->addDescriptor(new BLE2902());
  pLedCharacteristic->addDescriptor(new BLE2902());

  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(false);
  pAdvertising->setMinPreferred(0x0);  
  BLEDevice::startAdvertising();
  Serial.println("Waiting a client connection to notify...");
}

void loop() {
  // ---- Read Sensors ----
  int sensorValues[numSensors];
  int maxVal = 0;
  int maxIdx = -1;
  unsigned long timestamp = millis();

  for (int i = 0; i < numSensors; i++) {
    sensorValues[i] = analogRead(sensorPins[i]);
    if (sensorValues[i] > maxVal) {
      maxVal = sensorValues[i];
      maxIdx = i;
    }
  }

  // ---- Audio Logic (New Logic) ----
  static int currentWinner = -1;
  static uint32_t lastDisconnectTime = 0;

  // Simple threshold logic from new sketch
  if (maxVal > 300) { 
    if (maxIdx != currentWinner) {
      currentWinner = maxIdx;
      targetTrack = currentWinner + 1; // Tracks 1..4
      // Pan left for 0, 2; Right for 1, 3
      targetPan = (currentWinner == 0 || currentWinner == 2) ? 0.0f : 1.0f;
      // Optional logging
      // Serial.printf("New Winner: %d, Track: %d\n", currentWinner, targetTrack);
    }
  } else {
    targetTrack = 0; // Stop
    currentWinner = -1;
  }

  // ---- BLE Logic (Existing Logic) ----
  if (deviceConnected) {
    // Construct JSON string for notification
    String json = "[";
    for (int i = 0; i < numSensors; i++) {
      if (i > 0) json += ",";
      
      // Formatting: { "id": 1, "data": [ { "time": "...", "amplitude": 75.5 } ] }
      json += "{\"id\":";
      json += i;
      json += ",\"data\":[{\"time\":\"";
      json += timestamp;
      json += "\",\"amplitude\":";
      json += sensorValues[i];
      json += "}]}";
    }
    json += "]";

    pSensorCharacteristic->setValue(json.c_str());
    pSensorCharacteristic->notify();
  }

  // BLE Maintenance
  if (!deviceConnected && oldDeviceConnected) {
    Serial.println("Device disconnected.");
    delay(500); 
    pServer->startAdvertising(); 
    Serial.println("Start advertising");
    oldDeviceConnected = deviceConnected;
  }
  
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
    Serial.println("Device Connected");
  }

  delay(25); // Loop delay
}