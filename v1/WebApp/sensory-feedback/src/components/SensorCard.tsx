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
  // Assuming data is array of amplitudes 0-100 normalized
  const renderChart = () => {
    if (data.length === 0) return ""
    
    const width = 100
    const height = 40
    const step = width / (data.length - 1 || 1)
    
    // Move to bottom left
    let path = `M 0 ${height}`
    
    data.forEach((val, i) => {
        const x = i * step
        // val is 0..100 approx, map to height..0
        const y = height - (Math.min(val, 100) / 100) * height
        path += ` L ${x} ${y}`
    })
    
    // Close path to bottom right and left
    path += ` L ${width} ${height} Z`
    
    return path
  }

  return (
    <div className="w-full bg-white rounded-3xl p-5 shadow-sm border border-slate-100 transition-all duration-300">
      
      {/* Header / Chart Area */}
      <div 
        className="flex flex-col gap-2 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-700">{label}</h3>
            <button className="text-slate-400">
                {isExpanded ? <ChevronUp className="w-5 h-5"/> : <ChevronDown className="w-5 h-5"/>}
            </button>
        </div>

        {/* Chart */}
        <div className="h-16 w-full relative overflow-hidden rounded-md bg-slate-50/50 mt-2">
            <svg 
                viewBox="0 0 100 40" 
                preserveAspectRatio="none" 
                className="w-full h-full absolute inset-0"
            >
                <path 
                    d={renderChart()} 
                    fill={color} 
                    fillOpacity="0.8"
                    stroke={color}
                    strokeWidth="0.5"
                />
            </svg>
            
            {/* Threshold Line Visualization */}
            <div 
                className="absolute w-full border-t-2 border-dashed pointer-events-none transition-all duration-300 ease-out"
                style={{ 
                    bottom: `${Math.min(threshold, 100)}%`,
                    borderColor: color
                }}
            />
        </div>
      </div>

      {/* Accordion Content */}
      <div className={cn(
          "grid transition-all duration-300 ease-out overflow-hidden",
          isExpanded ? "grid-rows-[1fr] opacity-100 mt-6 pt-4 border-t border-slate-100" : "grid-rows-[0fr] opacity-0"
      )}>
        <div className="min-h-0 flex flex-col gap-6">
            
            {/* Threshold Control */}
            <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Trigger Threshold</span>
                    <span className="text-sm font-bold text-slate-700 w-8 text-right">{Math.round(threshold)}</span>
                </div>
                <Slider 
                    value={[threshold]} 
                    max={100} 
                    step={1} 
                    onValueChange={(v) => onThresholdChange(v[0])}
                    className="py-2" 
                />
            </div>

            {/* Volume Control */}
            <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Volume</span>
                    <span className="text-sm font-bold text-slate-700 w-8 text-right">{Math.round(volume)}</span>
                </div>
                <Slider 
                    value={[volume]} 
                    max={100} 
                    step={1} 
                    onValueChange={(v) => onVolumeChange(v[0])}
                    className="py-2" 
                />
            </div>

        </div>
      </div>

    </div>
  )
}
