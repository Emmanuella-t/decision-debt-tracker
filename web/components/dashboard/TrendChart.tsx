"use client";

import { useState } from "react";
import { formatMonthTick } from "../../lib/dates";
import type { Snapshot } from "../../lib/types";

export function TrendChart({ snapshots }: { snapshots: Snapshot[] }) {
  const [active, setActive] = useState<number | null>(null);
  const width = 640;
  const height = 260;
  const pad = { left: 36, right: 18, top: 24, bottom: 36 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(10, ...snapshots.map((snapshot) => snapshot.totalDebt));
  const yMax = Math.ceil(max / 10) * 10;
  const ticks = [0, yMax / 2, yMax];

  const point = (snapshot: Snapshot, index: number) => {
    const x = pad.left + (snapshots.length === 1 ? innerW / 2 : (index / (snapshots.length - 1)) * innerW);
    const y = pad.top + innerH - (snapshot.totalDebt / yMax) * innerH;
    return { x, y };
  };

  const points = snapshots.map(point);
  const line = points.map((item, index) => `${index === 0 ? "M" : "L"} ${item.x} ${item.y}`).join(" ");
  const area = `${line} L ${points[points.length - 1].x} ${pad.top + innerH} L ${points[0].x} ${pad.top + innerH} Z`;
  const labelStep = Math.max(1, Math.ceil(snapshots.length / 6));

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="trend-title trend-desc" className="h-auto w-full">
        <title id="trend-title">Decision debt trend</title>
        <desc id="trend-desc">
          Recorded total unresolved decision debt for {snapshots.length} days, from {snapshots[0].date} to{" "}
          {snapshots[snapshots.length - 1].date}.
        </desc>
        {ticks.map((tick) => {
          const y = pad.top + innerH - (tick / yMax) * innerH;
          return (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="#E8EFF1" />
              <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize="12" fill="#5E7278">
                {tick}
              </text>
            </g>
          );
        })}
        <path d={area} fill="#177C72" opacity="0.16" />
        <path d={line} fill="none" stroke="#177C72" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((item, index) => (
          <g key={snapshots[index].date}>
            <circle
              cx={item.x}
              cy={item.y}
              r={active === index ? 6 : 4}
              fill="#177C72"
              tabIndex={0}
              role="graphics-symbol"
              aria-label={`${formatMonthTick(snapshots[index].date)}: ${snapshots[index].totalDebt} debt points`}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
            />
            {index % labelStep === 0 || index === snapshots.length - 1 ? (
              <text x={item.x} y={height - 10} textAnchor="middle" fontSize="12" fill="#5E7278">
                {formatMonthTick(snapshots[index].date)}
              </text>
            ) : null}
          </g>
        ))}
        {active !== null ? (
          <g>
            <rect x={points[active].x - 28} y={points[active].y - 34} width="56" height="24" rx="12" fill="#142A32" />
            <text x={points[active].x} y={points[active].y - 18} textAnchor="middle" fontSize="12" fill="#ffffff">
              {snapshots[active].totalDebt}
            </text>
          </g>
        ) : (
          <g>
            <rect
              x={points[points.length - 1].x - 28}
              y={points[points.length - 1].y - 34}
              width="56"
              height="24"
              rx="12"
              fill="#142A32"
            />
            <text
              x={points[points.length - 1].x}
              y={points[points.length - 1].y - 18}
              textAnchor="middle"
              fontSize="12"
              fill="#ffffff"
            >
              {snapshots[snapshots.length - 1].totalDebt}
            </text>
          </g>
        )}
      </svg>
      <table className="sr-only">
        <caption>Recorded decision debt by day</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Total debt</th>
            <th>Open decisions</th>
            <th>Overdue decisions</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((snapshot) => (
            <tr key={snapshot.date}>
              <td>{snapshot.date}</td>
              <td>{snapshot.totalDebt}</td>
              <td>{snapshot.openCount}</td>
              <td>{snapshot.overdueCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
