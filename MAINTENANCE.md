# Galaxy CRM — maintenance routine

Short, boring jobs that stop small problems becoming lost data. Nothing here
takes more than fifteen minutes.

---

## Every 2 days — automatic

The **GalaxyCRM Backup** scheduled task runs `scripts\BACKUP.bat`, which writes a
timestamped JSON copy of every collection to `backups\` and mirrors it to
`E:\GalaxyCRM-Backups`.

**Check it is actually running once a month:** open `backups\` and confirm the
newest folder is dated within the last two days. A scheduled task that silently
stopped is the most common way a backup plan dies.

---

## Every 3 months — the Recycle Bin

**Why this needs doing:** *Delete forever* in the Recycle Bin is irreversible.
There is no second bin behind it. Meanwhile items left in the bin still count
toward the database, and quote PDFs still occupy Cloudinary storage.

So the bin should be emptied deliberately, not impulsively, and never without a
current backup.

### The routine

1. **Take a backup first.** Double-click `scripts\BACKUP.bat` and wait for
   *"Done. N documents"*. This is the whole safety net for what follows.

2. **Open the Recycle Bin** in the CRM and read the list. Anything you recognise
   as deleted by mistake — **Restore** it now.

3. **Delete forever only items older than 3 months.** Recent deletions are the
   ones most likely to have been accidental, and nobody notices a missing lead
   the same week.

4. **Leave anything you are unsure about.** The bin is cheap. A wrongly deleted
   customer record is not.

### What "delete forever" actually removes

| Item type | Removed | Kept |
|---|---|---|
| Lead, customer, project, quotation | The record | Nothing |
| **Quote PDF** | The link on the lead | **The file stays in Cloudinary** |

Quote PDFs are the exception: the file itself is never deleted by the app. If
you need to reclaim that storage, remove it from the Cloudinary media library
manually — and only after confirming the quote is genuinely finished with.

---

## Every 3 months — Cloudinary

Quote PDFs live on a free Cloudinary account (25 credits/month). If it lapses or
runs out, **existing links stop working** — the CRM records survive, the files
may not.

1. Open <https://console.cloudinary.com> → **Dashboard**
2. Look at **Credit Usage For Last 30 Days**

| Usage | Do this |
|---|---|
| Under 15 / 25 | Nothing. |
| 15–20 / 25 | Compression is doing its job but volume is growing. Note it. |
| Over 20 / 25 | Act now — see below. |

**If you are running out:** the cheapest fix is not paying, it is deleting. Old
quotes for lost or long-closed leads can go from the media library. Failing
that, drop `COMPRESS_TARGET_BYTES` in `src/lib/quoteUpload.ts` from 3 MB to 1.5 MB
and new uploads get smaller again.

**Also confirm the account is still active.** A free Cloudinary account that
nobody signs into for a long stretch can be reclaimed. Logging in every three
months is enough to keep it alive.

---

## Every 6 months — restore drill

**An untested backup is a guess.** Once every six months, prove it works:

1. Open the newest folder in `backups\`
2. Open `_manifest.json` — check `totalDocuments` looks right
3. Open `leads.json` and find a lead you recognise. Confirm the name, phone and
   budget are all there
4. Open `activities.json` and confirm it is not empty

If a collection shows `0` and you know it has data, check the `skipped` section
of the manifest — that is a permissions problem worth fixing before you need it.

---

## Whenever someone leaves the company

1. Firebase Console → **Authentication** → disable their account
2. If they had `BACKUP.bat` on their machine, **change the password in it** —
   that file contains a working CRM login in plain text

---

## Things that are deliberately irreversible

Know these exist. Each one is a decision, not an accident:

| Action | Undo? |
|---|---|
| *Delete forever* in Recycle Bin | ❌ Backup only |
| `scripts\delete-*.mjs` with `--confirm-delete-production` | ❌ Backup only |
| `scripts\reset-*.mjs` with `--confirm-delete-production` | ❌ Backup only |
| Deleting a file from the Cloudinary media library | ❌ None |
| Removing a quote with the ❌ in the table | ✅ Recycle Bin |
| Deleting a lead or customer in the app | ✅ Recycle Bin |

The delete and reset scripts refuse to run without that flag. That guard is the
only thing between a mistyped command and an empty inventory collection — leave
it in place.

---

## Not covered by any of this

**Topz Cab is a separate Firebase project.** The backup script does not touch it.
If Topz holds data you cannot afford to lose, it needs its own backup — the
script would need that project's config added.
