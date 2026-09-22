
import ClayCard from "@/components/ClayCard";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { useState } from "react";

const COLORS = ["#8B5CF6", "#FF5FA8", "#A6E22E", "#FFD93D", "#4FD1F2", "#FF6B57", "#5EE2C4", "#FF9F1C"];

export default function WeeklyPointsChart({ data, groups }) {
  const [hoveredWeek, setHoveredWeek] = useState(null);
  return (
    <ClayCard className="p-4">
      <h2 className="font-display font-bold text-sm mb-2">Weekly participation points</h2>
      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} onClick={(state) => { const selected = state?.activePayload?.[0]?.payload; if (selected) setHoveredWeek((current) => current === selected ? null : selected); }} style={{ cursor: 'pointer' }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#17162B18" />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip content={() => null} cursor={{ fill: '#8B5CF61A' }} />
          <Legend />
          {groups.map((g, i) => (
            <Bar key={g.id} dataKey={`G${g.group_number}`} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 min-h-12 rounded-xl border-2 border-ink/10 bg-cream px-3 py-2 text-xs" aria-live="polite">{hoveredWeek ? <><p className="font-display font-bold">Week {hoveredWeek.week}</p><div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-ink/75">{groups.map((group) => <p key={group.id} className="flex justify-between gap-2"><span>Group {group.group_number}</span><span className="font-mono">{hoveredWeek[`G${group.group_number}`] || 0}</span></p>)}</div></> : <p className="text-ink/55">Select a bar to see the weekly group point totals.</p>}</div>
    </ClayCard>
  );
}
