"use client";

import { motion } from "framer-motion";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-black text-white flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="text-center space-y-6"
      >
        <h1 className="text-5xl font-bold tracking-tight">
          Decision Debt Tracker
        </h1>

        <p className="text-lg text-gray-400 max-w-md mx-auto">
          Measure cognitive load. Reduce mental drag. Ship decisions faster.
        </p>

        <motion.a
          href="/dashboard"
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.95 }}
          className="inline-block px-6 py-3 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-600/30 transition-all duration-300"
        >
          Enter Dashboard
        </motion.a>
      </motion.div>
    </main>
  );
}
