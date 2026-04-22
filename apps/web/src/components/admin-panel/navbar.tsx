import { ModeToggle } from "@/components/mode-toggle";
import { UserNav } from "@/components/admin-panel/user-nav";
import { SheetMenu } from "@/components/admin-panel/sheet-menu";
// import { Separator } from "@/components/ui/separator";
// import { LanguageSwitcher } from "@/components/language-switcher";

interface NavbarProps {
  children: React.ReactNode;
}

export function Navbar({ children }: NavbarProps) {
  return (
    <header className="sticky top-0 z-10 w-full bg-background/95 shadow backdrop-blur supports-backdrop-filter:bg-background/60 dark:shadow-secondary">
      <div className="mx-4 sm:mr-8 flex h-14 items-center">
        <SheetMenu />
        <div className="sm:ml-4 flex flex-1 items-center space-x-4 lg:space-x-0">
          {children}
        </div>
        <div className="flex items-center">
          {/* <Separator orientation="vertical" className="mx-2 min-h-6" />
          <LanguageSwitcher />
          <Separator orientation="vertical" className="mr-3 ml-4 min-h-6" /> */}
          <ModeToggle />
          <UserNav />
        </div>
      </div>
    </header>
  );
}
