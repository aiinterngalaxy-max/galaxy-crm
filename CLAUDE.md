# Galaxy CRM — contributor & review guide

React + Vite + TypeScript SPA on **Firebase** (Firestore, Auth, Storage), deployed on **Vercel**. Role-based CRM for Galaxy Home Automation.

## Commands
- `npm run typecheck` · `npm run lint` · `npm test` · `npm run build`
- CI (`.github/workflows/ci.yml`) runs typecheck + test + build on every PR.

## Deploy model — READ THIS
- **Vercel deploys the web app only.** Pushing to `main` ships the React app.
- **Firestore rules & indexes deploy separately**, via the Firebase CLI in Google Cloud Shell (authed as the project owner), NOT by Vercel:
  ```
  cd ~/galaxy-crm && git pull && firebase deploy --only firestore:rules
  ```
  A change to `firestore.rules` in a merged PR is **not live** until someone runs that. If you change rules, say so explicitly in the PR/hand-off.

## Review checklist (apply during code-review / security-review)

These are recurring, high-impact bug classes here. They live *between* files, are role- and runtime-dependent, and look fine in isolation — so check them deliberately.

### 1. Firestore rules ↔ code coverage
- Every collection read/written in code needs a `match` block in `firestore.rules`, or it's **denied for everyone**. A mechanical guard exists: `src/lib/__tests__/firestore-rules-coverage.test.ts` (runs in CI). Keep it passing; don't weaken it.
- Beyond existence, check **role alignment**: for each collection a code path reads, confirm the rule allows *every role that can reach that path*. There are three separate sources of access truth that must agree:
  1. `canAccess()` / the `settings/rolePermissions` map → controls sidebar/route visibility.
  2. `firestore.rules` → controls actual data reads.
  A page visible in the nav but denied by rules = the classic "page loads but data is empty" bug (hit for `bd_exec` on `leads` and `users`). If you add a role to a feature, add it to the rule too — and vice-versa.
- Reads scoped per-user in the rules (e.g. `resource.data.uid == request.auth.uid`) must have a matching `where()` in the query, or the whole query is rejected.

### 2. Never silently swallow data-layer errors
- `getDocs(...).catch(console.error)` on a user-facing read hides permission-denied / missing-index failures as an *empty* UI — indistinguishable from "no data". Surface it (toast / error state) so a rules gap is diagnosable instead of looking like normal empty state.

### 3. Read cost (Firestore free tier = 50k reads/day)
- No full-collection scans or N+1 subcollection reads on page load. Scope with `where()` + `limit()`, or denormalize.
- Precedent: project stage counts and collected amount are denormalized onto the project doc (`workflowTotal`, `workflowDone`, `stagesPaidAmount`) and kept in sync in `ProjectDetail` wherever stages change; list views + the chatbot read those instead of scanning `workflow` subcollections. A super-admin **Settings → System → "Recompute project stats"** button backfills them.

### 4. Standard correctness/security review still applies
Auth checks, input validation, injection, secrets in client code, error handling, etc.
