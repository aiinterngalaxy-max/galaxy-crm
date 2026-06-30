import { run, all, one } from '../db'
import { Provider, AccountResult } from './types'
import { ytConfigured, ytBrandId, ytPull, YT_NEEDS } from './youtube'
import { igConfigured, igBrandId, igPull, IG_NEEDS } from './instagram'
import { liConfigured, liBrandId, liPull, LI_NEEDS } from './linkedin'
import { fbConfigured, fbBrandId, fbPull, FB_NEEDS } from './facebook'

export function providers(): Provider[] {
  return [
    { key: 'youtube', label: 'YouTube', brandId: ytBrandId(), configured: ytConfigured(), needs: YT_NEEDS, pull: ytPull },
    { key: 'instagram', label: 'Instagram', brandId: igBrandId(), configured: igConfigured(), needs: IG_NEEDS, pull: igPull },
    { key: 'facebook', label: 'Facebook', brandId: fbBrandId(), configured: fbConfigured(), needs: FB_NEEDS, pull: fbPull },
    { key: 'linkedin', label: 'LinkedIn', brandId: liBrandId(), configured: liConfigured(), needs: LI_NEEDS, pull: liPull },
  ]
}

export function connectionStatus() {
  return providers().map((p) => ({ key: p.key, label: p.label, connected: p.configured, needs: p.needs, brandId: p.brandId }))
}

export interface SyncSummary {
  platform: string
  ok: boolean
  posts: number
  followers: number
  error?: string
}

export async function syncAll(limit = 100): Promise<SyncSummary[]> {
  const out: SyncSummary[] = []
  for (const p of providers()) {
    if (!p.configured) continue
    let res: AccountResult
    try {
      res = await p.pull(limit)
    } catch (e: any) {
      res = { ok: false, platform: p.label, handle: '', account_id: '', follower_count: 0, posts: [], error: String(e?.message || e) }
    }

    await run('INSERT INTO cmo_sync_log(platform, ok, detail) VALUES(?,?,?)', [
      p.label,
      res.ok ? 1 : 0,
      res.ok ? `${res.posts.length} posts, ${res.follower_count} followers` : res.error || 'failed',
    ])

    if (!res.ok) {
      out.push({ platform: p.label, ok: false, posts: 0, followers: 0, error: res.error })
      continue
    }

    await run(
      `INSERT INTO cmo_channels(brand_id,platform,handle,account_id,follower_count,last_synced)
       VALUES(?,?,?,?,?,datetime('now'))
       ON CONFLICT(brand_id,platform) DO UPDATE SET
         handle=excluded.handle, account_id=excluded.account_id,
         follower_count=excluded.follower_count, last_synced=datetime('now')`,
      [p.brandId, res.platform, res.handle, res.account_id, res.follower_count],
    )

    for (const post of res.posts) {
      const existing = await one<{ id: number }>('SELECT id FROM cmo_content WHERE ext_id=?', [post.ext_id])
      let contentId: number
      if (existing) {
        contentId = existing.id
        await run(
          `UPDATE cmo_content SET brand_id=?, title=?, platform=?, format=?, publish_date=?, stage='Published',
             ext_platform=?, ext_url=?, source='sync' WHERE id=?`,
          [p.brandId, post.title, post.platform, post.format, post.publish_date, post.platform, post.ext_url, contentId],
        )
      } else {
        const rs = await run(
          `INSERT INTO cmo_content
             (brand_id,title,format,platform,stage,priority,writer,editor,talent,start_date,due_date,publish_date,shoot_date,location,revision_rounds,approved,notes,ext_platform,ext_id,ext_url,source)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            p.brandId, post.title, post.format, post.platform, 'Published', 'Normal',
            '', '', '', null, null, post.publish_date, null, '', 0, 1, '',
            post.platform, post.ext_id, post.ext_url, 'sync',
          ],
        )
        contentId = Number(rs.lastInsertRowid ?? 0)
      }

      const m = post.metrics
      await run('DELETE FROM cmo_performance WHERE content_id=?', [contentId])
      await run(
        `INSERT INTO cmo_performance
           (content_id,views,reach,likes,comments,shares,saves,watch_time_sec,follower_growth)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [contentId, m.views, m.reach, m.likes, m.comments, m.shares, m.saves, m.watch_time_sec, 0],
      )
    }

    out.push({ platform: res.platform, ok: true, posts: res.posts.length, followers: res.follower_count, error: res.error })
  }
  return out
}

export async function lastSync() {
  return all<{ platform: string; ok: number; detail: string; ts: string }>(
    'SELECT platform, ok, detail, ts FROM cmo_sync_log ORDER BY id DESC LIMIT 6',
  )
}
