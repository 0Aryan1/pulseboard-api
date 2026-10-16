# PulseBoard

PulseBoard is a real-time project and task management backend. Teams create
projects, invite members with roles, track tasks, comment, and attach files —
and every change shows up instantly in all connected browsers through
Socket.IO. A React client lives in [`web/`](web/).

## Tech stack

| Layer | Technology |
| --- | --- |
| API | Node.js (ESM), Express 5, Helmet, CORS, express-rate-limit |
| Real-time | **Socket.IO 4** (JWT-authenticated, room-based) |
| Database | PostgreSQL via Prisma 7 (`@prisma/adapter-pg`), SQL migrations in [`migrations/`](migrations/) |
| Queue / cache | Redis, BullMQ (attachment processing worker) |
| Auth & validation | JWT, bcrypt, Zod |
| Uploads | Multer |
| Tests | Jest, Supertest, socket.io-client |
| Web client | React 19, Redux Toolkit, Vite, Tailwind CSS |

## Architecture

```
 React client (web/)
   │  REST  /api/v1/*            │  Socket.IO (auth: JWT)
   ▼                             ▼
 ┌──────────────── Express + Socket.IO (src/server.js) ───────────────┐
 │ routes → middleware (auth, project role) → controllers → data layer │
 │                                   │                                 │
 │               src/socket.js  ◄────┘ emit after each change          │
 │               src/uploadEvents.js ◄── BullMQ QueueEvents (Redis)    │
 └────────────┬───────────────────────────────────────┬────────────────┘
              ▼                                       ▲
         PostgreSQL                      src/worker.js (BullMQ worker)
                                         processes uploads, sets status
```

- **Layers:** `routes/` → `middleware/` → `controllers/` → `data/` (Prisma
  queries), with Zod `schemas/` for input validation.
- **Roles:** project members are `Admin` or `Member`; role middleware guards
  routes, and task/comment permissions are enforced server-side.
- **Uploads:** the API stores the file, enqueues a job, and returns the
  attachment as `processing`. The worker (a separate process) marks it
  `ready` or `failed`; the API hears the result via BullMQ `QueueEvents` and
  pushes it to clients, so this works with multiple API instances.

## Socket.IO implementation

All of it is in [`src/socket.js`](src/socket.js):

- **Authentication:** a handshake middleware verifies the JWT from
  `auth.token`; connections without a valid token are rejected.
- **Rooms:** every socket joins `user:<id>`; `joinProject` adds it to
  `project:<id>` only after a membership check in the database.
- **Emit helpers:** `emitToProject`, `emitToUser`, `emitToProjectAndMembers`,
  `emitToUserAndProjects`, `emitToProjects` — called from controllers after a
  successful write. A multi-room emit reaches each socket once.
- **Access revocation:** `removeUserFromProject`, `closeProjectRoom` and
  `disconnectUser` evict sockets when a member is removed, a project is
  deleted, or an account is deleted.
- **Events:** `projectUpdated`, `projectDeleted`, `taskCreated/Updated/Deleted`,
  `commentCreated/Updated/Deleted`, `memberAdded/Updated/Removed`,
  `attachmentCreated/Ready/Failed/Deleted`, `userUpdated`, `userDeleted`,
  `removedFromProject`.
- Client side: [`web/src/services/socket.js`](web/src/services/socket.js) and
  the hooks in [`web/src/hooks/`](web/src/hooks/).

### Tests

Integration tests run the real Express app and Socket.IO server together on a
random port ([`tests/helpers/liveServer.js`](tests/helpers/liveServer.js)):

- [`tests/socket.integration.test.js`](tests/socket.integration.test.js) —
  authentication, room joining, non-member rejection, leaving rooms.
- [`tests/projectLiveEvents.integration.test.js`](tests/projectLiveEvents.integration.test.js),
  [`memberLiveEvents`](tests/memberLiveEvents.integration.test.js),
  [`userLiveEvents`](tests/userLiveEvents.integration.test.js),
  [`uploadEvents.unit`](tests/uploadEvents.unit.test.js) — events end to end.

## Getting started

Requires Node.js 20+, PostgreSQL and Redis.

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL, JWT_SECRET, ...
cp .env.example .env.test     # point at a separate test database
# apply migrations/*.sql in order, then:
npx prisma generate

npm run dev                   # API + Socket.IO on :3000
npm run worker                # attachment worker (separate terminal)
npm test                      # Jest (uses .env.test)
```

For the web client, see [`web/README.md`](web/README.md).

## API overview

Base path `/api/v1`; `GET /health` is unauthenticated. All other routes need
`Authorization: Bearer <jwt>`.

- `auth` — signup, login
- `users`
- `projects` and `projects/:projectId/members`
- `projects/:projectId/tasks`
- `tasks/:taskId/comments`, `tasks/:taskId/attachments`

## Security notes

- Secrets are read from environment variables; `.env*` files are git-ignored
  (only `.env.example` is tracked).
- Passwords are hashed with bcrypt; requests are validated with Zod; Helmet and
  rate limiting are enabled.
