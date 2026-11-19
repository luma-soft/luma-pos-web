import { TileCalculator } from "./tile-calculator";
import { ToolsMobileRoot } from "./tools-mobile-root";

export default async function ToolsPage({ searchParams }: { searchParams: Promise<{ tool?: string }> }) {
  const { tool } = await searchParams;
  // Phones open the tools list first (NativeToolsView); desktop keeps the calculator here.
  if (tool === "tile") return <TileCalculator />;
  return (
    <>
      <ToolsMobileRoot />
      <div className="max-md:hidden"><TileCalculator /></div>
    </>
  );
}
