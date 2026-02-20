import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConnection } from '@/context/ConnectionContext'
import { EspApi } from '../services/api'
import { SensorCard } from '@/components/SensorCard'
import { WalkingModel } from '@/components/WalkingModel'
import { useRecording } from '@/hooks/useRecording'
import { RecordingControls } from '@/components/RecordingControls'

// Define the 4 sensors
const SENSORS_CONFIG = [
  { id: 0, label: "Right Front", color: "#fb923c" }, // Orange-400
  { id: 1, label: "Left Front", color: "#60a5fa" },  // Blue-400
  { id: 2, label: "Right Back", color: "#ea580c" },  // Orange-600
  { id: 3, label: "Left Back", color: "#2563eb" },   // Blue-600
]

const FPS = 30;

export function Sensors() {
  const { isConnected } = useConnection()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isConnected) {
      navigate('/')
    }
  }, [isConnected, navigate])

  const [thresholds, setThresholds] = useState<number[]>([50, 50, 50, 50])
  const [volumes, setVolumes] = useState<number[]>([80, 80, 80, 80])
  
  // Recording Hook
  const { 
    isRecording, 
    recordingDuration, 
    toggleRecording, 
    captureFrame 
  } = useRecording();

  const [history, setHistory] = useState<number[][]>(
    SENSORS_CONFIG.map(() =>  new Array(60).fill(0))
  )
  
  const historyRef = useRef<number[][]>(
    SENSORS_CONFIG.map(() =>  new Array(60).fill(0))
  );
  
  // Use the latest value for real-time feedback, not the middle of the history buffer
  const currentSensors = history.map(h => h[h.length - 1] || 0);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
        document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
        const sensorsData = EspApi.getSensorsData();
        
        // Prepare current frame data
        const currentFrameValues: number[] = [];

        const nextHistory = historyRef.current.map((sensorHistory, index) => {
               const apiSensor = sensorsData.find(s => s.id === index);
               
               let newValue = 0;
               if (apiSensor && apiSensor.data.length > 0) {
                   newValue = apiSensor.data[apiSensor.data.length - 1].amplitude;
               }
               
               currentFrameValues.push(Math.round(newValue * 10) / 10);

               return [...sensorHistory.slice(1), newValue];
        });
        
        historyRef.current = nextHistory;

        // Capture data if recording
        captureFrame(currentFrameValues);

        setHistory(nextHistory);

    }, 1000 / FPS); 

    return () => clearInterval(interval);
  }, [captureFrame]);


  const handleThresholdChange = (index: number, val: number) => {
      const newThresholds = [...thresholds];
      newThresholds[index] = val;
      setThresholds(newThresholds);
      EspApi.setSensorsThreshold(newThresholds);
  };

  const handleVolumeChange = (index: number, val: number) => {
       const newVolumes = [...volumes];
       newVolumes[index] = val;
       setVolumes(newVolumes);
       EspApi.setSensorVolume(index, val); 
  };

  return (
    <div className="relative flex flex-col w-full h-[100dvh] bg-slate-50 text-slate-900 overflow-hidden">
      
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-[50vh] bg-gradient-to-b from-slate-200/50 to-transparent -z-10" />
      
      {/* Header Area with Walking Model */}
      <div className="relative pt-0 pb-1 px-4 flex-none max-w-sm mx-auto w-full">
          <div className="relative overflow-hidden h-[25vh] min-h-[160px] flex items-center justify-center -mb-6">
             <WalkingModel sensors={currentSensors} camera={[1.4, 1.0, 2.0]} />
          </div>
          <div className="relative z-10 w-full text-center pb-3">
            <span className="text-[9px] uppercase tracking-[0.2em] text-slate-400 font-semibold bg-white/50 px-2 py-0.5 rounded-full backdrop-blur-sm border border-white/40">Real-time Feedback</span>
         </div>
      </div>

      {/* Main Content Area - Scrollable */}
      <div className="flex-1 w-full max-w-md mx-auto px-3 overflow-y-auto no-scrollbar pb-60 pt-1">
        <div className="flex flex-col gap-2">
            {/* Group Right */}
            <div className="space-y-1.5">
                 <div className="flex items-center gap-2 px-2 text-orange-500/80">
                    <span className="text-[10px] font-bold uppercase tracking-widest">Right Foot</span>
                    <div className="h-[1px] flex-1 bg-orange-200/50" />
                 </div>
                 {[0, 2].map(id => (
                    <SensorCard 
                        key={id}
                        {...SENSORS_CONFIG[id]}
                        data={history[id]}
                        threshold={thresholds[id]}
                        volume={volumes[id]}
                        onThresholdChange={(v) => handleThresholdChange(id, v)}
                        onVolumeChange={(v) => handleVolumeChange(id, v)}
                    />
                 ))}
            </div>

            {/* Group Left */}
            <div className="space-y-1.5 pt-1">
                <div className="flex items-center gap-2 px-2 text-blue-500/80">
                    <span className="text-[10px] font-bold uppercase tracking-widest">Left Foot</span>
                    <div className="h-[1px] flex-1 bg-blue-200/50" />
                 </div>
                 {[1, 3].map(id => (
                    <SensorCard 
                        key={id}
                        {...SENSORS_CONFIG[id]}
                        data={history[id]}
                        threshold={thresholds[id]}
                        volume={volumes[id]}
                        onThresholdChange={(v) => handleThresholdChange(id, v)}
                        onVolumeChange={(v) => handleVolumeChange(id, v)}
                    />
                 ))}
            </div>
        </div>
      </div>

       {/* Control Deck */}
       <RecordingControls 
          isRecording={isRecording}
          duration={recordingDuration}
          onToggle={toggleRecording}
       />
    </div>
  )
}
