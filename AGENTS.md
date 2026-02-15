# Repository Guidelines

## Project Structure & Module Organization
- `apps/web/`: Next.js 15 (App Router) web UI + API routes + scheduler. Key folders: `src/app/`, `src/components/`, `src/lib/` (DB, scheduler, SSE). Drizzle migrations live in `drizzle/`. Local SQLite data defaults to `data/cam.db` (when running in `apps/web/`).
- `apps/worker/`: Node + TypeScript worker (`src/` → `dist/`) that polls the web API and executes tasks.
- `packages/shared/`: Shared TypeScript package built with `tsup` (`src/` → `dist/`).
- `docker-compose.yml`: Single-node deploy (web + SQLite, mounts Docker socket). `docker-compose.dev.yml`: optional Postgres/Redis for development experiments.

## Build, Test, and Development Commands
- Prereqs: Node `>=20` and pnpm `>=9` (see root `package.json`).
- Install deps: `corepack enable` (optional) then `pnpm install`.
- Run all (Turbo): `pnpm dev`
- Run one app: `pnpm dev:web` or `pnpm dev:worker`
- Lint: `pnpm lint` (web uses `next lint`)
- Build: `pnpm build`
- Database (web / Drizzle + SQLite): `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:seed` (uses `DATABASE_PATH`; default is `apps/web/data/cam.db` when running `@cam/web`).
- GitHub (optional): set `GITHUB_TOKEN` on the web server to auto-create a PR when a task enters `awaiting_review`, and to allow private GitHub repo clone/push inside worker containers.
- Docker (standalone): `docker compose up --build` (see `docker-compose.yml`)
- Docker (dev infra): `docker compose -f docker-compose.dev.yml up` (Postgres/Redis)
- Windows: `start-dev.bat` (one-click SQLite dev startup)

## Coding Style & Naming Conventions
- TypeScript-first and strict (`tsconfig.base.json`).
- Match the existing style: 2-space indentation, single quotes, semicolons.
- Web imports: prefer the alias `@/…` (`@/*` → `apps/web/src/*`).
- Naming: React components `PascalCase.tsx`; hooks `useX.ts`; keep file names lowercase unless they export a component.

## Testing Guidelines
- A dedicated test runner is not wired up yet. Before opening a PR, run `pnpm lint` and `pnpm build`.
- When adding tests, use `*.test.ts(x)` (or `__tests__/`) and add a `test` script in the affected workspace package.

## Commit & Pull Request Guidelines
- The git history is currently minimal; use Conventional Commits (e.g. `feat(web): …`, `fix(worker): …`).
- PRs must include: what changed, how you verified it, and screenshots for UI changes. If you touch the DB, include migration notes under `apps/web/drizzle/`.
