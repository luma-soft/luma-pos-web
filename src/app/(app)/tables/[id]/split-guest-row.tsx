export function SplitGuestRow({
  label,
  amount,
  quantityControl,
}: {
  label: React.ReactNode;
  amount: React.ReactNode;
  quantityControl: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-slate-500">{label}</span>
      <div className="flex min-w-0 flex-col items-stretch gap-2 min-[420px]:flex-row min-[420px]:items-center">
        {quantityControl}
        <span className="min-w-0 break-words text-right font-mono font-bold text-primary-600">{amount}</span>
      </div>
    </div>
  );
}
