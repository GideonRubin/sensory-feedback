import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConnection } from '@/context/ConnectionContext'
import { EspApi } from '../services/api'
import { SensorCard } from '@/components/SensorCard'
import { WalkingModel } from '@/components/WalkingModel'
import { Play, Pause, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'

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

  const [thresholds, setThresholds] = useState<number[]>([50, 50, 50, 50])
  const [volumes, setVolumes] = useState<number[]>([80, 80, 80, 80])
  const [isPaused, setIsPaused] = useState(false)
  
  const [history, setHistory] = useState<number[][]>(
    SENSORS_CONFIG.map(() =>  new Array(60).fill(0))
  )
  
  const historyRef = useRef<number[][]>(
    SENSORS_CONFIG.map(() =>  new Array(60).fill(0))
  );

  const currentSensors = history.map(h => h[Math.floor(h.length / 2)] || 0);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
        const sensorsData = EspApi.getSensorsData();
        
        const nextHistory = historyRef.current.map((sensorHistory, index) => {
               const apiSensor = sensorsData.find(s => s.id === index);
               
               let newValue = 0;
               if (apiSensor && apiSensor.data.length > 0) {
                   newValue = apiSensor.data[apiSensor.data.length - 1].amplitude;
               }

               return [...sensorHistory.slice(1), newValue];
        });
        
        historyRef.current = nextHistory;

        if (!isPaused) {
           setHistory(nextHistory);
        }

    }, 1000 / FPS); 

    return () => clearInterval(interval);
  }, [isPaused]); 

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
      <div className="relative pt-2 pb-1 px-4 flex-none max-w-sm mx-auto w-full">
          <div className="bg-white rounded-2xl shadow-lg shadow-slate-200/40 p-2 border border-white/50 relative overflow-hidden h-[30vh] min-h-[160px] flex items-center justify-center">
             <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-400 via-purple-500 to-blue-500 opacity-70" />
             <WalkingModel sensors={currentSensors} />
             <div className="absolute bottom-1 left-0 w-full text-center">
                <span className="text-[9px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Real-time Feedback</span>
             </div>
          </div>
      </div>

      {/* Main Content Area - Scrollable */}
      <div className="flex-1 w-full max-w-md mx-auto px-3 overflow-y-auto no-scrollbar pb-24 pt-1">
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
       <div className="fixed bottom-18 left-1/2 -translate-x-1/2 z-40 animate-in slide-in-from-bottom-10 fade-in duration-500">
          <div className="flex items-center gap-3 p-2">
              
              {/* Record Button */}
              <button 
                  className="group flex flex-col items-center gap-1"
                  aria-label="Record"
              >
                  <div className="w-10 h-10 rounded-full bg-white/80 backdrop-blur-md border border-white/60 shadow-lg text-slate-400 flex items-center justify-center transition-all duration-300 group-hover:bg-white group-hover:scale-105 group-active:scale-95">
                      <div className="w-3 h-3 rounded-full bg-red-500 shadow-sm group-hover:shadow-[0_0_8px_rgba(239,68,68,0.6)] transition-all" />
                  </div>
              </button>

              {/* Play/Pause Button */}
              <button 
                  onClick={() => setIsPaused(!isPaused)}
                  className={cn(
                      "w-14 h-14 rounded-[1.2rem] flex items-center justify-center transition-all duration-300 shadow-xl backdrop-blur-md border active:scale-95",
                      !isPaused 
                      ? "bg-slate-900 border-slate-800 text-white shadow-slate-900/25 hover:bg-slate-800" 
                      : "bg-white/95 border-white text-slate-800 shadow-slate-200/50"
                  )}
              >
                  {!isPaused 
                    ? <Pause className="w-5 h-5 fill-current" /> 
                    : <Play className="w-5 h-5 fill-current ml-1" />
                  }
              </button>

              {/* Spacer button for balance (could be screenshot, markings, or settings in future) - making it invisible to keep center balance if user wants exact center, 
                  OR better: just 2 buttons. But centering 2 buttons makes the center of the screen empty.
                  Let's put them close together in the center.
              */}
          </div>
      </div>
    </div>
  )
}
