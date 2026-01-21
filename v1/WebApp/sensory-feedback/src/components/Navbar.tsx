import { Link, useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"
import { useConnection } from "@/context/ConnectionContext"
import { Home, Activity, Eye } from "lucide-react"

export function Navbar() {
  const location = useLocation()
  const { isConnected } = useConnection()

  const navItems = [
    { path: "/", label: "Home", icon: Home, disabled: false },
    { path: "/sensors", label: "Sensors", icon: Activity, disabled: !isConnected },
    { path: "/view", label: "View", icon: Eye, disabled: false },
  ]

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-5 duration-500 fade-in w-auto">
      <nav className="flex items-center gap-1 bg-slate-200/90 backdrop-blur-xl border border-white/40 rounded-2xl p-1.5 shadow-2xl ring-1 ring-white/20">
        {navItems.map((item) => {
           const Icon = item.icon
           const isActive = location.pathname === item.path
           
           if (item.disabled) {
             return (
               <div key={item.path} className="flex flex-col items-center justify-center w-14 h-11 rounded-xl text-slate-400/40 cursor-not-allowed select-none">
                  <Icon className="w-5 h-5" />
                  <span className="text-[9px] font-medium mt-0.5 opacity-60">{item.label}</span>
               </div>
             )
           }

           return (
             <Link
               key={item.path}
               to={item.path}
               className={cn(
                 "flex flex-col items-center justify-center w-14 h-11 rounded-xl transition-all duration-200 relative group overflow-hidden",
                 isActive 
                   ? "bg-slate-300/80 text-slate-800 shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] ring-1 ring-black/5" 
                   : "text-slate-500 hover:text-slate-900 hover:bg-slate-300/30"
               )}
             >
               <div className={cn("relative z-10 flex flex-col items-center transition-transform duration-200", isActive ? "translate-y-[1px]" : "group-hover:-translate-y-0.5")}>
                 <Icon className={cn("w-5 h-5 mb-0.5 transition-transform duration-200", isActive && "scale-95 opacity-80")} />
                 <span className={cn("text-[9px] font-medium tracking-wide", isActive ? "text-slate-800" : "text-slate-500/80 group-hover:text-slate-700")}>
                   {item.label}
                 </span>
               </div>
             </Link>
           )
        })}
      </nav>
    </div>
  )
}
