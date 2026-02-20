import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { WalkingModel } from './WalkingModel';
import { cn } from '@/lib/utils';
import { Slider } from './ui/slider';

interface PlaybackModalProps {
    isOpen: boolean;
    onClose: () => void;
    recording: {
        date: string;
        data: string; // CSV string
    };
}

interface Frame {
    time: number;
    sensors: number[]; // [RF, LF, RB, LB]
}

export function PlaybackModal({ isOpen, onClose, recording }: PlaybackModalProps) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0); // 0 to 100
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 640);
        handleResize(); // Initial check
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    
    // Parsed data
    const framesRef = useRef<Frame[]>([]);
    const requestRef = useRef<number | null>(null);
    const startTimeRef = useRef<number>(0);
    const playStartProgressRef = useRef<number>(0);

    // Parse CSV on mount/change
    useEffect(() => {
        if (!recording.data) return;

        const lines = recording.data.trim().split('\n');
        // Skip header
        const dataLines = lines.slice(1);
        
        const parsed: Frame[] = dataLines.map(line => {
            const parts = line.split(',');
            // CSV: time_ms, RF, LF, RB, LB
            // Model expects: [RF, LF, RB, LB]
            // Map indices: 1->0, 2->1, 3->2, 4->3
            return {
                time: parseInt(parts[0], 10),
                sensors: [
                    parseFloat(parts[1]) || 0,
                    parseFloat(parts[2]) || 0,
                    parseFloat(parts[3]) || 0,
                    parseFloat(parts[4]) || 0
                ]
            };
        });

        framesRef.current = parsed;
        if (parsed.length > 0) {
            setDuration(parsed[parsed.length - 1].time);
        }
        setProgress(0);
        setCurrentTime(0);
        setIsPlaying(false);

    }, [recording]);

    // Animation Loop
    const animate = (timestamp: number) => {
        if (!startTimeRef.current) startTimeRef.current = timestamp;
        
        // Calculate elapsed time based on when we started playing + offset from slider
        const elapsed = timestamp - startTimeRef.current;
        const startOffset = (playStartProgressRef.current / 100) * duration;
        
        let nextTime = startOffset + elapsed;

        if (nextTime >= duration) {
            nextTime = duration;
            setIsPlaying(false);
            setCurrentTime(duration);
            setProgress(100);
            return;
        }

        setCurrentTime(nextTime);
        setProgress((nextTime / duration) * 100);
        
        requestRef.current = requestAnimationFrame(animate);
    };

    useEffect(() => {
        if (isPlaying) {
            // Reset start time for new animation frame loop
            startTimeRef.current = 0;
            // Set the start point to the current progress (where we paused)
            playStartProgressRef.current = progress;
            
            requestRef.current = requestAnimationFrame(animate);
        } else {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        }
        return () => {
             if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [isPlaying]); // Run only when play state changes

    // Find the frame for the current time
    // Memoize this search or just do it render-time since N is small (< 60*60*30 = 100k, binary search ideal but find is ok for small clips)
    // Actually for 30fps, 1 min = 1800 frames. .find is fast enough.
    const currentFrame = useMemo(() => {
        const frames = framesRef.current;
        if (frames.length === 0) return { time: 0, sensors: [0,0,0,0] };
        
        // Optimized search: frames are sorted by time
        // Simple approximation: index ~ (time / duration) * total_frames
        // But for variable framerate, binary search is better.
        // Let's just use a simple find or findLast for now
        // or just find the first frame where frame.time >= currentTime
        
        let found = frames.find(f => f.time >= currentTime);
        return found || frames[frames.length - 1];

    }, [currentTime, recording]);


    const handleScrub = (val: number[]) => {
        const newProgress = val[0];
        setProgress(newProgress);
        const newTime = (newProgress / 100) * duration;
        setCurrentTime(newTime);
        
        // If scrubbing while playing, we need to update the start reference
        if (isPlaying) {
            startTimeRef.current = performance.now();
            playStartProgressRef.current = newProgress;
        }
    };
    
    const togglePlay = () => {
        if (progress >= 100 && !isPlaying) {
            // Restart if at end
            setProgress(0);
            setCurrentTime(0);
            playStartProgressRef.current = 0;
            setIsPlaying(true);
        } else {
            setIsPlaying(!isPlaying);
        }
    }

    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/80 backdrop-blur-md animate-in fade-in duration-300"
            onClick={onClose}
        >
             <div 
                className="relative bg-white rounded-3xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300 ring-1 ring-white/10"
                onClick={(e) => e.stopPropagation()}
            >
                
                {/* 3D Viewer - Main Focus */}
                <div className="flex-1 w-full bg-gradient-to-b from-slate-100 via-white to-slate-50 relative">
                     <WalkingModel sensors={currentFrame.sensors} modelPosition={isMobile ? [0, -0.8, 0] : undefined} />
                     
                     {/* Header Overlay */}
                     <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-start pointer-events-none">
                        <div className="bg-white/60 backdrop-blur-md px-5 py-3 rounded-2xl pointer-events-auto flex flex-col items-start text-left">
                            <h2 className="text-[10px] uppercase tracking-widest font-bold text-slate-400/80 mb-0.5">Session Playback</h2>
                            <p className="text-lg font-bold text-slate-700">{new Date(recording.date).toLocaleString([], { year: '2-digit', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                        
                        <button 
                            onClick={onClose} 
                            className="group p-3 text-slate-400 hover:text-slate-600 bg-white/60 backdrop-blur-md rounded-full hover:bg-white/80 transition-all pointer-events-auto active:scale-95"
                        >
                            <X size={24} className="group-hover:scale-110 transition-transform" />
                        </button>
                     </div>

                     {/* Data Overlay - HUD Style */}
                     <div className="absolute top-24 right-5 sm:right-6 bg-white/80 backdrop-blur-md px-4 sm:px-5 py-3 sm:py-4 rounded-xl sm:rounded-2xl shadow-sm border border-black/5 space-y-1 sm:space-y-2 w-32 sm:w-36 pointer-events-none transform scale-90 sm:scale-100 origin-top-right">
                        <div className="text-[10px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Pressure</div>
                        <div className="flex justify-between items-center text-xs sm:text-sm">
                            <span className="font-semibold text-slate-500">RF</span> 
                            <span className="font-mono font-bold text-orange-500">{currentFrame.sensors[0].toFixed(0)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs sm:text-sm">
                            <span className="font-semibold text-slate-500">LF</span> 
                            <span className="font-mono font-bold text-blue-500">{currentFrame.sensors[1].toFixed(0)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs sm:text-sm">
                            <span className="font-semibold text-slate-500">RB</span> 
                            <span className="font-mono font-bold text-orange-600">{currentFrame.sensors[2].toFixed(0)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs sm:text-sm">
                            <span className="font-semibold text-slate-500">LB</span> 
                            <span className="font-mono font-bold text-blue-600">{currentFrame.sensors[3].toFixed(0)}</span>
                        </div>
                     </div>
                </div>

                {/* Controls Bar */}
                <div className="relative z-20 bg-white/95 backdrop-blur border-t border-slate-100 px-8 py-6 pb-8">
                    {/* Progress Bar */}
                    <div className="flex items-center gap-4 mb-6">
                         <span className="text-xs font-mono font-medium text-slate-400 w-12 text-right">
                             {(currentTime / 1000).toFixed(1)}s
                         </span>
                         <Slider 
                            value={[progress]} 
                            max={100} 
                            step={0.1}
                            onValueChange={handleScrub}
                            className="flex-1 cursor-pointer py-2"
                         />
                         <span className="text-xs font-mono font-medium text-slate-400 w-12">
                             {(duration / 1000).toFixed(1)}s
                         </span>
                    </div>

                    {/* Buttons */}
                    <div className="flex items-center justify-center gap-10">
                         <button 
                            className="p-3 text-slate-300 hover:text-slate-600 transition-colors hover:bg-slate-50 rounded-full"
                            onClick={() => {
                                setProgress(0);
                                setCurrentTime(0);
                                if (isPlaying) {
                                    startTimeRef.current = performance.now();
                                    playStartProgressRef.current = 0;
                                }
                            }}
                         >
                            <SkipBack size={28} fill="currentColor" />
                         </button>

                         <button 
                            onClick={togglePlay}
                            className={cn(
                                "w-16 h-16 flex items-center justify-center rounded-full text-white transition-all shadow-xl hover:shadow-2xl hover:scale-105 active:scale-95",
                                isPlaying 
                                    ? "bg-amber-500 hover:bg-amber-400 shadow-amber-500/20" 
                                    : "bg-blue-600 hover:bg-blue-500 shadow-blue-600/30"
                            )}>
                            {isPlaying ? (
                                <Pause size={28} fill="currentColor" />
                            ) : (
                                <Play size={28} fill="currentColor" className="ml-0.5" />
                            )}
                         </button>

                          <button 
                             className="p-3 text-slate-300 hover:text-slate-600 transition-colors hover:bg-slate-50 rounded-full"
                             onClick={() => {
                                 setProgress(100);
                                 setCurrentTime(duration);
                                 setIsPlaying(false);
                             }}
                          >
                            <SkipForward size={28} fill="currentColor" />
                         </button>
                    </div>
                </div>
             </div>
        </div>
    );
}
