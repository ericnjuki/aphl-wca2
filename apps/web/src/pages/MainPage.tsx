import AdminPanelLayout from "@/components/admin-panel/admin-panel-layout";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Outlet } from "react-router-dom";

export default function App() {
  return (
    <TooltipProvider delayDuration={0}>
      <AdminPanelLayout>
        <Outlet />
      </AdminPanelLayout>
    </TooltipProvider>
  );
}
