# API Spec

## Classes
Sensors:Sensor[]
Sensor: {id: int,SensorData[]}
SensorData: {time:Date, amplitude: float}

## Communication between ESP32 and WebApp
### First Page
- switchOn(bool): void
- ping(): void
- setVolumeTotal(float): void
- getVolume(): float

### Second Page

- getSensorsData(): Sensor[]
- getSensorsThreshold(): float[]
- setSensorsThreshold(float[]): void
- getSensorVolume(void): float
- setSensorVolume(float): void

## Communication with Vercel Blob
- saveSensorData(Sensors): void
- getSensorsData():Sensors