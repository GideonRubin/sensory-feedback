# API Spec

## Communication between ESP32 and WebApp
### First Page
- switchOn(bool): void
- ping(): void
- setVolumeTotal(float): void
- getVolume(): float

### Second Page
Sensor: {id: int,[SensorData]}
SensorData: {time:Date, amplitude: float}

- getSensorsData(): [Sensor]
- getSensorsThreshold(): [float]
- setSensorsThreshold([float]): void
- getSensorVolume(void): float
- setSensorVolume(float): void

## Communication with Vercel Blob
- saveSensorData([SensorData])