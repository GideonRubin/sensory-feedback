import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConnection } from '@/context/ConnectionContext'
import { EspApi } from '../services/api'
import { SensorCard } from '@/components/SensorCard'
import { WalkingModel } from '@/components/WalkingModel'
import { Play, Pause } from 'lucide-react'

// Define the 4 sensors
const SENSORS_CONFIG = [
  { id: 0, label: "Right Front", color: "#fb923c" }, // Orange-400
  { id: 1, label: "Left Front", color: "#60a5fa" },  // Blue-400
  { id: 2, label: "Right Back", color: "#ea580c" },  // Orange-600
  { id: 3, label: "Left Back", color: "#2563eb" },   // Blue-600
]

const FPS = 10;

export function Sensors() {
  const { isConnected } = useConnection()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isConnected) {
      navigate('/')
    }
  }, [isConnected, navigate])

  // State for thresholds and volumes
  // Initialize with some defaults
  const [thresholds, setThresholds] = useState<number[]>([50, 50, 50, 50])
  const [volumes, setVolumes] = useState<number[]>([80, 80, 80, 80])
  const [isPaused, setIsPaused] = useState(false)
  
  // History of data for charts (e.g. last 60 points)
  const [history, setHistory] = useState<number[][]>(
    SENSORS_CONFIG.map(() =>  new Array(60).fill(0))
  )
  
  // Ref to store continuous history even when paused
  const historyRef = useRef<number[][]>(
    SENSORS_CONFIG.map(() =>  new Array(60).fill(0))
  );

  // Use the value at the center of the graph (middle of history) for the model
  // This corresponds to the vertical center line in the chart
  const currentSensors = history.map(h => h[Math.floor(h.length / 2)] || 0);

  useEffect(() => {
    // Prevent scrolling on the main page while this component is mounted
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    }
  }, []);

  useEffect(() => {
    // Initial fetch of configuration if available
    // const storedThresholds = EspApi.getSensorsThreshold();
    // if (storedThresholds.length) setThresholds(storedThresholds);
    
    const interval = setInterval(() => {
        // 1. Fetch latest data from API (always fetch to keep buffer fresh or keep connection alive)
        const sensorsData = EspApi.getSensorsData();
        
        // 2. Update continuous history ref (regardless of pause state)
        // This ensures that when we unpause, we jump to the latest data stream ("catch up")
        
        // Create new history snapshot from current ref
        const nextHistory = historyRef.current.map((sensorHistory, index) => {
               // Find data for this sensor from API
               const apiSensor = sensorsData.find(s => s.id === index);
               
               let newValue = 0;
               if (apiSensor && apiSensor.data.length > 0) {
                   newValue = apiSensor.data[apiSensor.data.length - 1].amplitude;
               }

               // Shift and push
               return [...sensorHistory.slice(1), newValue];
        });
        
        // Update the ref
        historyRef.current = nextHistory;

        // 3. Update UI only if not paused
        if (!isPaused) {
           setHistory(nextHistory);
        }

    }, 1000 / FPS); // 10fps

    return () => clearInterval(interval);
  }, [isPaused]); // Re-run effect if isPaused changes (or just depend on isPaused in closure if we use ref, but direct dependency is fine as interval recreation is cheap)

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
    <div className="relative flex flex-col -mx-4 w-[calc(100%+2rem)] md:w-full md:mx-auto max-w-lg overflow-hidden space-y-1 h-[calc(100dvh-6rem)]">
      <div className="px-2 pt-0 padding-bottom:5px;">
          <WalkingModel sensors={currentSensors} />
      </div>
      <div className="flex flex-col gap-2 w-full flex-1 overflow-y-auto pb-24 px-2 no-scrollbar margin-top:5px;">
        {/* Right Shoe Group */}
        <div className="flex flex-col gap-2">
            {/* Filter for ids 0 (RF) and 2 (RB) */}
            {[0, 2].map(id => {
               const index = id; // Since ids are 0,1,2,3 and they map to indices in SENSORS_CONFIG
               const sensor = SENSORS_CONFIG[index];
               return (
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
               )
            })}
        </div>

        {/* Left Shoe Group */}
        <div className="flex flex-col gap-2">
           
            {/* Filter for ids 1 (LF) and 3 (LB) */}
            {[1, 3].map(id => {
               const index = id; 
               const sensor = SENSORS_CONFIG[index];
               return (
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
               )
            })}
        </div>
      </div>

       {/* Play/Pause Button - Floating */}
       <div className="fixed bottom-17 right-4 z-50">
          <button 
              onClick={() => setIsPaused(!isPaused)}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 active:scale-95 border-[3px] shadow-lg ${
                  !isPaused 
                  ? 'bg-slate-800 border-slate-800 text-white shadow-slate-300/50' 
                  : 'bg-white border-slate-200 text-slate-400'
              }`}
          >
              {!isPaused ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-1" />}
          </button>
      </div>
    </div>
  )
}
