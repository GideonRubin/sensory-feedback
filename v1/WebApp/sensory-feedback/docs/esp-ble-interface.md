# ESP32 BLE Interface Specification

## Overview
This document outlines the API specifications for the ESP32 to communicate with the web application via Bluetooth Low Energy (BLE). It details the available commands, data formats, and communication protocols necessary for integration.

## Communication Protocols
The ESP32 will communicate with the web application using BLE characteristics defined in the `BleService.ts` file. The primary service UUID and characteristic UUIDs are as follows:

- **Service UUID**: `19b10000-e8f2-537e-4f6c-d104768a1214`
- **Sensor Characteristic UUID**: `19b10001-e8f2-537e-4f6c-d104768a1214`
- **Command Characteristic UUID**: `19b10002-e8f2-537e-4f6c-d104768a1214`

## API Endpoints
The following endpoints are available for communication with the web application:

### First Page API
1. **switchOn(isOn: boolean): void**
   - Description: Turns the LED on or off.
   - Data Format: Sends a single byte (1 for on, 0 for off).

2. **ping(): void**
   - Description: Sends a ping to the web application for connectivity check.
   - Data Format: No data sent.

3. **setVolumeTotal(volume: number): void**
   - Description: Sets the total volume level.
   - Data Format: Sends a float value representing the volume.

4. **getVolume(): float**
   - Description: Retrieves the current volume level.
   - Data Format: Returns a float value representing the volume.

### Second Page API
1. **getSensorsData(): Sensor[]**
   - Description: Retrieves an array of sensor data.
   - Data Format: Returns an array of `Sensor` objects, each containing:
     - `id: number`
     - `data: SensorData[]` where `SensorData` includes:
       - `time: Date`
       - `amplitude: float`

2. **getSensorsThreshold(): float[]**
   - Description: Retrieves the threshold values for sensors.
   - Data Format: Returns an array of float values representing thresholds.

3. **setSensorsThreshold(thresholds: float[]): void**
   - Description: Sets the threshold values for sensors.
   - Data Format: Accepts an array of float values.

4. **getSensorVolume(): float**
   - Description: Retrieves the volume level for a specific sensor.
   - Data Format: Returns a float value representing the sensor volume.

5. **setSensorVolume(volume: number): void**
   - Description: Sets the volume level for a specific sensor.
   - Data Format: Sends a float value representing the volume.

## Data Formats
- **Sensor Object**:
  ```json
  {
    "id": 1,
    "data": [
      {
        "time": "2023-10-01T12:00:00Z",
        "amplitude": 75.5
      }
    ]
  }
  ```

- **SensorData Object**:
  ```json
  {
    "time": "2023-10-01T12:00:00Z",
    "amplitude": 75.5
  }
  ```

## Example Commands
- To turn on the LED:
  ```
  switchOn(true);
  ```

- To get the current volume:
  ```
  float currentVolume = getVolume();
  ```

- To set sensor thresholds:
  ```
  setSensorsThreshold([30.0, 50.0, 70.0, 90.0]);
  ```

## Conclusion
This specification provides the necessary details for the ESP32 developer to implement communication with the web application. Ensure that the data formats and commands are followed as specified to maintain compatibility.