/**
 * A drop-in remote backend for the in-browser ffmpeg.wasm instance
 * autoEdit.ts uses everywhere. It implements the exact same surface
 * (writeFile/readFile/deleteFile/exec/on/off) that every editing function
 * in that file already calls — none of those ~30 functions needed to
 * change to benefit from this; only loadFFmpeg() itself picks which
 * implementation to hand back.
 *
 * Why this exists: ffmpeg.wasm is CPU-only and slow, especially on longer
 * clips or heavier operations (color grading, zoom/pan, multi-clip joins).
 * If a GPU render server is reachable, this routes the exact same work to
 * it instead — same args, same virtual-filesystem model (write files by
 * name, run ffmpeg, read files back by name), just executed with NVIDIA
 * NVENC on real hardware instead of a software encoder in the browser.
 *
 * Security model: the render server is deliberately NOT exposed to the
 * public internet. It's reachable only over Tailscale (a private network),
 * so only a browser running on a device that's ALSO joined to that same
 * Tailscale network can route to it at all — the API key is a second
 * check on top of that, not the only one. A browser not on the tailnet
 * simply can't reach the address, and reachFailure() below makes that a
 * silent, expected fallback to local rendering rather than an error.
 */
import type { FileData } from '@ffmpeg/ffmpeg'

export interface FFmpegLike {
  on(event: 'log', cb: (e: { message: string }) => void): void
  on(event: 'progress', cb: (e: { progress: number }) => void): void
  off(event: 'log', cb: (e: { message: string }) => void): void
  off(event: 'progress', cb: (e: { progress: number }) => void): void
  writeFile(name: string, data: Uint8Array): Promise<void | boolean>
  readFile(name: string): Promise<FileData>
  deleteFile(name: string): Promise<void | boolean>
  exec(args: string[]): Promise<void | number>
}

export interface RemoteFFmpegConfig {
  baseUrl: string
  apiKey: string
}

/** Reads the render-server config from Vite env vars, if set. Both must be
 *  present — a URL with no key (or vice versa) is treated as unconfigured
 *  rather than guessing. */
export function remoteFFmpegConfig(): RemoteFFmpegConfig | null {
  const baseUrl = import.meta.env.VITE_RENDER_SERVER_URL as string | undefined
  const apiKey = import.meta.env.VITE_RENDER_API_KEY as string | undefined
  if (!baseUrl || !apiKey) return null
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey }
}

/** A short, cheap reachability check — this is what makes "not on the
 *  tailnet" a silent fallback instead of every render hanging until a
 *  long timeout. 2s is generous for a LAN/tailnet round trip and still
 *  fast enough that an unreachable server doesn't stall page load. */
export async function isRemoteFFmpegReachable(config: RemoteFFmpegConfig): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 2000)
    const res = await fetch(`${config.baseUrl}/health`, {
      headers: { 'x-api-key': config.apiKey },
      signal: ctrl.signal,
    })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

export class RemoteFFmpeg implements FFmpegLike {
  private sessionPromise: Promise<string> | null = null
  private progressCb?: (e: { progress: number }) => void
  private logCb?: (e: { message: string }) => void

  constructor(private config: RemoteFFmpegConfig) {}

  on(event: 'log', cb: (e: { message: string }) => void): void
  on(event: 'progress', cb: (e: { progress: number }) => void): void
  on(event: 'log' | 'progress', cb: (e: never) => void): void {
    if (event === 'progress') this.progressCb = cb as (e: { progress: number }) => void
    else this.logCb = cb as (e: { message: string }) => void
  }

  off(event: 'log', cb: (e: { message: string }) => void): void
  off(event: 'progress', cb: (e: { progress: number }) => void): void
  off(event: 'log' | 'progress'): void {
    if (event === 'progress') this.progressCb = undefined
    else this.logCb = undefined
  }

  private headers(extra?: Record<string, string>) {
    return { 'x-api-key': this.config.apiKey, ...extra }
  }

  /** One session per RemoteFFmpeg instance, created lazily on first use and
   *  reused for every writeFile/exec/readFile call after — mirrors how the
   *  real ffmpeg.wasm singleton keeps one virtual filesystem alive across
   *  an entire editing session, not one per operation. */
  private async ensureSession(): Promise<string> {
    if (!this.sessionPromise) {
      this.sessionPromise = fetch(`${this.config.baseUrl}/session`, {
        method: 'POST',
        headers: this.headers(),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Could not start a render session (${res.status}).`)
          return res.json()
        })
        .then((d: { sessionId: string }) => d.sessionId)
    }
    return this.sessionPromise
  }

  async writeFile(name: string, data: Uint8Array): Promise<void | boolean> {
    const id = await this.ensureSession()
    const res = await fetch(`${this.config.baseUrl}/session/${id}/files/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: this.headers(),
      body: new Blob([data as BlobPart]),
    })
    if (!res.ok) throw new Error(`Could not upload "${name}" to the render server (${res.status}).`)
  }

  async readFile(name: string): Promise<FileData> {
    const id = await this.ensureSession()
    const res = await fetch(`${this.config.baseUrl}/session/${id}/files/${encodeURIComponent(name)}`, {
      headers: this.headers(),
    })
    if (!res.ok) throw new Error(`Could not fetch "${name}" from the render server (${res.status}).`)
    return new Uint8Array(await res.arrayBuffer())
  }

  async deleteFile(name: string): Promise<void | boolean> {
    const id = await this.ensureSession()
    await fetch(`${this.config.baseUrl}/session/${id}/files/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: this.headers(),
    }).catch(() => {})
  }

  /** No live progress from the server in this version — it runs ffmpeg and
   *  responds once the whole render is done, rather than streaming
   *  incremental frame progress the way the in-browser instance can. GPU
   *  renders are enough faster that this is a smaller loss than it sounds;
   *  a future version could add Server-Sent Events for real progress. */
  async exec(args: string[]): Promise<void | number> {
    const id = await this.ensureSession()
    this.progressCb?.({ progress: 0 })
    const res = await fetch(`${this.config.baseUrl}/session/${id}/exec`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ args }),
    })
    const data = await res.json().catch(() => ({}) as { ok?: boolean; error?: string; stderr?: string })
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Render server exec failed (${res.status}).`)
    }
    if (data.stderr) this.logCb?.({ message: data.stderr })
    this.progressCb?.({ progress: 1 })
  }

  /** Best-effort — lets the server free the session's temp dir right away
   *  instead of waiting for its own idle sweep. Not required for
   *  correctness (the server self-cleans), so failures here are ignored. */
  async closeSession(): Promise<void> {
    if (!this.sessionPromise) return
    const id = await this.sessionPromise.catch(() => null)
    if (!id) return
    await fetch(`${this.config.baseUrl}/session/${id}`, { method: 'DELETE', headers: this.headers() }).catch(() => {})
  }
}
