# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CAM (Coding Agents Manager) is a CI/CD-style platform for orchestrating coding agents (Claude Code, Codex, Aider) via Docker containers. It is a pnpm monorepo with Turbo orchestration.

## Commands

```bash
# Setup
corepack enable && pnpm install

# Development
pnpm dev              # Run all apps via Turbo
pnpm dev:web          # Web app only (Next.js on port 3000)
pnpm dev:worker       # Worker only (daemon mode, needs Agent CLI on host)

# Build & Lint
pnpm build            # Build all packages
pnpm lint             # Lint all (ESLint + next lint)
pnpm build:shared     # Build shared package only

# Database (Drizzle + SQLite)
pnpm db:generate      # Generate Drizzle migrations after schema changes
pnpm db:migrate       # Run migrations
pnpm db:seed          # Seed built-in agents (claude-code, codex, aider)

# Testing
pnpm --filter @cam/web test              # Unit tests (Node.js --test runner)
pnpm --filter @cam/web test:e2e          # E2E tests (Playwright)
pnpm --filter @cam/web test:e2e:ui       # E2E interactive UI mode

# Docker
docker compose up --build                 # Production single-node deploy
pnpm docker:build:agents                  # Build worker agent images

# Windows quick start
start-dev.bat
```

There is no unified test runner. Unit tests use Node's native `--test` runner with `--experimental-strip-types` for direct TS execution. Test files are colocated with source as `*.test.ts`. Before PRs, run `pnpm lint && pnpm build`.

## Architecture

### Three main packages

- **`apps/web/`** — Next.js 15 (App Router) serving the React UI, all REST API routes, the task scheduler, SSE event stream, and Drizzle ORM layer over SQLite.
- **`apps/worker/`** — Node.js worker (ESM, `simple-git`) that registers with the web API, polls for tasks, executes coding agents inside Docker containers, and reports back via heartbeat.
- **`packages/shared/`** — Shared TypeScript types (`Task`, `AgentDefinition`, `Worker`, `Event`) built with tsup to ESM+CJS.

### Data flow

User creates task → API stores in SQLite → Scheduler (`/api/scheduler/tick`) claims queued tasks → Starts Docker container per task (via Dockerode) → Worker executes agent CLI → Heartbeat reports progress → Results/PR URL stored in DB → SSE pushes updates to UI.

### Task lifecycle

`draft → queued/waiting → running → awaiting_review → approved/rejected → completed/failed/cancelled`

Tasks support dependency graphs (DAG via `dependsOn` JSON array). Waiting tasks promote to queued when all dependencies complete. Task groups share a `groupId` for pipeline operations.

### Key subsystems in `apps/web/src/lib/`

- **`db/schema.ts`** — Drizzle schema (11 tables: `agent_definitions`, `repositories`, `task_templates`, `tasks`, `task_logs`, `secrets`, `workers`, `users`, `sessions`, `oauth_accounts`, `api_tokens`, `system_events`). DB columns are snake_case; JSON columns store complex types (arrays, objects).
- **`db/builtin-agents.ts`** — Three built-in agent definitions (claude-code, codex, aider) with Docker images, commands, template args, and capability flags.
- **`scheduler/index.ts`** — Docker container orchestration via Dockerode. Claims queued tasks, starts worker containers with `AutoRemove`, checks heartbeat staleness, recovers dangling tasks on startup.
- **`scheduler/logic.ts`** — Pure functions for scheduling decisions (dependency checks, recovery strategy, stale detection). Has unit tests.
- **`auth/`** — Three-mode auth system (see below).
- **`secrets/`** — AES-256-GCM encrypted secret storage with scope resolution (agent+repo > agent > repo > global).
- **`sse/manager.ts`** — SSE client pool management and event broadcast. Events also persist to `system_events` table.
- **`i18n/messages.ts` + `ui-messages.ts`** — Centralized Chinese message strings for API responses and UI labels.
- **`validation/`** — Request body validators for tasks, templates, and users.

### Authentication system (`apps/web/src/lib/auth/`)

Three mutually exclusive modes auto-detected at runtime by `config.ts`:

| Mode | Trigger | Behavior |
|------|---------|----------|
| `user_system` | `users` table has records | Full RBAC: password/OAuth login, sessions, API tokens |
| `legacy_token` | `CAM_AUTH_TOKEN` env set | Simple Bearer token check (backward compat) |
| `none` | Neither above | Open access, virtual admin user injected |

- **`with-auth.ts`** wraps API route handlers: `export const GET = withAuth(handler, 'task:read')`.
- **`permissions.ts`** defines RBAC matrix: `admin` (full), `developer` (no user mgmt), `viewer` (read-only).
- **`session.ts`** manages httpOnly cookie `cam_session` backed by SQLite `sessions` table.
- **`password.ts`** uses Node.js scrypt for hashing. **`oauth/`** supports GitHub and GitLab OAuth flows.

### Frontend architecture

- **State**: Zustand stores in `apps/web/src/stores/index.ts` — separate stores for tasks, agents, workers, repos, events, templates.
- **Real-time**: `SSEProvider` connects to `/api/events/stream`, parses events, updates Zustand stores.
- **Auth**: `AuthProvider` loads current user via `/api/auth/me`, gates UI by role.
- **UI components**: shadcn/ui pattern (Radix UI primitives + Tailwind CSS + `class-variance-authority`) in `src/components/ui/`. `DataTable` wraps TanStack Table with sort/search/select/expand.
- **Icons**: Lucide React.

### Worker execution flow (`apps/worker/src/`)

Two modes: **task** (single task, container auto-removes) and **daemon** (persistent, polls for work).

`index.ts` (register + poll) → `executor.ts` (render template args, spawn agent CLI, stream logs, heartbeat) → `git-ops.ts` (clone, branch, commit, push via `simple-git`). `api-client.ts` wraps all HTTP calls to the web API.

Agent commands use template variables: `{{prompt}}`, `{{workDir}}`, `{{baseBranch}}`, `{{repoUrl}}`.

## Coding Conventions

- TypeScript strict mode. Target ES2022.
- 2-space indent, single quotes, semicolons.
- Web app imports use `@/…` alias (`@/*` → `apps/web/src/*`).
- React components: `PascalCase.tsx`. Hooks: `useX.ts`. Other files: lowercase kebab-case.
- Database columns: `snake_case`. JS variables: `camelCase`. Types/interfaces: `PascalCase`.
- Conventional Commits: `feat(web): …`, `fix(worker): …`, `refactor(shared): …`.
- API responses use envelope: `{ success, data?, error?: { code, message } }`.
- All user-facing strings (API messages, UI labels) go through `lib/i18n/` message files (Chinese).
- DB schema changes must include a Drizzle migration file in `apps/web/drizzle/`.

## Key Environment Variables

- `DATABASE_PATH` — SQLite DB location (default: `apps/web/data/cam.db`)
- `DOCKER_SOCKET_PATH` — Docker socket (default: `/var/run/docker.sock`)
- `API_SERVER_URL` — Worker→API endpoint (default: `http://localhost:3000`)
- `CAM_AUTH_TOKEN` — Legacy Bearer token for API auth (triggers `legacy_token` mode)
- `CAM_MASTER_KEY` — Master key for AES-256-GCM secret encryption
- `CAM_SESSION_TTL_HOURS` — Session expiry (default: 24)
- `CAM_RATE_LIMIT_ENABLED` / `CAM_RATE_LIMIT_WINDOW_MS` / `CAM_RATE_LIMIT_MAX_REQUESTS` — Rate limiting
- `GITHUB_TOKEN` — GitHub PAT for private repos and auto-PR creation
- `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` — GitHub OAuth (optional)
- `WORKER_ID` / `TASK_ID` / `SUPPORTED_AGENTS` — Injected into worker containers by scheduler
