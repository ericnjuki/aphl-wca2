import { MenuIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Menu } from "@/components/admin-panel/menu";
import {
  Sheet,
  SheetHeader,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import logoImage from "@/assets/OpenODRv2Logo.png";

export function SheetMenu() {
  return (
    <Sheet>
      <SheetTrigger className="lg:hidden" asChild>
        <Button className="h-8" variant="outline" size="icon">
          <MenuIcon size={20} />
        </Button>
      </SheetTrigger>
      <SheetContent
        className="sm:w-72 gap-0 py-0 m-0 px-0 h-full flex flex-col"
        side="left"
      >
        <SheetHeader className="shrink-0 border-b m-0 py-3">
          <div className="flex flex-row ml-2 cursor-default">
            <div className="w-5.5 overflow-hidden">
              <img
                src={logoImage}
                alt="labworkforce"
                className="h-6 object-cover object-left"
              />
            </div>
            <div className="ml-5 mt-0.5">Lab Workforce</div>
          </div>
        </SheetHeader>
        {/* `flex-1 min-h-0` — claim the remaining vertical space after the
            sheet header and establish a scroll context so the Menu's
            internal ScrollArea actually clips instead of overflowing the
            sheet. Without `min-h-0` a flex child won't shrink below its
            content height and the last items get hidden under the sheet
            bottom edge. */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <Menu isOpen />
        </div>
      </SheetContent>
    </Sheet>
  );
}
