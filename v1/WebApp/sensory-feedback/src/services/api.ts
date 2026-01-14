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
} as const;

// Helper class for simulation state
class SensorSimulator {
  private lastValues: number[];

  constructor(count: number) {
    this.lastValues = new Array(count).fill(0);
  }

  getNextValues(): number[] {
    this.lastValues = this.lastValues.map(last => {
      const change = (Math.random() - 0.5) * 20;
      let newValue = Math.max(0, Math.min(100, last + change));
      // Occasional spike
      if (Math.random() > 0.95) newValue = Math.min(100, newValue + 30);
      return newValue;
    });
    return this.lastValues;
  }
}

const simulator = new SensorSimulator(4);

/**
 * Communication between ESP32 and WebApp
 */
export const EspApi = {
  connect: async (): Promise<void> => {
    return bleService.connect();
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
    // Send raw byte 1 or 0 for LED command to match firmware expectation
    const payload = new Uint8Array([isOn ? 1 : 0]);
    return bleService.write(payload);
  },
  ping: (): void => {
    // TODO: Implement communication with ESP32
    console.log('ping');
  },
  setVolumeTotal: (volume: number): void => {
    // TODO: Implement communication with ESP32
    console.log('setVolumeTotal', volume);
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
    // TODO: Implement communication with ESP32
    // console.log('getSensorsData (ESP) - No Stubs');
    return [];
  },
  getSensorsThreshold: (): number[] => {
    // TODO: Implement communication with ESP32
    console.log('getSensorsThreshold');
    return [];
  },
  setSensorsThreshold: (thresholds: number[]): void => {
    // TODO: Implement communication with ESP32
    console.log('setSensorsThreshold', thresholds);
  },
  getSensorVolume: (): number => {
    // TODO: Implement communication with ESP32
    console.log('getSensorVolume');
    return 0.0;
  },
  setSensorVolume: (volume: number): void => {
    // TODO: Implement communication with ESP32
    console.log('setSensorVolume', volume);
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
