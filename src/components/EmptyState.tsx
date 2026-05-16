export function EmptyState({ message = "No data available" }: { message?: string }) {
  return (
    <div className="flex items-center justify-center h-40 rounded-lg border border-dashed border-slate-300 bg-slate-50/40 text-sm text-slate-500">
      {message}
    </div>
  );
}
