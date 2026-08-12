import { describe, it, expect, vi } from 'vitest'

const { mapKlapStatus, pollUntilDone, KlapError } = await import('../content-studio/klap')

describe('mapKlapStatus', () => {
  it('maps a finished generate to Generated, not Exported', () => {
    expect(mapKlapStatus('ready', 'generate')).toBe('Generated')
  })

  // Klap reports the identical word for both phases, so without the phase
  // argument a finished export would read as "clips are ready" and the UI
  // would send the operator back to pick a clip they already exported.
  it('maps a finished export to Exported, not Generated', () => {
    expect(mapKlapStatus('ready', 'export')).toBe('Exported')
  })

  it('maps in-progress per phase', () => {
    expect(mapKlapStatus('processing', 'generate')).toBe('Generating')
    expect(mapKlapStatus('processing', 'export')).toBe('Exporting')
  })

  it('maps error to Failed regardless of phase', () => {
    expect(mapKlapStatus('error', 'generate')).toBe('Failed')
    expect(mapKlapStatus('error', 'export')).toBe('Failed')
  })

  it('treats an unrecognised status as still running rather than done', () => {
    // Guessing "done" on an unknown status would mark a job Exported with no
    // output URL; guessing "running" only costs another poll.
    expect(mapKlapStatus('queued', 'generate')).toBe('Generating')
    expect(mapKlapStatus('', 'export')).toBe('Exporting')
  })
})

describe('pollUntilDone', () => {
  it('returns as soon as the status is terminal', async () => {
    const check = vi.fn().mockResolvedValue({ status: 'ready', url: 'x' })
    const res = await pollUntilDone(check, { intervalMs: 0, maxAttempts: 5 })
    expect(res.status).toBe('ready')
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('keeps polling while processing, then resolves', async () => {
    const check = vi
      .fn()
      .mockResolvedValueOnce({ status: 'processing' })
      .mockResolvedValueOnce({ status: 'processing' })
      .mockResolvedValueOnce({ status: 'ready' })
    const res = await pollUntilDone(check, { intervalMs: 0, maxAttempts: 10 })
    expect(res.status).toBe('ready')
    expect(check).toHaveBeenCalledTimes(3)
  })

  it('resolves (not throws) on a terminal error status', async () => {
    // An errored render is a real answer — the caller records the failure.
    // Throwing here would be indistinguishable from a network fault.
    const check = vi.fn().mockResolvedValue({ status: 'error' })
    await expect(pollUntilDone(check, { intervalMs: 0, maxAttempts: 3 })).resolves.toMatchObject({ status: 'error' })
  })

  it('gives up after the attempt budget instead of polling forever', async () => {
    const check = vi.fn().mockResolvedValue({ status: 'processing' })
    await expect(pollUntilDone(check, { intervalMs: 0, maxAttempts: 4 })).rejects.toBeInstanceOf(KlapError)
    expect(check).toHaveBeenCalledTimes(4)
  })
})
