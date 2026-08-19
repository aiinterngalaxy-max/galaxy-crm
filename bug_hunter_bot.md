# bug_hunter_bot — bot report

_Generated 2026-07-14 · galaxy-crm (Vite + React + TS + Firebase + Vercel) · 9 findings_

| 🔴 Crit | 🟠 High | 🟡 Med | 🔵 Low | ⚪ Info | ✅ Pass |
|---|---|---|---|---|---|
| 0 | 2 | 2 | 2 | 1 | 2 |

**Stack / tooling used:** Node + `npx tsc --noEmit` (clean), `npm run build` (vite, clean), `npm test` (vitest, 162 passed), `npm run lint` (eslint 8 — fails), static read of `src/`, `api/`, `firestore.rules`, `dist/` bundle grep. No live Firebase/Vercel access — findings that depend on deployed state are flagged as such.

---

## 🟠 `HUNT-RULES-GAP` Firestore rules omit 4 collections the app uses → soft-delete breaks app-wide, HR / Non-Working / Recycle-Bin fully broken
- **Severity**: HIGH (verges on CRITICAL for the delete flow)  ·  **Area**: security-rules / data  ·  **Where**: `firestore.rules` (whole file — collections absent), `src/lib/trash.ts:47`, `src/modules/hr/HRPage.tsx:97,109`, `src/modules/inventory/NonWorkingPage.tsx:103,302`, `src/modules/recycle-bin/RecycleBin.tsx:36`
- **Evidence**: The code reads/writes four collections that have **no `match` block** in `firestore.rules`, and Firestore denies by default:
  - `grep -c` in `firestore.rules` → `candidates: 0`, `jobDescriptions: 0`, `nonWorkingInventory: 0`, `deletedItems: 0` (vs `stockTransactions: 1`, which is covered).
  - `src/lib/trash.ts:47` `trashItem()` does `await addDoc(collection(db, 'deletedItems'), …)` **before** `deleteDoc(ref)` on line 57. `trashItem` is the delete path for Leads, Customers, Projects, Quotations, Partners, Inventory and Non-Working (imported in `LeadsPage.tsx:13` → `handleDelete` line 117-120 `trashItem('leads', …)`, and 8 other modules). Because the `deletedItems` write is denied, `addDoc` rejects, `deleteDoc` never runs, and **every "Delete" button across the CRM fails with permission-denied and leaves the record undeleted.**
  - HR module reads `jobDescriptions`/`candidates` (`HRPage.tsx:97,109`, writes in `JDWizard.tsx:135`, `ResumeScorer.tsx:222`) → all denied → HR page shows permission errors / empty.
  - Non-Working inventory (`NonWorkingPage.tsx`) and Recycle Bin (`RecycleBin.tsx` reads `deletedItems`, `restoreItem`/`permanentDelete` in `trash.ts`) are fully non-functional.
- **Fix**: Add `match` blocks in `firestore.rules` for `deletedItems`, `candidates`, `jobDescriptions`, `nonWorkingInventory` with role gating consistent with the sibling collections (e.g. `deletedItems`: create/read/delete for the non-marketing/non-pending roles that can delete source docs; HR collections gated to the `hr` role + `fullAccess`). Then redeploy rules (`firebase deploy --only firestore:rules`).
- **Caveat / verify**: Confirmed against the committed `firestore.rules`. If the *deployed* rules differ from this file, re-verify against the live project before/after the fix.

## 🟠 `HUNT-SECRET-TURSO` Turso database auth token is inlined into the public client bundle
- **Severity**: HIGH  ·  **Area**: secrets / security  ·  **Where**: `src/lib/content-studio/db.ts:14-19`, built into `dist/assets/queries-*.js`
- **Evidence**: `db.ts:15` reads `import.meta.env.VITE_TURSO_AUTH_TOKEN` (static access → Vite inlines the literal value at build time) and passes it to `createClient({ url, authToken })`, i.e. the browser talks to Turso **directly** with the token. `.env.local` has `VITE_TURSO_AUTH_TOKEN=<set>`. Bundle grep confirms exposure: `dist/assets/queries-_8MwcPh5.js` contains `turso.io`, and `grep -roE 'eyJ…' dist | wc -l → 5` JWT-shaped tokens are present in the shipped assets. Anyone who opens the deployed site's JS can extract the token and gain full read/write/DROP access to the Content-Studio Turso DB.
- **Contrast (right way, already in repo)**: the newer Topz endpoints use a **server-side** token — `api/lib/turso.ts:1-2` reads `process.env.TURSO_URL` / `process.env.TURSO_TOKEN` (never shipped to the client). The Content-Studio path should do the same.
- **Fix**: Route Content-Studio DB access through a serverless function (reuse `api/lib/turso.ts`) using non-`VITE_` server env vars; remove `VITE_TURSO_AUTH_TOKEN` from the client. Rotate the current Turso token, since it has been distributed to every visitor. (Same class applies to `VITE_FB_ACCESS_TOKEN` / `VITE_IG_ACCESS_TOKEN` / `VITE_YT_API_KEY` read in `src/lib/content-studio/integrations/*.ts` — these are also client-side secrets; FB/IG page/user tokens are rotate-worthy, the YT key is restrictable.)

## 🟡 `HUNT-SECRET-GROQ` LLM API key referenced client-side — feature is either broken (unset) or leaks the key (if set)
- **Severity**: MEDIUM  ·  **Area**: secrets / reliability  ·  **Where**: `src/lib/ai.ts:1,8,15`, `src/modules/chatbot/CRMChatbot.tsx:125,154`
- **Evidence**: `ai.ts` reads `import.meta.env.VITE_GROQ_API_KEY` and `fetch('https://api.groq.com/openai/v1/chat/completions', …)` directly from the browser. `ai.ts` is reachable from the built HR bundle (`grep -rl groq dist` → `dist/assets/downloadJD-*.js`). `.env.local` does **not** set `VITE_GROQ_API_KEY` (only `VITE_ANTHROPIC_API_KEY`, which is set but never referenced in `src`/`api` — dead). So today the AI helpers throw `"VITE_GROQ_API_KEY is not set"` at runtime; and if the key is ever added, it gets inlined into the public bundle exactly like the Turso token above.
- **Fix**: Move Groq/LLM calls behind a serverless function with a server-side `GROQ_API_KEY`. Either wire up the key server-side or remove the dead `VITE_ANTHROPIC_API_KEY`. Note `CRMChatbot.tsx` is **not routed** in `App.tsx` (dead code — see Info finding).

## 🟡 `HUNT-ENV-DRIFT` `.env.example` is stale — missing many required vars, including server-only ones the Topz APIs need to run
- **Severity**: MEDIUM  ·  **Area**: config / deploy  ·  **Where**: `.env.example` vs actual usage in `src/` + `api/`
- **Evidence**: Vars referenced in code but absent from `.env.example`: `VITE_GROQ_API_KEY`, `VITE_TOPZ_API_KEY/AUTH_DOMAIN/PROJECT_ID/STORAGE_BUCKET/MESSAGING_SENDER_ID/APP_ID` (a second Firebase project), `VITE_CLOUDINARY_CLOUD_NAME/UPLOAD_PRESET`, `VITE_MAPPLS_KEY`, and the **server-side** `TURSO_URL` / `TURSO_TOKEN` (`api/lib/turso.ts:1-2`, `api/topz-*.ts`). If `TURSO_URL`/`TURSO_TOKEN` are not set as Vercel project env vars, `/api/topz-quotations` and `/api/topz-bookings` (called from `src/modules/topz/data/storage.ts:1-2`) 500 on every request; if `VITE_MAPPLS_KEY` is unset, `api/distance.ts` returns errors. Conversely `.env.example` still lists `VITE_ANTHROPIC_API_KEY` which is unused.
- **Fix**: Regenerate `.env.example` from actual usage; clearly separate client (`VITE_`) vs server (Vercel-only) vars; document that `TURSO_URL`/`TURSO_TOKEN`/`VITE_MAPPLS_KEY` must be set in Vercel.

## 🔵 `HUNT-API-DUP` Duplicate/dead serverless routes under `api/topz/` (with a latent NOT-NULL insert bug)
- **Severity**: LOW  ·  **Area**: api / dead-code  ·  **Where**: `api/topz/bookings.ts`, `api/topz/quotations.ts` (unused) vs `api/topz-bookings.ts`, `api/topz-quotations.ts` (used)
- **Evidence**: The frontend only calls the flat routes: `src/modules/topz/data/storage.ts:1-2` → `'/api/topz-quotations'`, `'/api/topz-bookings'`. The nested `api/topz/bookings.ts` and `api/topz/quotations.ts` are functionally identical duplicates that nothing references — they still deploy as extra Vercel functions. They also carry a latent bug the flat (used) versions don't: `api/topz/bookings.ts:39` inserts `b.clientName` with no `?? ''` default into a `clientName TEXT NOT NULL` column (`api/lib/turso.ts:89`), so a POST lacking `clientName` would throw a constraint error (500). The live flat version (`api/topz-bookings.ts:64`) correctly uses `b.clientName ?? ''`.
- **Fix**: Delete `api/topz/bookings.ts`, `api/topz/quotations.ts` (and `api/lib/turso.ts` if the nested ones were its only consumers), or converge the frontend onto them and delete the flat pair. Keep one implementation.

## 🔵 `HUNT-API-DISTANCE` `api/distance.ts` reads a `VITE_`-prefixed secret server-side and echoes raw upstream errors
- **Severity**: LOW  ·  **Area**: api / config  ·  **Where**: `api/distance.ts:7,46`
- **Evidence**: `const key = process.env.VITE_MAPPLS_KEY` — using a `VITE_` prefix for a **server-side** secret is a footgun: it only works because Vercel injects all env vars into the runtime, but the `VITE_` prefix means it would be bundled to the client if ever imported in `src/`. Also `catch (e:any) → JSON.stringify({ error: e.message })` returns upstream Mappls/OSRM error text to the caller (minor info leak). If `VITE_MAPPLS_KEY` is unset the Mappls URL becomes `…/v1//distance_matrix/…` and silently falls back to OSRM.
- **Fix**: Rename to `MAPPLS_KEY` (non-`VITE_`); return a generic error message and log details server-side.

## ⚪ `HUNT-LINT-DEAD` `npm run lint` fails (199 errors) and is not CI-gated; unrouted/dead code present
- **Severity**: INFO  ·  **Area**: quality / tooling  ·  **Where**: `.eslintrc.cjs`, `.github/workflows/ci.yml`, `src/modules/chatbot/CRMChatbot.tsx`
- **Evidence**: `npm run lint` → `✖ 273 problems (199 errors, 74 warnings)`, exit 1 (mostly `@typescript-eslint/no-explicit-any` and unused vars; one real `no-useless-escape` at `QuotationTool.tsx:146`). CI (`ci.yml`) runs only `tsc`, `test`, `build` — never `lint` — so these never block a merge, but the `lint` script as written (`--max-warnings 0`) can never pass. `CRMChatbot.tsx` is imported by nothing routed (`grep CRMChatbot src/App.tsx` → none) → dead code that still references the exposed Groq key.
- **Fix**: Either wire `lint` into CI and drive errors to zero, relax `no-explicit-any`/`--max-warnings`, or remove it from the workflow expectation. Delete `CRMChatbot.tsx` if abandoned.

## ✅ `HUNT-BUILD-OK` Type-check and production build are clean
- **Severity**: PASS  ·  **Area**: build  ·  **Where**: `npx tsc --noEmit`, `npm run build`
- **Evidence**: `tsc --noEmit` exit 0 (note: `tsconfig.json` `include: ["src"]` — the `api/` folder is **not** type-checked by this pass; Vercel builds it separately). `npm run build` → `✓ built in ~10.5s`, exit 0 (one non-blocking chunk-size warning: `index-*.js` 1.25 MB, `HRPage-*.js` 514 kB).

## ✅ `HUNT-TESTS-OK` Unit tests pass
- **Severity**: PASS  ·  **Area**: tests  ·  **Where**: `npm test` (vitest)
- **Evidence**: `Test Files 6 passed (6)`, `Tests 162 passed (162)`.

---

### False positives ruled out
- **`recycle-bin` / `hr` route access:** `recycle-bin` is absent from `MODULE_ACCESS` in `src/lib/utils.ts:148-166`, but `canAccess` returns `true` early for `super_admin/management/ai_team` (fullAccess, line 145-146) — so admin-only access is intentional, not a bug. `hr:['hr']` references a valid `hr` role (tsc passes), also intentional.
- **Firebase web API key in bundle:** `VITE_FIREBASE_API_KEY` in the client is public-by-design; security rests on `firestore.rules` (reviewed) — not reported as a leak.
- **Lint `no-explicit-any` errors:** style-only, do not affect runtime or the (tsc-based) build — reported as INFO, not as product bugs.
- **`.env.local` committed?** No — `git ls-files | grep .env` returns only `.env.example`; `.env.local`/`.env` are correctly gitignored.

### Not covered / needs owner input
- **Deployed Firestore rules** could not be checked against the live project — `HUNT-RULES-GAP` is verified against the committed file only. Confirm live rules before deploying a fix.
- **Vercel env vars** (`TURSO_URL`, `TURSO_TOKEN`, `VITE_MAPPLS_KEY`, `VITE_GROQ_API_KEY`) are set in the Vercel dashboard, not the repo — their presence/absence (and thus whether the Topz APIs and AI features actually work in prod) needs owner confirmation.
- **Whether the Turso token exposure is an accepted tradeoff** vs. a to-fix — the architecture currently ships it client-side deliberately; owner should decide on the server-proxy migration + token rotation.
