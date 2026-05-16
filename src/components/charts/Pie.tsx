"use client";

import { Cell, Pie as RPie, PieChart, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { EmptyState } from "../EmptyState";

const COLORS = [
  "#2563eb",
  "#0ea5e9",
  "#7c3aed",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#8b5cf6",
  "#64748b",
  "#14b8a6",
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
              borderRadius: 10,
              border: "1px solid #e2e8f0",
              fontSize: 12,
              boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
            }}
            labelStyle={{ color: "#0f172a", fontWeight: 600 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
          <RPie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={55}
            outerRadius={95}
            paddingAngle={2}
            stroke="#fff"
            strokeWidth={2}
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
