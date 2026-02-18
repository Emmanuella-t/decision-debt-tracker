"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Plus, CheckCircle2, Sparkles } from "lucide-react";

import {
  type Decision,
  addDecision,
  computeAll,
  computeSummary,
  loadDecisions,
  resolveDecision,
  saveDecisions,
} from "../../lib/data/decisions";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function MetricCard(props: { label: string; value: string; hint?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur"
    >
      <div className="text-sm text-slate-300">{props.label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{props.value}</div>
      {props.hint ? <div className="mt-2 text-sm text-slate-400">{props.hint}</div> : null}
    </motion.div>
  );
}

function AddModal(props: {
  open: boolean;
  onClose: () => void;
  onAdd: (d: Omit<Decision, "id">) => void;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("life");
  const [impact, setImpact] = useState(3);
  const [stress, setStress] = useState(3);
  const [dueDate, setDueDate] = useState<string>("");

  useEffect(() => {
    if (!props.open) return;
    setTitle("");
    setCategory("life");
    setImpact(3);
    setStress(3);
    setDueDate("");
  }, [props.open]);

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/60"
        onClick={props.onClose}
      />
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22 }}
        className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <div className="text-xl font-semibold">Add a decision</div>
          <button
            onClick={props.onClose}
            className="rounded-xl px-3 py-2 text-slate-300 hover:bg-white/5"
          >
            Close
          </button>
        </div>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-2">
            <span className="text-sm text-slate-300">Title</span>
            <input
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-indigo-400/60"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Pick internship housing"
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-2">
              <span className="text-sm text-slate-300">Category</span>
              <input
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-indigo-400/60"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="life, school, career..."
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm text-slate-300">Due date (optional)</span>
              <input
                type="date"
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-indigo-400/60"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-2">
              <span className="text-sm text-slate-300">Impact (1–5)</span>
              <input
                type="range"
                min={1}
                max={5}
                value={impact}
                onChange={(e) => setImpact(Number(e.target.value))}
              />
              <div className="text-sm text-slate-400">Impact: {impact}</div>
            </label>

            <label className="grid gap-2">
              <span className="text-sm text-slate-300">Stress (1–5)</span>
              <input
                type="range"
                min={1}
                max={5}
                value={stress}
                onChange={(e) => setStress(Number(e.target.value))}
              />
              <div className="text-sm text-slate-400">Stress: {stress}</div>
            </label>
          </div>

          <button
            onClick={() => {
              if (!title.trim()) return;
              props.onAdd({
                title: title.trim(),
                category: category.trim() || "life",
                impact,
                stress,
                createdDate: todayISO(),
                dueDate: dueDate || null,
                resolvedDate: null,
              });
              props.onClose();
            }}
            className="mt-2 rounded-2xl bg-indigo-600 px-5 py-3 font-medium hover:bg-indigo-500 transition"
          >
            Add decision
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function DashboardPage() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const loaded = loadDecisions();
    setDecisions(loaded);
  }, []);

  useEffect(() => {
    if (decisions.length === 0) {
      // still save so the key exists
      saveDecisions(decisions);
      return;
    }
    saveDecisions(decisions);
  }, [decisions]);

  const active = useMemo(() => computeAll(decisions), [decisions]);
  const summary = useMemo(() => computeSummary(active), [active]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-black text-white">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 text-slate-300">
              <Sparkles size={18} />
              <span className="text-sm">Decision Debt Tracker</span>
            </div>
            <h1 className="mt-2 text-4xl font-bold tracking-tight">Dashboard</h1>
            <p className="mt-2 text-slate-400 max-w-xl">
              Your decisions are sorted by debt so you always know what’s pulling on your mind the most.
            </p>
          </div>

          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 font-medium hover:bg-indigo-500 transition shadow-lg shadow-indigo-600/25"
          >
            <Plus size={18} />
            Add decision
          </button>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          <MetricCard label="Total Debt" value={`${summary.totalDebt}`} hint="Sum of active decision debt." />
          <MetricCard label="Average Debt" value={`${summary.avgDebt}`} hint="Average debt per active decision." />
          <MetricCard label="Decision Health" value={`${summary.healthScore}/100`} hint="Higher is better." />
        </div>

        <div className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Active decisions</h2>
            <div className="text-sm text-slate-400">{active.length} active</div>
          </div>

          <div className="mt-4 grid gap-3">
            {active.length === 0 ? (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-slate-300">
                <div className="text-lg font-semibold">No active decisions</div>
                <div className="mt-2 text-slate-400">
                  Add one and your decision debt score will start tracking automatically.
                </div>
              </div>
            ) : (
              active.map((d) => (
                <motion.div
                  key={d.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm rounded-full bg-white/10 px-3 py-1 text-slate-200">
                          {d.category}
                        </span>
                        <span className="text-sm text-slate-400">#{d.id.slice(0, 6)}</span>
                      </div>
                      <div className="mt-2 text-xl font-semibold">{d.title}</div>

                      <div className="mt-2 text-sm text-slate-400">
                        Debt: <span className="text-slate-200 font-medium">{d.debt}</span> · Days open:{" "}
                        <span className="text-slate-200 font-medium">{d.daysOpen}</span> · Overdue:{" "}
                        <span className="text-slate-200 font-medium">{d.overdueDays}</span>
                        {d.dueDate ? <> · Due: <span className="text-slate-200 font-medium">{d.dueDate}</span></> : null}
                      </div>
                    </div>

                    <button
                      onClick={() => setDecisions((prev) => resolveDecision(prev, d.id))}
                      className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-slate-200 hover:bg-white/10 transition"
                    >
                      <CheckCircle2 size={18} />
                      Resolve
                    </button>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </div>

      <AddModal
        open={open}
        onClose={() => setOpen(false)}
        onAdd={(d) => setDecisions((prev) => addDecision(prev, d))}
      />
    </main>
  );
}
