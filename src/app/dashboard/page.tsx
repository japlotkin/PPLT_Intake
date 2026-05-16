import DashboardView from "@/components/DashboardView";

export default function DashboardPage() {
  return (
    <DashboardView
      endpoint="/api/data"
      refreshEndpoint="/api/refresh"
    />
  );
}
