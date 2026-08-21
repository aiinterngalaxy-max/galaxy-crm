# GPU Render Server — Setup Guide

How Content Studio's optional GPU-accelerated rendering is wired up: a
Tailscale-private network connecting the CRM's editors to a Windows PC with
an NVIDIA GPU, running the render service in `render-server/`. Written from
the actual setup process, including the mistakes made along the way, so a
repeat (new machine, new team member, disaster recovery) doesn't have to
rediscover the same things.

## Architecture

```
Editor's browser (on the Tailscale network)
        │  reaches 100.x.x.x directly — Tailscale
        │  works at the OS network level, not per-app
        ▼
GPU desktop (Windows, NVIDIA GPU)
        │  Node.js service, port 8787, Tailscale-only
        │  (Windows Firewall rule scoped to 100.64.0.0/10)
        ▼
ffmpeg -c:v h264_nvenc  (hardware encode)
```

The render server is **never** exposed to the public internet. Only devices
that have joined the same Tailscale network (`galaxy.homeauto` account) can
route to its `100.x.x.x` address at all — the API key it also checks is a
second layer, not the only one. Anyone editing video from a device *not* on
that network transparently falls back to the CRM's normal in-browser
rendering (see `src/lib/content-studio/remoteFFmpeg.ts` for how that
fallback works) — nothing breaks for them.

## 1. Install Tailscale on both machines

**On any machine you want on the network** (Windows):

1. Download and install from https://tailscale.com/download.
2. Open it (or run `tailscale up` from an elevated PowerShell) and sign in
   with the shared `galaxy.homeauto@gmail.com` account (or whichever
   account owns your tailnet).
3. Confirm it connected:
   ```powershell
   tailscale status
   tailscale ip -4
   ```
   `status` lists every *other* device on the tailnet (not itself);
   `ip -4` prints this machine's own `100.x.x.x` address.

**Gotcha hit during setup:** `tailscale up` prints a device-authorization
link (`https://login.tailscale.com/a/...`). That link expires after a few
minutes — if you wait too long to click it, just re-run `tailscale up` to
get a fresh one rather than reusing a stale link.

**Gotcha hit during setup:** if the Tailscale service looks stuck ("Logged
out" even right after signing in), restart the service before retrying:
```powershell
Get-Service Tailscale | Restart-Service
```

## 2. Confirm you're talking to the right machine

Multiple devices can share confusingly similar names. Before trusting an
address, verify BOTH the hostname *and* what `tailscale status` reports as
its OS — a mismatch (e.g. expecting Linux, seeing "windows" in the peer
list) means you've got the wrong machine. The simplest unambiguous check:
run `tailscale ip -4` **on the machine itself**, not from a peer's guess.

## 3. Set up SSH access to the GPU machine

This lets you (or an agent) run commands on the GPU desktop remotely,
instead of relaying every command by hand.

**On the GPU desktop**, in an **Administrator** PowerShell (Start menu →
search "PowerShell" → right-click → "Run as administrator" — Windows has
no `sudo`; this is the equivalent):

```powershell
# Check if the OpenSSH Server feature is already installed
Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*'

# If it says NotPresent, install it
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

# Make sure it's running and starts on boot
Start-Service sshd
Set-Service -Name sshd -StartupType 'Automatic'
```

**On the machine you're connecting FROM**, generate a dedicated key pair
(don't reuse a personal one for this):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/galaxy_gpu_server -N "" -C "your-note-here"
cat ~/.ssh/galaxy_gpu_server.pub
```

**Back on the GPU desktop** (still the Administrator PowerShell), register
that public key. Windows OpenSSH treats an **administrator** account
specially — its authorized keys live in a different, ACL-protected file
than a normal user's `~/.ssh/authorized_keys`:

```powershell
$pubKey = "PASTE_THE_PUBLIC_KEY_LINE_HERE"
Add-Content -Force -Path "$env:ProgramData\ssh\administrators_authorized_keys" -Value $pubKey
icacls.exe "$env:ProgramData\ssh\administrators_authorized_keys" /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"
Restart-Service sshd
```

Then connect from the other machine using its Tailscale address:
```bash
ssh -i ~/.ssh/galaxy_gpu_server Welcome@100.x.x.x
```
(replace `Welcome` with the actual Windows account name, and the IP with
whatever `tailscale ip -4` printed on the GPU desktop).

**Gotcha hit during setup:** Windows OpenSSH's default shell for new
sessions is `cmd.exe`, not PowerShell — every command needs cmd-compatible
syntax (no `&&`, no `Select-String`, etc.) unless you switch it:
```powershell
reg add "HKLM\SOFTWARE\OpenSSH" /v DefaultShell /t REG_SZ /d "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" /f
Restart-Service sshd
```
New connections after that use PowerShell; a connection already open when
you make this change keeps using its original shell until reconnected.

## 4. Open the firewall — Tailscale range only, never public

This is the one step that's a real security decision, not just plumbing —
confirm before doing it on a machine you don't fully control.

```powershell
New-NetFirewallRule -DisplayName "Galaxy Render Server (Tailscale only)" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -RemoteAddress 100.64.0.0/10 -Profile Any
```

`100.64.0.0/10` is Tailscale's entire private address range (CGNAT space) —
scoping to it means only tailnet members can ever reach port 8787, never
the open internet, regardless of what else happens to this machine's
network config.

## 5. Deploy the render service

From the CRM repo, copy `render-server/` to the GPU desktop (`scp` shown
here; drag-and-drop over a mapped drive works too):

```bash
scp render-server/package.json render-server/src/server.js render-server/start.ps1 \
    Welcome@100.x.x.x:"C:/galaxy-render-server/"
```
(create `C:\galaxy-render-server\src` first if it doesn't exist)

On the GPU desktop:
```powershell
cd C:\galaxy-render-server
npm install
```

**Create the API key file** — this is deliberately NOT part of the copied
repo files (see `.gitignore`: `render-server/api-key.txt` is excluded).
Generate a real key and save it there directly on the server, never in git:
```powershell
# generate one, e.g. via: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
Set-Content -NoNewline -Path "C:\galaxy-render-server\api-key.txt" -Value "PASTE_A_LONG_RANDOM_KEY"
```

**Gotcha hit during setup:** if you write `start.ps1` (or any `.ps1` file)
with a non-ASCII character in it (an em-dash, curly quotes, etc.) on a
machine with a different locale than the Windows box, `scp`/editing tools
can silently mangle the encoding, and PowerShell 5.1 fails with a cryptic
"string is missing the terminator" parse error. Stick to plain ASCII in
`.ps1` files, or verify the file loads with `Get-Content` after transfer.

## 6. Run it persistently (Scheduled Task, not a one-off process)

A process started from an interactive SSH session dies when that session
ends — it needs to be registered as a proper background task instead.

```powershell
schtasks /create /tn "GalaxyRenderServer" /tr "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\galaxy-render-server\start.ps1" /sc onlogon /rl highest /f
schtasks /run /tn "GalaxyRenderServer"
```

This runs the service (via `start.ps1`'s own restart-loop, so a node
crash doesn't take the whole service down) whenever the `Welcome` account
logs on. **Limitation:** since it's tied to "at logon" rather than "run
whether user is logged on or not" (which needs the account's password
stored in the task — avoid that), the desktop needs to stay logged into
that account for the service to be available. Fine for a dedicated desktop
that's rarely rebooted; if that stops being true, revisit this with proper
credential storage or convert it to a true Windows Service (e.g. via NSSM).

**Verify it's actually listening:**
```powershell
Get-NetTCPConnection -LocalPort 8787
```
And from another machine on the tailnet:
```bash
curl -H "x-api-key: YOUR_KEY" http://100.x.x.x:8787/health
# → {"ok":true,"activeRenders":0,"queued":0}
```

**If the scheduled task's "Last Result" isn't 0:** check
`C:\galaxy-render-server\service.log` for the actual error, or run
`start.ps1` directly in a foreground PowerShell window to see it live —
the Scheduled Task itself doesn't surface script errors anywhere obvious.

## 7. Wire it into the CRM (Vercel environment variables)

In the Vercel project → **Settings → Environment Variables**, add (scoped
to Production, and Preview too if wanted):

| Key | Value |
|---|---|
| `VITE_RENDER_SERVER_URL` | `http://100.x.x.x:8787` (the GPU desktop's Tailscale address) |
| `VITE_RENDER_API_KEY` | the same key that's in `api-key.txt` on the server |

Vercel will warn that the `VITE_` prefix exposes this value to the browser
— that's expected and required here, since the browser calls the render
server directly rather than through a server-side proxy. It's safe given
the network-level restriction in step 4: the key alone is useless to
anyone who isn't already on the tailnet, since they can't route to the
address at all.

These take effect on the next deployment — redeploy (or push a commit) 
after adding them.

## Maintenance notes

- **Restarting after a code change to `render-server/src/server.js`:** copy
  the updated file over via `scp`, then
  `schtasks /end /tn "GalaxyRenderServer"` followed by
  `schtasks /run /tn "GalaxyRenderServer"`.
- **Rotating the API key:** update `api-key.txt` on the server, restart the
  task (above), and update `VITE_RENDER_API_KEY` in Vercel + redeploy.
- **Checking logs:** `C:\galaxy-render-server\service.log` on the GPU
  desktop has ffmpeg's own stdout/stderr for every render, plus a line
  each time the process restarts.
