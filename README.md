# 🧠 Decision Debt Tracker

> Quantify cognitive load.
> Reduce mental drag.
> Ship decisions faster.

---

## 🌐 Live Demo

👉 **[https://decision-debt-tracker.vercel.app](https://decision-debt-tracker.vercel.app)**

A web-based cognitive load tracking system that models “decision debt” using time-weighted scoring and stress impact analysis.

---

## 📖 What Is Decision Debt?

Unresolved decisions quietly drain mental energy.

The longer a decision stays open, the heavier it feels.

Decision Debt Tracker makes that invisible cognitive load measurable by assigning a dynamic debt score that grows over time — allowing you to prioritize what’s mentally expensive first.

---

## ⚙️ Core Concept

Each decision accumulates debt based on:

* **Impact (1–5)**
* **Stress (1–5)**
* **Days Open**
* **Overdue Acceleration**
* **Compounding Time Weight**

The system produces:

* 📈 A live debt score per decision
* 🧮 Total and average debt metrics
* 💡 A weekly decision health score (0–100)

---

## 🖥️ Two Interfaces

### 1️⃣ Python CLI (Local-first)

```bash
ddt add --title "Choose internship housing" --impact 4 --stress 3
ddt list
ddt resolve --id 3
```

Features:

* SQLite persistence
* Markdown export reports
* Unit tested scoring logic
* Offline-first design

---

### 2️⃣ Next.js Web App (Deployed)

Built with:

* Next.js 16
* TypeScript
* Tailwind CSS
* Framer Motion
* Lucide Icons
* LocalStorage persistence

The dashboard automatically:

* Sorts decisions by highest debt
* Calculates total & average debt
* Updates health score dynamically
* Animates state transitions

---

## 🧠 Why This Project Exists

Decision fatigue is real.

We track calories.
We track sleep.
We track steps.

But we don’t track unresolved decisions — even though they directly impact clarity and productivity.

This project explores how cognitive load can be modeled and visualized in a measurable way.

---

## 🏗️ Architecture Overview

```
decision-debt-tracker/
│
├── ddt/                # Python CLI package
├── reports/            # Markdown export outputs
├── tests/              # Unit tests
├── web/                # Next.js frontend
│   ├── app/
│   ├── lib/
│   └── components/
```

---

## 🚀 Installation (CLI)

Requires Python 3.11+

```bash
git clone https://github.com/Emmanuella-t/decision-debt-tracker.git
cd decision-debt-tracker
pip install -e .
```

---

## 🔮 Future Extensions

* Supabase backend
* AI-based decision suggestion engine
* Historical debt trend charts
* Productivity analytics export
* Mobile-friendly PWA version

---

## 👩🏽‍💻 Author

Built by **Emmanuella Turkson**

Computer Science • AI • UX • Systems Thinking

---

# Why This Version Is Stronger

It:

* Positions it as a concept, not a toy
* Shows architecture
* Shows stack
* Shows thinking
* Signals depth
* Feels product-minded


