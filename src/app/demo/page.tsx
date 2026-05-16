import DashboardView from "@/components/DashboardView";

export default function DemoPage() {
  return (
    <DashboardView
      endpoint="/api/mock-data"
      refreshEndpoint={null}
      demoBadge
    />
  );
}
