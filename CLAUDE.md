@AGENTS.md

# shift-app

A shift-scheduling web app for a small (~10-person) Japanese retail store. Staff
submit shift requests for a month; an admin assigns and confirms the final
schedule in a matrix editor; everyone views the confirmed result. The UI is in
Japanese.

## Tech stack

- **Next.js 16.2.4** (App Router) — see `AGENTS.md`: this version differs from
  older Next.js; read `node_modules/next/dist/docs/` before relying on training-era APIs.
- **React 19.2.4**
- **TypeScript 5** (strict mode, `@/*` path alias → repo root)
- **Tailwind CSS v4** (via `@tailwindcss/postcss`; no `tailwind.config` file — config lives in `app/globals.css`)
- **Supabase** (`@supabase/supabase-js`) — Postgres backend
- **japanese-holidays** — Japanese public-holiday lookup
- **ESLint 9** (flat config, `eslint-config-next` core-web-vitals + typescript)

## Commands

```bash
npm run dev      # start dev server at http://localhost:3000
npm run build    # production build
npm run start    # serve the production build
npm run lint     # eslint
```

There is **no test suite** and no CI configured. Validate changes with
`npm run lint` and `npm run build`.

## Environment

Copy `.env.example` → `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

`lib/supabase.ts` throws at import time if either is missing.

## Project structure

```
app/
  page.tsx                       Home: staff picker (LoginForm) + admin menu links
  LoginForm.tsx                  Client: pick staff → /request?staff=<id>
  layout.tsx                     Root layout, <html lang="ja">, Geist fonts, metadata
  globals.css                    Tailwind v4 entry + theme
  request/                       Staff: submit shift requests for a month
    page.tsx · RequestEditor.tsx · actions.ts
  view/                          Everyone: read-only confirmed schedule
    page.tsx · ViewSwitcher.tsx
  admin/
    staff/                       Admin: staff roster CRUD
    settings/                    Admin: shift frames + required headcounts
    edit/                        Admin: the core shift-assignment matrix
lib/
  supabase.ts                    Singleton Supabase client typed with Database
  calendar.ts                    UTC-based month/calendar math, day-category mapping
  holidays.ts                    Cached Japanese-holiday maps per month
types/
  database.ts                    Hand-written types mirroring the SQL schema
  japanese-holidays.d.ts         Ambient types for the untyped package
supabase/
  migrations/0001_initial_schema.sql
```

## Architecture & conventions

**Server Components fetch, Client Components interact.** Each route's `page.tsx`
is an async Server Component that reads from Supabase and passes plain data to a
sibling Client Component (`"use client"`, e.g. `EditMatrix`, `ViewSwitcher`,
`RequestEditor`) for interactivity.

**Mutations go through Server Actions.** Every route that writes has an
`actions.ts` marked `"use server"`. Conventions to follow:
- Return a discriminated `ActionResult = { ok: true } | { ok: false; error: string }` — never throw to the client.
- Validate inputs at the top of the action (IDs present, `ISO_RE`/`TIME_RE` formats, year 2000–2100, month 1–12, counts ≥ 0). Validation messages are user-facing Japanese strings.
- After a successful write, call `revalidatePath(...)` for **every** affected route (e.g. `setAssignment` revalidates both `/admin/edit` and `/view`).

**Dynamic routes.** Pages that read mutable data set
`export const dynamic = "force-dynamic"`. `searchParams` is a **Promise** (Next
16) and must be `await`ed; parse/validate it with helpers like
`parseYearMonth`.

**Data fetching.** Batch independent Supabase queries with `Promise.all`. Render
per-query `error` blocks inline rather than throwing. Order roster/frame queries
by `display_order` then `name`.

**Dates are UTC and string-based.** Use `lib/calendar.ts` helpers
(`isoDate`, `lastDay`, `weekdayOf`, `buildMonthGrid`, `shiftMonth`) — they
compute in UTC to avoid timezone drift. Dates are stored/compared as
`YYYY-MM-DD` strings; range queries use `.gte("date", start).lte("date", end)`.

**Styling** is Tailwind utility classes inline. There is no component library;
match the existing class patterns (e.g. primary action button is
`bg-blue-900 text-white … rounded`).

## Data model

Defined in `supabase/migrations/0001_initial_schema.sql`; the TypeScript mirror
lives in `types/database.ts`. **When you change the migration, update
`types/database.ts` to match** (the file header says so).

- **`staff`** — roster. `role` ∈ `admin` | `staff`, `display_order`, `password_hash` (nullable, unused in MVP).
- **`shift_frames`** — shift slots (e.g. 早番/遅番). `start_time`/`end_time` (`HH:mm`), `color`, `display_order`.
- **`required_counts`** — needed headcount per `(shift_frame_id, day_category)`. Unique on that pair.
- **`shift_requests`** — staff's requested shifts. Unique on `(staff_id, date, shift_frame_id)`.
- **`shift_assignments`** — the actual schedule. `shift_frame_id = NULL` means a day off (休み). `status` ∈ `draft` | `confirmed`. Unique on `(staff_id, date)`.

`day_category` is `weekday | friday | saturday | sunday_holiday`, derived by
`dayCategoryFromWeekday`: Mon–Thu = weekday, Fri = friday, Sat = saturday, Sun
**or any public holiday** = sunday_holiday (holiday takes priority when it falls
on Fri/Sat). `updated_at` is maintained by a Postgres trigger.

### Important: no auth / RLS disabled

This is an MVP with **no authentication** — RLS is explicitly disabled on all
tables and the app talks to Supabase with the public anon key (including from
Server Actions). Access control is "share the URL with insiders only." Do not
assume requests are authorized at the DB layer. Re-enabling RLS + adding auth is
planned for a future version; if you add auth, revisit the migration's
`disable row level security` statements.

## Key user flows

1. **Staff submit requests** — Home → pick name → `/request?staff=<id>`. `saveRequests` deletes the staff's existing requests for the month and re-inserts the new set (full replace). Default month is **next month**.
2. **Admin sets up** — `/admin/staff` (roster), `/admin/settings` (shift frames + `required_counts` matrix).
3. **Admin builds the schedule** — `/admin/edit` matrix (staff × days). `setAssignment` upserts one cell as a frame / rest (休み) / clear; `confirmMonth` flips the whole month's rows to `confirmed`.
4. **Everyone views** — `/view` shows only `status = confirmed` assignments; default month is **this month**, optional `?staff=<id>` highlight.

## Gotchas

- The spec referenced in code comments (`shift-app-spec.md`, "仕様書") is **not in the repo** — treat those comments as the source of truth for intent.
- `parseYearMonth` (request) defaults to next month; `parseViewMonth` (view) defaults to this month — don't unify them.
- Comments and all user-facing strings are Japanese; keep new UI text Japanese and consistent in tone.
