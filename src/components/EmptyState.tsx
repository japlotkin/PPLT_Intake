export function EmptyState({ message = "No data available" }: { message?: string }) {
  return (
    <div className="flex items-center justify-center h-40 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 text-sm text-neutral-500">
      {message}
    </div>
  );
}
