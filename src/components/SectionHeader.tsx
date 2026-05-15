export function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-5">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {subtitle && (
        <p className="text-sm text-neutral-500 mt-0.5">{subtitle}</p>
      )}
    </div>
  );
}
