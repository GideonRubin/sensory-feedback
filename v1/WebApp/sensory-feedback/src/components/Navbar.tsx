import { Link, useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu"

export function Navbar() {
  const location = useLocation()

  const getLinkClassName = (path: string) => {
    const isActive = location.pathname === path
    return cn(
      navigationMenuTriggerStyle(),
      "bg-black hover:bg-gray-900 hover:text-white focus:bg-gray-900 focus:text-white active:bg-gray-900 active:text-white data-[active]:bg-gray-900 data-[state=open]:bg-gray-900",
      isActive ? "text-white" : "text-gray-400"
    )
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 flex justify-center border-t bg-black p-2 z-50">
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem>
            <Link to="/">
              <NavigationMenuLink className={getLinkClassName("/")}>
                Home
              </NavigationMenuLink>
            </Link>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <Link to="/sensors">
              <NavigationMenuLink className={getLinkClassName("/sensors")}>
                Sensors
              </NavigationMenuLink>
            </Link>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <Link to="/record">
              <NavigationMenuLink className={getLinkClassName("/record")}>
                Record
              </NavigationMenuLink>
            </Link>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <Link to="/view">
              <NavigationMenuLink className={getLinkClassName("/view")}>
                View
              </NavigationMenuLink>
            </Link>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
    </div>
  )
}
