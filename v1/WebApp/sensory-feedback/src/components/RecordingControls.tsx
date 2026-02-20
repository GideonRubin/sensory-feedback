import { cn } from '@/lib/utils';

interface RecordingControlsProps {
    isRecording: boolean;
    duration: number;
    onToggle: () => void;
}

export function RecordingControls({ isRecording, duration, onToggle }: RecordingControlsProps) {
    return (
       <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 animate-in slide-in-from-bottom-10 fade-in duration-500">
          <div className={cn(
              "flex items-center transition-all duration-300 rounded-full border border-white/20 bg-white/10 backdrop-blur-sm",
              isRecording ? "gap-4 pl-4 pr-1" : "gap-0 p-1"
          )}>
              
              {/* Timer Display */}
              <div className={cn(
                  "font-mono text-sm font-medium transition-all duration-300 w-12 text-center",
                  isRecording ? "text-red-500 opacity-100" : "text-slate-400 opacity-0 w-0 overflow-hidden"
              )}>
                  {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}
              </div>

              {/* Record Button - Minimalist */}
              <button 
                  onClick={onToggle}
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
    );
}
