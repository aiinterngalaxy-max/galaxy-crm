# Firebase Storage setup — quote PDF uploads

If a quote upload sits at **0%** and never moves, the cause is almost always on
this page. The application code cannot fix it: the browser is being blocked
before a single byte leaves the machine.

---

## Why an upload freezes at exactly 0%

Firebase uses a **resumable upload**. The browser first opens an upload session,
then sends the file in chunks. Both steps read custom `X-Goog-Upload-*` response
headers.

If the bucket's CORS policy does not allow those headers, the browser refuses to
read the response, no chunk is ever sent, and the progress callback never fires
once. The UI holds at the value it started with — `0%` — indefinitely.

Since August 2026 the app fails after 25 seconds with a message naming this cause
instead of hanging forever. That message means: **do the steps below.**

---

## 1. Find your real bucket name

Firebase Console → **Storage** → the name shown at the top of the Files tab.

Projects created before ~October 2024 use `<project-id>.appspot.com`.
Newer projects use `<project-id>.firebasestorage.app`.

**They are not interchangeable.** Using the wrong one produces the same 0% freeze.

Confirm the app is using that exact value:

- Local: `VITE_FIREBASE_STORAGE_BUCKET` in `.env`
- Deployed: Vercel → Project → Settings → Environment Variables

The value must be the bare bucket name — **no `gs://` prefix**, no trailing slash.

> Vite bakes environment variables in at **build** time. Changing a Vercel
> variable does nothing until you redeploy.

---

## 2. Apply the CORS policy to the bucket

`cors.json` in this repo has no effect until it is pushed to the bucket. This is
the step most often missed.

### With the gcloud CLI

```bash
gcloud storage buckets update gs://YOUR_BUCKET_NAME --cors-file=cors.json
```

### With gsutil (older toolchain)

```bash
gsutil cors set cors.json gs://YOUR_BUCKET_NAME
```

### Verify it applied

```bash
gcloud storage buckets describe gs://YOUR_BUCKET_NAME --format="default(cors_config)"
```

The output must list `X-Goog-Upload-Command`, `X-Goog-Upload-Offset`,
`X-Goog-Upload-Protocol`, `X-Goog-Upload-Status` and `X-Goog-Upload-URL`. If those
are missing, uploads will freeze at 0% no matter what the app does.

### No CLI installed?

Google Cloud Console → **Cloud Shell** (the `>_` icon, top right). It has both
tools preinstalled. Upload `cors.json` with the shell's ⋮ → Upload File, then run
the command above.

---

## 3. Check the origin is allowed

`cors.json` lists the origins permitted to upload:

```json
"origin": [
  "http://localhost:5173",
  "http://localhost:4173",
  "https://galaxy-home-automation-crm.vercel.app"
]
```

**Add any new domain here and re-apply**, including Vercel preview URLs if you
upload from them. An origin that is not listed is refused, and the symptom is —
again — a frozen 0%.

---

## 4. Confirm the Storage rules

`storage.rules` requires a signed-in user:

```
allow read, write: if request.auth != null;
```

That is correct for this app. A signed-out session produces
`storage/unauthorized`, which the app now reports as
*"You do not have permission to upload here."* — a different message from the
0% freeze, so the two are easy to tell apart.

Deploy rules with:

```bash
firebase deploy --only storage
```

---

## Reading the console trace

Every upload logs its stages. Open DevTools → Console and filter for
`[quote-upload]`:

```
[quote-upload] file-selected   { name: 'Quote.pdf', bytes: 20971520 }
[quote-upload] validated
[quote-upload] hashed          { sha256: 'a3f1c9e2b7d4…' }
[quote-upload] compression-skipped { reason: 'disabled' }
[quote-upload] upload-start    { path: 'leads/abc/quotes/…' }
[quote-upload] first-byte      ← if this line never appears, it is CORS
[quote-upload] upload-complete
[quote-upload] firestore-saved
```

**`upload-start` with no `first-byte` within 25 seconds means CORS or a wrong
bucket name.** Nothing else produces that exact pattern.

A red line reading *"Firebase Storage bucket is placeholder.appspot.com"* means
`VITE_FIREBASE_STORAGE_BUCKET` was not set at build time — go back to step 1.

---

## Storage efficiency

- **Duplicates are rejected before upload.** Each PDF is hashed (SHA-256) and
  compared against the quotes already on that record. Re-uploading the same file
  costs one hash and no transfer.
- **Existing quotes are untouched.** Records saved before hashing have no
  `sha256` field and keep working; they fall back to a name + size comparison.
- **Size is recorded** on every new upload, so storage use is measurable.
- **The upload cap is 25 MB per PDF** (`MAX_QUOTE_BYTES` in `src/lib/quoteUpload.ts`).
- **Compression is off.** It rasterised pages on the main thread and froze the
  tab. Re-enable via `COMPRESSION_ENABLED` in `src/lib/quoteUpload.ts` only after
  moving that work into a Web Worker with `OffscreenCanvas`.
