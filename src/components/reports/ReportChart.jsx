import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const CHART_COLORS = ['#b42318', '#176b87', '#8b5e00', '#247a55', '#6d4aa1', '#a13e72', '#4d6475'];

// With `width`, the chart is drawn at that fixed size and without animation: the printed sheet is display:none on screen,
// where a responsive container would measure zero.
export default function ReportChart({ result, width = 0 }) {
  const unit = result.report.unit || 'Shifts';
  const height = 320;
  const fixed = width > 0;
  const animate = !fixed;
  const frame = (chart) =>
    fixed ? chart : <ResponsiveContainer width="100%" height={height}>{chart}</ResponsiveContainer>;
  const size = fixed ? { width, height } : {};

  if (!result.rows.length) {
    return <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">No results for this date range.</p>;
  }

  if (result.report.visualization === 'pie') {
    return frame(
      <PieChart {...size}>
        <Pie data={result.rows} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={105} label isAnimationActive={animate}>
          {result.rows.map((row, index) => <Cell key={row.key} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    );
  }

  if (result.report.visualization === 'line') {
    return frame(
      <LineChart {...size} data={result.rows} margin={{ top: 12, right: 20, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
        <YAxis allowDecimals />
        <Tooltip />
        <Line type="monotone" dataKey="value" name={unit} stroke="#176b87" strokeWidth={3} dot={{ r: 3 }} isAnimationActive={animate} />
      </LineChart>
    );
  }

  return frame(
    <BarChart {...size} data={result.rows} margin={{ top: 12, right: 20, left: 0, bottom: 8 }}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
      <YAxis allowDecimals />
      <Tooltip />
      <Bar dataKey="value" name={unit} fill="#176b87" radius={[4, 4, 0, 0]} isAnimationActive={animate} />
    </BarChart>
  );
}
