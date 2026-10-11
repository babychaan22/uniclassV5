
import ClayCard from "@/components/ClayCard";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { useState } from "react";
import { UIAsset } from "@/components/visual/UIAsset";

const COLORS = ["#6C55D9", "#42A9E8", "#80C94B", "#F4C95D", "#8E7BF0", "#E67694", "#55BFA0", "#E3A73D"];

export default function WeeklyPointsChart({ data, groups }) {
  const [hoveredWeek, setHoveredWeek] = useState(null);
  return (
    <ClayCard className="p-4">
      <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold"><span className="uc-icon-tile h-9 w-9 rounded-xl bg-[var(--uc-green-soft)]"><UIAsset name="points" className="h-7 w-7" /></span>Weekly participation points</h2>
      <div className="uc-chart-shell px-2 pt-1">
      <ResponsiveContainer width="100%" height={166}>
        <BarChart className="uc-chart" data={data} margin={{ top: 10, right: 4, left: -18, bottom: 0 }} onClick={(state) => { const selected = state?.activePayload?.[0]?.payload; if (selected) setHoveredWeek((current) => current === selected ? null : selected); }} style={{ cursor: 'pointer' }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#17162B18" />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip content={() => null} cursor={{ fill: 'rgba(108,85,217,.10)' }} />
          <Legend />
          {groups.map((g, i) => (
            <Bar key={g.id} dataKey={`G${g.group_number}`} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      </div>
      <div className="mt-3 min-h-12 rounded-xl border border-[var(--uc-purple)]/12 bg-[var(--uc-purple-soft)]/55 px-3 py-2 text-xs" aria-live="polite">{hoveredWeek ? <><p className="font-display font-bold">Week {hoveredWeek.week}</p><div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-ink/75">{groups.map((group) => <p key={group.id} className="flex justify-between gap-2"><span>Group {group.group_number}</span><span className="font-mono">{hoveredWeek[`G${group.group_number}`] || 0}</span></p>)}</div></> : <p className="text-ink/55">Select a bar to see the weekly group point totals.</p>}</div>
    </ClayCard>
  );
}
