import { bleService } from './BleService';
import { config } from '../config';

// Types defined in the API Spec
export interface SensorData {
  time: Date;
  amplitude: number;
}

export interface Sensor {
  id: number;
  data: SensorData[];
}

export type Sensors = Sensor[];

export const BleEndpoints = {
  LED: 'LED',
  PING: 'PING',
  VOLUME_TOTAL: 'VOLUME_TOTAL',
  SENSOR_THRESHOLD: 'SENSOR_THRESHOLD',
  SENSOR_VOLUME: 'SENSOR_VOLUME',
} as const;

// Helper class for simulation state
class SensorSimulator {
  private tick: number = 0;
  private readonly updateSpeed: number = 0.15; // Speed of the walking cycle

  constructor(_count: number) {
    // 
  }

  getNextValues(): number[] {
    this.tick += this.updateSpeed;

    // Simulate Walking Gait
    // Cycle: 0 to 2PI
    
    // Right Foot (0: RF, 2: RB) - Phase 0
    // Left Foot  (1: LF, 3: LB) - Phase PI
    
    // Within a foot: Heel (Back) strikes first, then Toe (Front)
    // Front is slightly delayed relative to Back
    
    const rightPhase = this.tick;
    const leftPhase = this.tick + Math.PI;
    
    // Function to calculate pressure based on phase
    // returns 0-100
    const calcPressure = (phase: number, offset: number) => {
      // Use sine wave, normalize to 0-1, clip negative values (foot in air)
      // Raise to power to make peak narrower (sharper impact)
      const val = Math.sin(phase + offset);
      return val > 0 ? Math.pow(val, 2) * 100 : 0;
    };

    // Offsets
    // Back sensor peaks earlier -> 0 offset
    // Front sensor peaks later -> 0.5 offset (roughly 1/6 of cycle? PI/6 is approx 0.5)
    
    const rb = calcPressure(rightPhase, 0);       // Right Back
    const rf = calcPressure(rightPhase, -0.6);    // Right Front (delayed)
    
    const lb = calcPressure(leftPhase, 0);        // Left Back
    const lf = calcPressure(leftPhase, -0.6);     // Left Front (delayed)

    // Add some random noise
    const noise = () => (Math.random() - 0.5) * 5;

    // Map to id: 0=RF, 1=LF, 2=RB, 3=LB
    return [
      Math.max(0, Math.min(100, rf + noise())),
      Math.max(0, Math.min(100, lf + noise())),
      Math.max(0, Math.min(100, rb + noise())),
      Math.max(0, Math.min(100, lb + noise())),
    ];
  }
}

const simulator = new SensorSimulator(4);
let latestSensorData: Sensors = [];
// Raw normalized values (0-100) before calibration subtraction - used for calibration
let latestRawNormalized: number[] = [0, 0, 0, 0];
// Calibration baselines stored in normalized 0-100 range for display adjustment
let calibrationBaselines: number[] = [0, 0, 0, 0];

/**
 * Communication between ESP32 and WebApp
 */
export const EspApi = {
  onDisconnect: (callback: () => void): void => {
    bleService.onDisconnect(callback);
  },
  connect: async (): Promise<void> => {
    await bleService.connect();
    bleService.subscribeToSensor((jsonString) => {
        try {
            const parsed = JSON.parse(jsonString);
            latestSensorData = parsed.map((item: any) => ({
                id: item.id,
                data: item.data.map((d: any) => {
                    // Normalize 12-bit ADC (0-4095) to 0-100 range
                    const normalized = Math.min(100, (Number(d.amplitude) / 4095) * 100);
                    // Store raw normalized value for calibration use
                    latestRawNormalized[item.id] = normalized;
                    // Subtract calibration baseline so display shows force relative to rest
                    const calibrated = Math.max(0, normalized - (calibrationBaselines[item.id] || 0));
                    return { time: new Date(), amplitude: calibrated };
                })
            }));
        } catch (e) {
            console.error("Error parsing sensor data", e);
        }
    });
  },
  disconnect: (): void => {
    bleService.disconnect();
  },
  isConnected: (): boolean => {
    return bleService.isConnected();
  },

  subscribeToSensor: (callback: (value: string) => void): void => {
    bleService.subscribeToSensor(callback);
  },
  
  unsubscribeFromSensor: (callback: (value: string) => void): void => {
    bleService.unsubscribeFromSensor(callback);
  },

  write: async (endpoint: string, data: string): Promise<void> => {
    const command = `${endpoint}:${data}`;
    const encoder = new TextEncoder();
    return bleService.write(encoder.encode(command));
  },
  read: async (endpoint: string): Promise<string> => {
     // 1. Send the endpoint name to the device to request data
     const encoder = new TextEncoder();
     // Using "GET:ENDPOINT" convention or just "ENDPOINT" depending on preference. 
     // Given "arduino should get string endpoint", sending just the endpoint might be ambiguous if it looks like a write.
     // But write uses "ENDPOINT:DATA". Read uses "GET:ENDPOINT" seems safer.
     const command = `GET:${endpoint}`;
     await bleService.write(encoder.encode(command));
     
     // 2. Wait for the device to update the characteristic value
     await new Promise(resolve => setTimeout(resolve, 200));

     // 3. Read the response
     const value = await bleService.read();
     const decoder = new TextDecoder('utf-8');
     return decoder.decode(value);
  },

  // First Page
  switchOn: async (isOn: boolean): Promise<void> => {
    // Use string command to avoid null byte (0x00) issue with Arduino String
    const command = `POWER:${isOn ? '1' : '0'}`;
    const encoder = new TextEncoder();
    return bleService.write(encoder.encode(command));
  },
  ping: (): void => {
    // TODO: Implement communication with ESP32
    console.log('ping');
  },
  setVolumeTotal: (volume: number): void => {
    EspApi.write(BleEndpoints.VOLUME_TOTAL, `${volume}`);
  },
  getVolume: (): number => {
    // TODO: Implement communication with ESP32
    console.log('getVolume');
    return 0.0;
  },
  getBatteryHealth: async (): Promise<number> => {
     // TODO: Implement communication with ESP32
     // For now return dummy data
     return 90.0;
  },

  // Second Page
  getSensorsData: (): Sensor[] => {
    // console.log('Checking stubs:', config.useStubs); 
    if (config.useStubs) {
      const values = simulator.getNextValues();
      return values.map((val, index) => ({
        id: index,
        data: [{ time: new Date(), amplitude: val }]
      }));
    }
    return latestSensorData;
  },
  getSensorsThreshold: (): number[] => {
    // TODO: Implement communication with ESP32
    console.log('getSensorsThreshold');
    return [];
  },
  setSensorsThreshold: (thresholds: number[]): void => {
    // Convert from 0-100 range to raw ADC units (0-4095)
    const rawThresholds = thresholds.map(v => Math.round((v / 100) * 4095));
    const command = `SENSOR_THRESHOLD:${rawThresholds.join(',')}`;
    const encoder = new TextEncoder();
    bleService.write(encoder.encode(command));
  },
  getSensorVolume: (id: number): number => {
    // TODO: Implement communication with ESP32
    console.log('getSensorVolume', id);
    return 0.0;
  },
  setSensorVolume: (id: number, volume: number): void => {
    const data = `${id},${volume}`;
    EspApi.write(BleEndpoints.SENSOR_VOLUME, data);
  },

  calibrateSensors: async () => {
    // Use the raw normalized values (before calibration subtraction)
    calibrationBaselines = [...latestRawNormalized];
    // Convert from normalized (0-100) back to raw ADC (0-4095)
    const rawBaselines = calibrationBaselines.map(v => Math.round((v / 100) * 4095));
    const command = `CALIBRATE:${rawBaselines.join(',')}`;
    const encoder = new TextEncoder();
    await bleService.write(encoder.encode(command));
  },
};

/**
 * Communication with Vercel Blob
 */
export const blobService = {
  saveSensorData: (sensors: Sensors): void => {
    // TODO: Implement communication with Vercel Blob
    console.log('saveSensorData', sensors);
  },
  getSensorsData: (): Sensors => {
    // TODO: Implement communication with Vercel Blob
    console.log('getSensorsData (Blob)');
    return [];
  },
};
