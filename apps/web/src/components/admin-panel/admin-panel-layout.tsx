"use client";

// import { Footer } from "@/components/admin-panel/footer";
import { Sidebar } from "@/components/admin-panel/sidebar";
import { useSidebar } from "@/hooks/use-sidebar";
import { useStore } from "@/hooks/use-store";
import { cn } from "@/lib/utils";

export default function AdminPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sidebar = useStore(useSidebar, (x) => x);
  if (!sidebar) return null;
  const { getOpenState, settings } = sidebar;

  return (
    <>
      <Sidebar />
      <main
        className={cn(
          "min-h-[calc(100vh-26px)] max-h-[calc(100vh-26px)] bg-zinc-50 dark:bg-zinc-900 transition-[margin-left] ease-in-out duration-300",
          !settings.disabled && (!getOpenState() ? "lg:ml-22.5" : "lg:ml-72"),
        )}
      >
        {children}
      </main>

      <footer
        className={cn(
          "min-h-6.5 max-h-6.5 bg-background border-border border-t text-[10px]  shadow-md dark:shadow-zinc-800 shrink-0 flex items-center gap-3 px-3 ease-in-out duration-300 z-21",
        )}
      >
        <span className="flex items-center gap-1.5 "></span>
        <div className="flex-1" />

        <span>v1.0.0</span>
      </footer>
    </>
  );
}
