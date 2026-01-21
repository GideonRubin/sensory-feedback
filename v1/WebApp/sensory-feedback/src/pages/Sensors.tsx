import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConnection } from '@/context/ConnectionContext'
import { EspApi } from '../services/api'
import { SensorCard } from '@/components/SensorCard'
import { WalkingModel } from '@/components/WalkingModel'
import { cn } from '@/lib/utils'

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
  
  // Recording State
  const [isRecording, setIsRecording] = useState(false)
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const recordedDataRef = useRef<{ time: number; values: number[] }[]>([])

  const [history, setHistory] = useState<number[][]>(
    SENSORS_CONFIG.map(() =>  new Array(60).fill(0))
  )
  
  const historyRef = useRef<number[][]>(
    SENSORS_CONFIG.map(() =>  new Array(60).fill(0))
  );
  
  const frameCounterRef = useRef(0);

  // Use the latest value for real-time feedback, not the middle of the history buffer
  const currentSensors = history.map(h => h[h.length - 1] || 0);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    let recordingInterval: ReturnType<typeof setInterval>;

    if (isRecording && recordingStartTime) {
      recordingInterval = setInterval(() => {
        setRecordingDuration(Math.floor((Date.now() - recordingStartTime) / 1000));
      }, 1000);
    } else {
      setRecordingDuration(0);
    }

    return () => {
        document.body.style.overflow = '';
        clearInterval(recordingInterval);
    };
  }, [isRecording, recordingStartTime]);

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

        // Recording Logic: 5 FPS (every 2nd frame since FPS=10)
        if (isRecording && recordingStartTime != null) {
            frameCounterRef.current = (frameCounterRef.current + 1) % 2;
            
            if (frameCounterRef.current === 0) {
                 recordedDataRef.current.push({
                    time: Date.now() - recordingStartTime,
                    values: currentFrameValues
                });
            }
        } else {
             frameCounterRef.current = 0; // Reset counter when not recording
        }

        setHistory(nextHistory);

    }, 1000 / FPS); 

    return () => clearInterval(interval);
  }, [isRecording, recordingStartTime]);

  const handleRecordToggle = () => {
      if (isRecording) {
          // STOP RECORDING
          setIsRecording(false);
          setRecordingStartTime(null);
          
          // Generate file
          const dataStr = JSON.stringify(recordedDataRef.current, null, 2);
          const blob = new Blob([dataStr], { type: "text/plain" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `sensor-recording-${new Date().toISOString()}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          
          // Clear buffer
          recordedDataRef.current = [];
      } else {
          // START RECORDING
          setIsRecording(true);
          setRecordingStartTime(Date.now());
          recordedDataRef.current = [];
      }
  };

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
       EspApi.setSensorVolume(val); 
  };

  return (
    <div className="relative flex flex-col w-full h-[100dvh] bg-slate-50 text-slate-900 overflow-hidden">
      
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-[50vh] bg-gradient-to-b from-slate-200/50 to-transparent -z-10" />
      
      {/* Header Area with Walking Model */}
      <div className="relative pt-0 pb-1 px-4 flex-none max-w-sm mx-auto w-full">
          <div className="relative overflow-hidden h-[25vh] min-h-[160px] flex items-center justify-center">
             <WalkingModel sensors={currentSensors} />
             <div className="absolute bottom-2 left-0 w-full text-center">
                <span className="text-[9px] uppercase tracking-[0.2em] text-slate-400 font-semibold bg-white/50 px-2 py-0.5 rounded-full backdrop-blur-sm border border-white/40">Real-time Feedback</span>
             </div>
          </div>
      </div>

      {/* Main Content Area - Scrollable */}
      <div className="flex-1 w-full max-w-md mx-auto px-3 overflow-y-auto no-scrollbar pb-40 pt-1">
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
       <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-40 animate-in slide-in-from-bottom-10 fade-in duration-500">
          <div className={cn(
              "flex items-center transition-all duration-300 rounded-full border border-white/20 bg-white/10 backdrop-blur-sm",
              isRecording ? "gap-4 pl-4 pr-1" : "gap-0 p-1"
          )}>
              
              {/* Timer Display */}
              <div className={cn(
                  "font-mono text-sm font-medium transition-all duration-300 w-12 text-center",
                  isRecording ? "text-red-500 opacity-100" : "text-slate-400 opacity-0 w-0 overflow-hidden"
              )}>
                  {Math.floor(recordingDuration / 60)}:{String(recordingDuration % 60).padStart(2, '0')}
              </div>

              {/* Record Button - Minimalist */}
              <button 
                  onClick={handleRecordToggle}
                  className={cn(
                      "group relative flex items-center justify-center transition-all duration-300",
                      isRecording ? "scale-100" : "hover:scale-105"
                  )}
                  aria-label={isRecording ? "Stop Recording" : "Start Recording"}
              >
                  <div className={cn(
                      "w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 border",
                      isRecording
                        ? "bg-red-50 border-red-200" 
                        : "bg-white border-slate-100 text-slate-400"
                  )}>
                      <div className={cn(
                          "transition-all duration-300",
                          isRecording 
                            ? "w-4 h-4 rounded-[4px] bg-red-500" // Square (Stop)
                            : "w-3 h-3 rounded-full bg-red-500"   // Circle (Record)
                      )} />
                  </div>
              </button>
          </div>
      </div>
    </div>
  )
}
