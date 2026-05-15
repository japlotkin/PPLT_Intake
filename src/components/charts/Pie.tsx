"use client";

import { Cell, Pie as RPie, PieChart, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { EmptyState } from "../EmptyState";

const COLORS = [
  "#d97706",
  "#0ea5e9",
  "#10b981",
  "#a855f7",
  "#f43f5e",
  "#facc15",
  "#22d3ee",
  "#84cc16",
  "#64748b",
  "#fb923c",
];

export function Pie({
  data,
  height = 280,
}: {
  data: Array<{ name: string; value: number }>;
  height?: number;
}) {
  if (!data || data.length === 0) return <EmptyState />;
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <PieChart>
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #e5e5e5",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <RPie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={50}
            outerRadius={90}
            paddingAngle={2}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </RPie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
