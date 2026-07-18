import { ToolsMobilePicker, ToolsNavigation } from "./tools-navigation";

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <ToolsNavigation />
      <div className="flex min-w-0 flex-1 flex-col">
        <ToolsMobilePicker />
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
