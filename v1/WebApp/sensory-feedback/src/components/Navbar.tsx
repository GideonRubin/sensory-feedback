import { Link, useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export function Navbar() {
  const location = useLocation()

  const getButtonClass = (path: string) => {
    return cn(
      "text-gray-400 hover:text-white hover:bg-gray-900",
      location.pathname === path && "text-white bg-gray-900"
    )
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 flex justify-center gap-2 border-t bg-black p-2 z-50 shadow-lg">
      <Button variant="ghost" asChild className={getButtonClass("/")}>
        <Link to="/">Home</Link>
      </Button>
      
      <Button variant="ghost" asChild className={getButtonClass("/sensors")}>
        <Link to="/sensors">Sensors</Link>
      </Button>

      <Button variant="ghost" asChild className={getButtonClass("/record")}>
        <Link to="/record">Record</Link>
      </Button>

      <Button variant="ghost" asChild className={getButtonClass("/view")}>
        <Link to="/view">View</Link>
      </Button>
    </div>
  )
}
