import { useState } from 'react'
import { Slider } from '@/components/ui/slider'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SensorCardProps {
  label: string;
  data: number[];
  threshold: number;
  volume: number;
  onThresholdChange: (val: number) => void;
  onVolumeChange: (val: number) => void;
  color?: string;
}

export function SensorCard({ 
  label, 
  data, 
  threshold, 
  volume, 
  onThresholdChange, 
  onVolumeChange,
  color = "#f97316" // Orange-500
}: SensorCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  
  // Create SVG path from data
  // "Now" is at the center (50% width)
  const renderChart = () => {
    if (data.length === 0) return ""
    
    // We want the graph to span the full width
    // The Center (50%) represents the "Focus Point"
    // Left Side (0-50%) is indices 0..N/2
    // Right Side (50%-100%) is indices N/2..N (Incoming data)
    
    const width = 100
    const height = 40
    
    // Just map all data 0..N to 0..Width
    const step = width / (data.length - 1 || 1)
    
    // Create Path
    let path = `M 0 ${height}`
    data.forEach((val, i) => {
        const x = i * step
        const y = height - (Math.min(val, 100) / 100) * height
        path += ` L ${x} ${y}`
    })
    path += ` L ${width} ${height} Z`
    
    return path
  }

  // Create SVG mask/gradient definitions to handle the opacity difference
  const maskId = `mask-${label.replace(/\s/g, '')}`

  return (
    <div className="w-full bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all duration-300">
      
      {/* Compact Header + Chart Area (Overlay) */}
      <div 
        className="relative h-16 w-full bg-slate-50/30 group"
      >
        {/* Background Chart */}
        <div className="absolute inset-0 pointer-events-none">
             <svg 
                viewBox="0 0 100 40" 
                preserveAspectRatio="none" 
                className="w-full h-full"
            >
                 <defs>
                    <linearGradient id={`${maskId}-gradient`} x1="0" x2="1" y1="0" y2="0">
                        <stop offset="0%" stopColor={color} stopOpacity="0.9" />
                        <stop offset="50%" stopColor={color} stopOpacity="0.9" />
                        <stop offset="50.1%" stopColor={color} stopOpacity="0.2" />
                        <stop offset="100%" stopColor={color} stopOpacity="0.2" />
                    </linearGradient>
                </defs>
                <path 
                    d={renderChart()} 
                    fill={`url(#${maskId}-gradient)`}
                    stroke={`url(#${maskId}-gradient)`}
                    strokeWidth="0.5"
                />
            </svg>
            
            {/* Center Line (Activation Point) */}
            <div className="absolute top-0 bottom-0 left-1/2 w-[1px] border-l border-slate-400/40 border-dashed" />

             {/* Threshold Line Visualization */}
            <div 
                className="absolute w-full border-t border-dashed pointer-events-none transition-all duration-300 ease-out"
                style={{ 
                    bottom: `${Math.min(threshold, 100)}%`,
                    borderColor: color,
                    borderWidth: '1px', 
                    opacity: 0.4
                }}
            />
        </div>

        {/* Floating Labels */}
        <div className="absolute top-0 left-0 right-0 bottom-0 flex justify-between items-start p-2">
            <span className="text-sm font-bold text-slate-900 bg-white/90 px-2 py-1 rounded-md shadow-sm border border-slate-100 pointer-events-none backdrop-blur-sm">
                {label}
            </span>
            <button 
                onClick={(e) => {
                    e.stopPropagation();
                    setIsExpanded(!isExpanded);
                }}
                className="text-slate-500 bg-white shadow-md border border-slate-100 p-1.5 rounded-full hover:bg-slate-50 active:scale-95 transition-all"
            >
                 {isExpanded ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
            </button>
        </div>
      </div>

      {/* Accordion Content */}
      <div className={cn(
          "grid transition-all duration-300 ease-out overflow-hidden bg-white",
          isExpanded ? "grid-rows-[1fr] opacity-100 border-t border-slate-100" : "grid-rows-[0fr] opacity-0"
      )}>
        <div className="min-h-0 px-3 pb-3 pt-2 flex flex-col gap-3">
            
            {/* Threshold Control */}
            <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Trigger</span>
                    <span className="text-xs font-bold text-slate-700 w-8 text-right">{Math.round(threshold)}</span>
                </div>
                <Slider 
                    value={[threshold]} 
                    max={100} 
                    step={1} 
                    onValueChange={(v) => onThresholdChange(v[0])}
                    className="py-1" 
                />
            </div>

            {/* Volume Control */}
            <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Volume</span>
                    <span className="text-xs font-bold text-slate-700 w-8 text-right">{Math.round(volume)}</span>
                </div>
                <Slider 
                    value={[volume]} 
                    max={100} 
                    step={1} 
                    onValueChange={(v) => onVolumeChange(v[0])}
                    className="py-1" 
                />
            </div>

        </div>
      </div>

    </div>
  )
}
