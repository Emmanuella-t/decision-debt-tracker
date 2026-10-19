"use client";

import type { DepartmentSegment } from "../../lib/analytics";

export function DepartmentDonut({
  totalDebt,
  segments,
}: {
  totalDebt: number;
  segments: DepartmentSegment[];
}) {
  const radius = 62;
  const circumference = 2 * Math.PI * radius;
  const arcs = segments.map((segment, index) => {
    const start = segments.slice(0, index).reduce((sum, item) => sum + item.share, 0);
    return {
      ...segment,
      length: segment.share * circumference,
      offset: start * circumference,
    };
  });

  return (
    <div className="grid items-center gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
      <svg viewBox="0 0 180 180" role="img" aria-labelledby="dept-title dept-desc" className="mx-auto h-44 w-44">
        <title id="dept-title">Decision debt by department</title>
        <desc id="dept-desc">
          {segments.map((segment) => `${segment.department} ${Math.round(segment.share * 100)} percent`).join(", ")}.
          The center total is {totalDebt} unresolved debt points.
        </desc>
        <circle cx="90" cy="90" r={radius} fill="none" stroke="#E8EFF1" strokeWidth="18" />
        {arcs.map((segment) => (
            <circle
              key={segment.department}
              cx="90"
              cy="90"
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth="18"
              strokeDasharray={`${segment.length} ${circumference - segment.length}`}
              strokeDashoffset={-segment.offset}
              transform="rotate(-90 90 90)"
            />
          ))}
        <text x="90" y="86" textAnchor="middle" fontSize="28" fontWeight="700" fill="#142A32">
          {totalDebt}
        </text>
        <text x="90" y="108" textAnchor="middle" fontSize="12" fill="#5E7278">
          Debt points
        </text>
      </svg>
      <ul className="grid gap-2">
        {segments.map((segment) => (
          <li key={segment.department} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} aria-hidden="true" />
              <span>{segment.department}</span>
            </span>
            <span className="tabular-nums text-muted">{Math.round(segment.share * 100)}%</span>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-5 text-muted sm:col-span-2">
        Shares are portions of unresolved debt points, not a count of decisions. The center total is the same unresolved debt shown in the first KPI.
      </p>
    </div>
  );
}
