# HabitArc

A modern habit tracking SaaS application built with a Rust backend and Next.js frontend.

## Architecture

```
habit-arc/
├── backend/          # Rust Axum API (source of truth)
│   ├── src/
│   │   ├── main.rs
│   │   ├── config.rs
│   │   ├── db/
│   │   ├── auth/
│   │   ├── handlers/
│   │   ├── models/
│   │   ├── services/
│   │   └── ws/
│   ├── migrations/
│   └── Cargo.toml
├── frontend/         # Next.js 15 App Router
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   ├── hooks/
│   │   └── stores/
│   └── package.json
└── docker-compose.yml
```

## Stack

### Backend (Rust)
- **Axum 0.7** – HTTP framework
- **SQLx** – Compile-time verified SQL against PostgreSQL 16
- **deadpool-postgres** – Connection pooling
- **JWT** – Access + refresh token rotation
- **WebSocket** – Real-time habit state updates
- **tracing** – Structured logging

### Frontend (Next.js)
- **Next.js 15** (App Router) + **React 19** + **TypeScript** (strict)
- **Tailwind CSS** + **shadcn/ui** – Styling & components
- **TanStack Query** – Server state management
- **Zustand** – Client state management
- **Framer Motion** – Animations
- **Recharts** – Streak & analytics visualization
- **date-fns** – Date utilities
- **PWA** – Offline queue + installability

### Infrastructure
- Frontend on **Vercel**
- Backend on **Fly.io** (or Railway)
- **Managed PostgreSQL**
- **Stripe** – Billing + webhooks
- **Claude API** – AI-powered habit insights
- **Sentry** – Error tracking + metrics

## Critical Design Rule

> **Next.js does NOT own business logic.**
> The Rust API is the single source of truth for domain rules, auth, entitlements, streaks, and billing state.

## Local Development

### Prerequisites
- Rust 1.75+
- Node.js 20+
- PostgreSQL 16
- Docker & Docker Compose (optional)

### Quick Start

```bash
# Start Postgres (via Docker)
docker compose up -d postgres

# Backend
cd backend
cp .env.example .env
cargo run

# Frontend (separate terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Backend runs on `http://localhost:8080`, frontend on `http://localhost:3000`.
