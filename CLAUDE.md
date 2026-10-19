# PulseBoard — Agent Instructions

## Before you start working

Read the following docs (in this order) to understand the project:

1. `docs/architecture.md` — System diagram, directory layout, every layer's role, DB schema, Redis keys, Socket.IO events, upload pipeline, auth flow, permissions
2. `docs/rules.md` — Coding conventions, naming, API response format, migration process, caching patterns, testing conventions
3. `docs/design.md` — Why things are built this way — design decisions and trade-offs
4. `docs/prd.md` — Product requirements, implemented features, and roadmap (Phase 8–9 + future features)
5. `docs/tasks.md` — What's done, what's next (Phase 8: Production Readiness, Phase 9: DevOps), and the full backlog
6. `docs/memory.md` — Gotchas, surprises, step-by-step patterns for adding entities/fields/events, Redis key reference, full API endpoint list

Read all six before writing any code. They are the source of truth for how this project works and how new code should be written.

## Quick reference

- **Stack**: Node.js (ESM), Express 5, Socket.IO 4, PostgreSQL (Prisma 7), Redis (ioredis + BullMQ), Zod, JWT, bcrypt
- **Frontend**: React 19, Redux Toolkit (RTK Query), Vite, Tailwind CSS 4 — lives in `web/`
- **Tests**: `npm test` (Jest + Supertest, uses `.env.test`)
- **Dev server**: `npm run dev` (API on :3000), `npm run worker` (upload worker)
- **Migrations**: Raw SQL in `migrations/`, applied manually. Then update `prisma/schema.prisma` and run `npx prisma generate`.

## Key rules

- Follow the patterns in `docs/rules.md` — especially response format, error codes, cache key naming, and socket emit conventions
- Never use Prisma Migrate — raw SQL migrations only
- Every write must invalidate the relevant Redis cache keys AND emit the Socket.IO event
- Check `docs/tasks.md` for what to work on next
