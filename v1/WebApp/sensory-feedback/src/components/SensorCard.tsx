import { useState } from 'react'
import { Slider } from '@/components/ui/slider'
import { ChevronDown, ChevronUp, Settings2 } from 'lucide-react'
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
  
  const renderChart = () => {
    if (data.length === 0) return ""
    const width = 100
    const height = 40
    const step = width / (data.length - 1 || 1)
    
    let path = `M 0 ${height}`
    data.forEach((val, i) => {
        const x = i * step
        const y = height - (Math.min(val, 100) / 100) * height
        path += ` L ${x} ${y}`
    })
    path += ` L ${width} ${height} Z`
    return path
  }
  
  // Create a line only path for the glow effect
  const renderLine = () => {
    if (data.length === 0) return ""
    const width = 100
    const height = 40
    const step = width / (data.length - 1 || 1)
    
    let path = ""
    data.forEach((val, i) => {
        const x = i * step
        const y = height - (Math.min(val, 100) / 100) * height
        path += `${i === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    return path
  }

  const maskId = `mask-${label.replace(/\s/g, '')}`
  const lastValue = data[data.length - 1] || 0;
  const isActive = lastValue > threshold;

  return (
    <div className={cn(
        "relative w-full rounded-xl overflow-hidden transition-all duration-500 ease-spring",
        "border border-white/50 shadow-sm",
        "bg-white/80 backdrop-blur-md", // Translucent glass effect
        isExpanded ? "ring-2 ring-primary/5 shadow-xl" : "hover:shadow-md"
    )}>
      
      {/* Main Header / Visual Area */}
      <div 
        className="relative h-14 w-full cursor-pointer group"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Background Gradient Mesh (Optional nice touch) */}
        <div 
             className="absolute inset-0 opacity-[0.03]"
             style={{ backgroundColor: color }}
        />

        {/* Chart Visualization */}
        <div className="absolute inset-0 pointer-events-none px-0">
             <svg 
                viewBox="0 0 100 40" 
                preserveAspectRatio="none" 
                className="w-full h-full opacity-60"
            >
                 <defs>
                    <linearGradient id={`${maskId}-gradient`} x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.4" />
                        <stop offset="100%" stopColor={color} stopOpacity="0.0" />
                    </linearGradient>
                </defs>
                {/* Area Fill */}
                <path 
                    d={renderChart()} 
                    fill={`url(#${maskId}-gradient)`}
                />
                {/* Stroke Line */}
                <path 
                    d={renderLine()} 
                    fill="none"
                    stroke={color}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="drop-shadow-sm"
                />
            </svg>
            
            {/* Threshold Line */}
             <div 
                className="absolute w-full border-t border-dashed pointer-events-none transition-all duration-300"
                style={{ 
                    bottom: `${Math.min(threshold, 100)}%`,
                    borderColor: isExpanded ? color : '#cbd5e1',
                    borderWidth: '1px', 
                    opacity: 0.6
                }}
            />
        </div>

        {/* Content Layout */}
        <div className="absolute inset-0 flex items-center justify-between px-4">
            <div className="flex items-center gap-3">
                 <div className="flex flex-col">
                     <h3 className="font-semibold text-slate-800 text-sm tracking-tight">{label}</h3>
                     <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest mt-0.5">
                         {Math.round(lastValue)}% Intensity
                     </span>
                 </div>
            </div>

            <div className="flex items-center gap-2">
                <div 
                    className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center transition-colors duration-200",
                        isExpanded ? "bg-slate-100 text-slate-900" : "text-slate-400 group-hover:text-slate-600"
                    )}
                >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <Settings2 className="w-4 h-4" />}
                </div>
            </div>
        </div>
      </div>

      {/* Expanded Settings Area */}
      <div className={cn(
          "bg-slate-50/50 transition-all duration-300 ease-in-out border-t border-slate-100",
          isExpanded ? "max-h-40 opacity-100" : "max-h-0 opacity-0 overflow-hidden"
      )}>
        <div className="p-3 space-y-4">
            {/* Threshold Control */}
            <div className="space-y-2">
                <div className="flex justify-between items-center">
                    <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Activation Threshold</span>
                    <span className="text-[10px] font-bold font-mono text-slate-700 bg-white px-2 py-0.5 rounded shadow-sm border border-slate-100">
                        {threshold}%
                    </span>
                </div>
                <Slider 
                    defaultValue={[threshold]} 
                    max={100} 
                    step={1} 
                    onValueChange={(v) => onThresholdChange(v[0])}
                    className="cursor-grab active:cursor-grabbing"
                    // Note: Slider component usually applies --primary color, might need custom styling passed if wanted specific color
                />
            </div>
            
            {/* Volume Control */}
            <div className="space-y-2">
                <div className="flex justify-between items-center">
                    <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Feedback Intensity</span>
                    <span className="text-[10px] font-bold font-mono text-slate-700 bg-white px-2 py-0.5 rounded shadow-sm border border-slate-100">
                        {volume}%
                    </span>
                </div>
                <Slider 
                    defaultValue={[volume]} 
                    max={100} 
                    step={1} 
                    onValueChange={(v) => onVolumeChange(v[0])}
                />
            </div>
        </div>
      </div>
    </div>
  )
}
