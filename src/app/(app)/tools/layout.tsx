import { ToolsMobilePicker, ToolsNavigation } from "./tools-navigation";

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-canvas">
      <ToolsNavigation />
      <div className="flex min-w-0 flex-1 flex-col">
        <ToolsMobilePicker />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
