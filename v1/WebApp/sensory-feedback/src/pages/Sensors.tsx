import { useState, useEffect } from 'react'
import { EspApi } from '../services/api'
import { SensorCard } from '@/components/SensorCard'

// Define the 4 sensors
const SENSORS_CONFIG = [
  { id: 0, label: "Right Front", color: "#f97316" }, // Orange
  { id: 1, label: "Left Front", color: "#3b82f6" },  // Blue
  { id: 2, label: "Right Back", color: "#ec4899" },  // Pink
  { id: 3, label: "Left Back", color: "#8b5cf6" },   // Purple
]

export function Sensors() {
  // State for thresholds and volumes
  // Initialize with some defaults
  const [thresholds, setThresholds] = useState<number[]>([50, 50, 50, 50])
  const [volumes, setVolumes] = useState<number[]>([80, 80, 80, 80])
  
  // History of data for charts (e.g. last 50 points)
  const [history, setHistory] = useState<number[][]>(
    SENSORS_CONFIG.map(() =>  new Array(40).fill(0))
  )

  useEffect(() => {
    // Initial fetch of configuration if available
    // const storedThresholds = EspApi.getSensorsThreshold();
    // if (storedThresholds.length) setThresholds(storedThresholds);
    
    const interval = setInterval(() => {
        // 1. Fetch latest data from API
        const sensorsData = EspApi.getSensorsData();
        
        // 2. Update history
        setHistory(prevHistory => {
            return prevHistory.map((sensorHistory, index) => {
               // Find data for this sensor from API
               const apiSensor = sensorsData.find(s => s.id === index);
               
               let newValue = 0;
               if (apiSensor && apiSensor.data.length > 0) {
                   newValue = apiSensor.data[apiSensor.data.length - 1].amplitude;
               }

               // Shift and push
               const newHist = [...sensorHistory.slice(1), newValue];
               return newHist;
            })
        })

    }, 100); // 10fps

    return () => clearInterval(interval);
  }, []);

  const handleThresholdChange = (index: number, val: number) => {
      const newThresholds = [...thresholds];
      newThresholds[index] = val;
      setThresholds(newThresholds);
      
      // Call API
      EspApi.setSensorsThreshold(newThresholds);
  };

  const handleVolumeChange = (index: number, val: number) => {
      const newVolumes = [...volumes];
      newVolumes[index] = val;
      setVolumes(newVolumes);

      // Call API - Note: API currently only supports single volume setting?
      // Using setSensorVolume for the specific sensor if we assume the API implies current context, 
      // otherwise this might just set a global volume. As per instruction "control each volume",
      // we maintain local state per sensor but call the available API.
      EspApi.setSensorVolume(val); 
  };

  return (
    <div className="flex flex-col w-full max-w-lg mx-auto space-y-4 pt-4">
      <div className="flex flex-col gap-3 w-full">
        {SENSORS_CONFIG.map((sensor, index) => (
            <SensorCard 
                key={sensor.id}
                label={sensor.label}
                color={sensor.color}
                data={history[index]}
                threshold={thresholds[index]}
                volume={volumes[index]}
                onThresholdChange={(v) => handleThresholdChange(index, v)}
                onVolumeChange={(v) => handleVolumeChange(index, v)}
            />
        ))}
      </div>
    </div>
  )
}
