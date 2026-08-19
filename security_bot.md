# security_bot — bot report

_Generated 2026-07-14 · 14 findings_

| 🔴 Crit | 🟠 High | 🟡 Med | 🔵 Low | ⚪ Info | ✅ Pass |
|---|---|---|---|---|---|
| 2 | 2 | 3 | 2 | 2 | 3 |

Scope: galaxy-crm (Vite + React + TS · Firebase/Firestore · Vercel serverless `api/` · Turso/libSQL). Authorized, read-only review of this repo only. The stale `security_bot.md`/`bug_hunter_bot.md` describe a different project ("Galaxy Trading") and were ignored except for format.

---

## 🔴 `SEC-SECRET-001` Read-write Turso DB token and live Instagram/Facebook access tokens shipped in the client bundle
- **Severity**: CRITICAL  ·  **Area**: security  ·  **Where**: `src/lib/content-studio/db.ts:14-15`, `.env.local:11,17,20`, `dist/assets/queries-_8MwcPh5.js`
- **Evidence**: `content-studio/db.ts` builds a libSQL client in the browser from `import.meta.env.VITE_TURSO_AUTH_TOKEN`. Because the var is `VITE_`-prefixed, Vite inlines it into the shipped bundle. Confirmed present on disk: `grep -rl "eyJhbGciOiJFZERTQS..." dist/` → `dist/assets/queries-_8MwcPh5.js`. Decoding the token payload gives `{"a":"rw",...}` — full **read-write** to the Turso DB (shared with `galaxy-cmo-dashboard` per the `.env.example` comment). The same bundle also contains the long-lived Meta Graph tokens `VITE_IG_ACCESS_TOKEN` / `VITE_FB_ACCESS_TOKEN` (`grep -rl "EAAfY8qjWhzw" dist/` → same file), plus `VITE_YT_API_KEY`.
- **Impact**: Any visitor to the deployed site can extract these from JavaScript in seconds. The Turso token allows arbitrary read/write/drop of the shared content DB; the Meta tokens allow reading/posting as the business's Instagram/Facebook accounts. This is a live credential-exposure emergency — anything `VITE_`-prefixed is public.
- **Fix**: Treat all four as compromised and **rotate immediately** (Turso token, IG token, FB token, YT key). Never hold a secret credential in a `VITE_` var. Move Turso/social access behind a server-side Vercel function (like the existing `api/lib/turso.ts`, which correctly uses the non-`VITE_` `TURSO_TOKEN`) and have the browser call that function instead of talking to Turso directly. Issue a read-only or least-privilege Turso token for anything that must remain server-side.

## 🔴 `SEC-STORAGE-001` Firebase Storage rules grant every authenticated user full read/write to all files
- **Severity**: CRITICAL  ·  **Area**: security  ·  **Where**: `storage.rules:4-6`, `src/lib/firebase.ts:52-55`
- **Evidence**: `match /{allPaths=**} { allow read, write: if request.auth != null }` — a single global rule with no per-user, per-role, or path scoping. Combined with `firebase.ts:53` `googleProvider.setCustomParameters({ hd: '' })` (comment: "allow all domains") and the Firestore first-login flow (`firestore.rules:30`, users self-create with `role=pending`), **any** Google account can authenticate and immediately read, overwrite, or delete every object in the bucket — lead documents, site reports, uploaded floor plans, customer files.
- **Impact**: Effectively public read/write to all uploaded business/customer files by anyone willing to click "Sign in with Google". No role gate applies (even `pending` users pass `request.auth != null`).
- **Fix**: Scope storage rules by path and role, mirroring `firestore.rules`. At minimum deny `pending` users, restrict writes to owning roles, and namespace paths (e.g. `/leads/{leadId}/...`) with ownership checks. Do not rely on a bare `request.auth != null`.

## 🟠 `SEC-AUTHZ-001` Topz serverless endpoints expose full unauthenticated CRUD over customer data
- **Severity**: HIGH  ·  **Area**: security  ·  **Where**: `api/topz-bookings.ts:45-74`, `api/topz-quotations.ts:45-79` (and duplicates `api/topz/bookings.ts`, `api/topz/quotations.ts`), consumed by `src/modules/topz/data/storage.ts:1-2`
- **Evidence**: None of the handlers check any auth token, session, or API key. `GET` returns all rows; `POST` upserts; `PUT` mutates status; `DELETE` removes by id. `Access-Control-Allow-Origin` is set to `*`. So `curl https://<site>/api/topz-bookings` returns every booking (clientName, clientPhone, amounts, supplier), and `curl -X DELETE '.../api/topz-bookings?id=...'` deletes records — no credentials required.
- **Impact**: Anyone on the internet can enumerate customer PII (names, phone numbers, emails from quotations), tamper with amounts/status, or wipe the bookings/quotations tables. The `*` CORS makes it trivially callable from any origin.
- **Fix**: Require authentication on these functions (verify a Firebase ID token via the Admin SDK, or a shared server secret) before any DB access; authorize by role. Remove the duplicate flat vs. nested handler pair to avoid one being forgotten. Restrict CORS to the app origins listed in `cors.json`.

## 🟠 `SEC-DEPS-001` Dependency audit: 1 critical + 7 high advisories
- **Severity**: HIGH  ·  **Area**: security  ·  **Where**: `package.json` (`jspdf`, `vite`, `@vercel/node`), `package-lock.json`
- **Evidence**: `npm audit --json` → `{"moderate":15,"high":7,"critical":1,"total":23}`. Critical: **jspdf** (ReDoS, DoS, Local File Inclusion) — and `jspdf` is a direct, actually-used dependency (PDF generation). High: `vite` (path traversal in optimized deps `.map` handling; dev-server only), `path-to-regexp`, `minimatch`, `undici`, `@vercel/node`/`@vercel/build-utils`/`@vercel/python-analysis` (build/deploy-time). Moderate: `dompurify` XSS, `esbuild` dev-server, firebase→undici chain.
- **Impact**: The jspdf LFI/ReDoS is reachable at runtime through the app's PDF export of user-controlled quotation/report data. Most high items are build/dev-time (lower real exposure) but should still be patched.
- **Fix**: Upgrade `jspdf` to a patched release (priority). Run `npm audit fix`; review `vite`/`@vercel/node` majors before forcing. Re-audit after upgrade. (Do not run `--force` without confirming breaking changes.)

## 🟡 `SEC-AUTH-002` Google sign-in accepts any Google account (no domain restriction)
- **Severity**: MEDIUM  ·  **Area**: security  ·  **Where**: `src/lib/firebase.ts:52-53`
- **Evidence**: `googleProvider.setCustomParameters({ hd: '' })` with inline comment "allow all domains; restrict to company domain in production". Any Gmail user can complete sign-in and create a `users/{uid}` doc with `role=pending`.
- **Impact**: The self-service auth surface is open to the world. On its own a `pending` account is low-privileged in Firestore, but it becomes the entry key that unlocks `SEC-STORAGE-001` (all-files read/write) and any rule that only checks `isNotPending()`/`isAuth()`.
- **Fix**: Enforce the company domain (`hd: 'galaxy...'` and validate `email` domain server-side / in rules), and/or gate first login behind management approval before any data-touching role is granted. Verify the Firebase Console has domain-restricted sign-in too.

## 🟡 `SEC-CORS-001` Wildcard CORS on all serverless endpoints
- **Severity**: MEDIUM  ·  **Area**: security  ·  **Where**: `api/topz-bookings.ts:46`, `api/topz-quotations.ts:46`, `api/topz/bookings.ts:5`, `api/topz/quotations.ts:6`, `api/distance.ts:11`
- **Evidence**: Every handler sets `Access-Control-Allow-Origin: *`. `cors.json` (intended for the Firebase Storage bucket) correctly lists only `localhost:5173` and the Vercel origin, but the serverless functions ignore it.
- **Impact**: Any website can invoke these APIs from a victim's browser. Amplifies `SEC-AUTHZ-001` (no auth + any origin). No credentials are cookie-based here, so it's not credential-reflection, but combined with missing auth it broadens abuse.
- **Fix**: Reflect only allow-listed origins (reuse the `cors.json` list) instead of `*`.

## 🟡 `SEC-HDR-001` No security response headers configured on the deployment
- **Severity**: MEDIUM  ·  **Area**: security  ·  **Where**: `vercel.json:1-5`
- **Evidence**: `vercel.json` contains only a SPA rewrite; there is no `headers` block. No `X-Content-Type-Options`, `X-Frame-Options`/CSP `frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`, or `Strict-Transport-Security` is set for the app or API responses.
- **Impact**: The SPA is embeddable in an iframe (clickjacking), MIME-sniffing is not disabled, and there is no CSP to constrain injected script — a meaningful defense-in-depth gap for an app that renders user/customer data.
- **Fix**: Add a `headers` array in `vercel.json` setting `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and `Strict-Transport-Security` on TLS.

## 🔵 `SEC-INFO-001` Serverless errors leak upstream response text to clients
- **Severity**: LOW  ·  **Area**: security  ·  **Where**: `api/distance.ts:31,46`
- **Evidence**: On failure the handler returns `JSON.stringify({ error: e.message })` with 500, where `e.message` can include a slice of raw upstream provider output (`Distance API error: ${text.slice(0,200)}`) or internal error strings.
- **Impact**: Minor information disclosure — upstream API internals / partial responses surface to the caller. Low risk (no secrets, fixed hosts) but noisy.
- **Fix**: Return a generic client-facing message and log details server-side only.

## 🔵 `SEC-FS-001` Firestore notifications/meta are writable by any non-pending user (spoofing / counter tampering)
- **Severity**: LOW  ·  **Area**: security  ·  **Where**: `firestore.rules:48-50,175-179`
- **Evidence**: `match /notifications/{notifId}` allows `create: if isAuth() && isNotPending()` with no constraint that `senderId`/`recipientId` be honest — a user can create a notification addressed to any `recipientId`. `match /meta/{docId}` allows `read, write: if isAuth() && isNotPending()`, so any non-pending user can overwrite the shared code-generation counters (leads/quotations/projects).
- **Impact**: Forged/phishing in-app notifications to arbitrary users; and counter manipulation could cause duplicate or skipped GHA-* codes (data-integrity, not disclosure).
- **Fix**: For notifications, constrain `create` so the sender identity is server-verified and recipients are valid. For `meta`, restrict writes to a transaction pattern or to privileged roles, or move counter allocation server-side.

## ⚪ `SEC-SECRET-002` Firebase Web API key committed in `.env.local` — public by design, so low risk
- **Severity**: INFO  ·  **Area**: security  ·  **Where**: `.env.local:1-6`, `src/lib/firebase.ts:33-40`
- **Evidence**: `VITE_FIREBASE_API_KEY=AIzaSy...` and project identifiers are present in `.env.local` and inlined into the bundle. `.env.local` is correctly gitignored (`git log --all -- .env.local` → empty; never committed).
- **Impact**: A Firebase Web `apiKey` is an identifier, not a secret — its exposure is expected. Security depends entirely on `firestore.rules` / `storage.rules`, which is where the real gaps are (see SEC-STORAGE-001). No action needed on the key itself.
- **Fix**: None for the key. Ensure the API key is restricted (HTTP referrer / API restrictions) in the Google Cloud console, and keep enforcing access via rules.

## ⚪ `SEC-SECRET-003` `.env.local` holds real server secrets on disk but is correctly gitignored
- **Severity**: INFO  ·  **Area**: security  ·  **Where**: `.env.local:11,17,20,29`, `.gitignore:11-13`
- **Evidence**: `.env.local` contains a live Turso `rw` token, Meta tokens, and a `TELEGRAM_BOT_TOKEN`. `.gitignore` lists `.env.local` and `git log --all -- .env.local` confirms it was never committed; `dist/` is also gitignored and untracked. So these are not leaked via the public GitHub repo (`aiinterngalaxy-max/galaxy-crm`, confirmed public, HTTP 200).
- **Impact**: No git leak. However the `VITE_`-prefixed subset still leaks via the deployed bundle (that is SEC-SECRET-001, separate). `TELEGRAM_BOT_TOKEN` is non-`VITE_` and used only by `scripts/watchdog.mjs` server-side — not bundled, not exposed.
- **Fix**: Keep `.env.local` out of git (already the case). Rotate the `VITE_`-exposed tokens per SEC-SECRET-001; the Telegram token needs rotation only if it ever appears in a commit or the bundle.

## ✅ `SEC-INJ-001` Turso SQL access is parameterized
- **Severity**: PASS  ·  **Area**: security  ·  **Where**: `api/lib/turso.ts:25-56`, `api/topz-bookings.ts:60-64`, `api/topz-quotations.ts:60-64`
- **Evidence**: All queries use `?` placeholders with typed args (`toArg`/`arg`); no string concatenation of user input into SQL. Injection is not exploitable via these endpoints (the authz gap in SEC-AUTHZ-001 is separate).

## ✅ `SEC-MASSASSIGN-001` Firestore blocks privilege fields on user self-update
- **Severity**: PASS  ·  **Area**: security  ·  **Where**: `firestore.rules:34-42`
- **Evidence**: Self-update rejects any diff touching `role`, `isActive`, or `department`; only `isManagement()` can change them. A normal user cannot elevate their own role via mass assignment.

## ✅ `SEC-SSRF-001` distance.ts fetches fixed hosts only
- **Severity**: PASS  ·  **Area**: security  ·  **Where**: `api/distance.ts:14-42`
- **Evidence**: User input (`from`/`to`) is used only as query text against hardcoded hosts (nominatim.openstreetmap.org, apis.mappls.com, router.project-osrm.org). No user-controlled URL/host reaches `fetch`, so this is not an SSRF sink.

---

**False positives ruled out**: Firebase Web API key is not treated as a secret (SEC-SECRET-002, public by design). `.env.local` is not a git leak (never committed; SEC-SECRET-003). `distance.ts` is not SSRF (fixed hosts). Turso endpoints are not SQL-injectable (parameterized).

**Needs owner decision (rotation / prod)**: Rotate the exposed Turso `rw` token and Meta IG/FB tokens and YT key (SEC-SECRET-001) — live-credential emergency. Tighten `storage.rules` and Google sign-in domain (SEC-STORAGE-001 / SEC-AUTH-002). These touch production auth/data and were NOT changed by this read-only review.

**Not covered**: Live/authenticated dynamic probing of the deployed Vercel + Firebase instance (review was static/local only — no requests sent to production). Firebase Console-side settings (API key restrictions, sign-in domain config) could not be inspected from the repo and should be verified there.
