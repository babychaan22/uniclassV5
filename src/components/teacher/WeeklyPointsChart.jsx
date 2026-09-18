
import ClayCard from "@/components/ClayCard";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";

const COLORS = ["#8B5CF6", "#FF5FA8", "#A6E22E", "#FFD93D", "#4FD1F2", "#FF6B57", "#5EE2C4", "#FF9F1C"];

export default function WeeklyPointsChart({ data, groups }) {
  return (
    <ClayCard className="p-4">
      <h2 className="font-display font-bold text-sm mb-2">Weekly participation points</h2>
      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#17162B18" />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Legend />
          {groups.map((g, i) => (
            <Bar key={g.id} dataKey={`G${g.group_number}`} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ClayCard>
  );
}
