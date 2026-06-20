export function Row({
  label, value, highlight, muted,
}: { label: string; value: string; highlight?: "green" | "red"; muted?: boolean }) {
  const valColor =
    highlight === "green" ? "text-emerald-400" :
    highlight === "red" ? "text-red-300" :
    muted ? "text-white/60" : "text-white";
  const labelColor = muted ? "text-white/60" : highlight ? "text-white/90" : "text-white/80";
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={labelColor}>{label}</span>
      <span className={`font-bold ${highlight ? "text-lg" : ""} ${valColor}`}>{value}</span>
    </div>
  );
}
