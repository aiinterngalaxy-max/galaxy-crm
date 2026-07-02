import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Upload, Phone, MessageSquare, ChevronLeft, ChevronRight,
  BarChart2, CheckCircle, Globe, MapPin, Star, Hash,
  Loader2, Zap, Palette,
} from 'lucide-react'
import {
  db, collection, addDoc, getDocs,
  serverTimestamp, updateDoc, doc, onSnapshot, orderBy,
} from '../../lib/firebase'
import { where, query } from 'firebase/firestore'
import { useAuth } from '../../contexts/AuthContext'
import { nextLeadCode } from '../../lib/counters'
import { cn } from '../../lib/utils'
import { Timestamp } from 'firebase/firestore'
import toast from 'react-hot-toast'
import type { Lead } from '../../types'
import { Card } from '../../components/ui/Card'

// ─── Types ────────────────────────────────────────────────────────────────────

type CampaignSegment = 'electrical_trade' | 'interior_design' | 'unknown'

interface ScrapedRow {
  name: string
  phone: string
  address: string
  category: string
  website: string
  rating: number
  reviews: number
  segment: CampaignSegment
  existingNotes: string
}

// ─── Segment detection from category ─────────────────────────────────────────

const ELECTRICAL_KEYWORDS = ['electrician', 'electrical', 'hardware', 'automation', 'electric', 'wiring', 'switchgear', 'contractor']
const INTERIOR_KEYWORDS = ['interior', 'architect', 'design', 'decorator', 'construction', 'renovation', 'turnkey']

function detectSegment(category: string): CampaignSegment {
  const c = category.toLowerCase()
  if (ELECTRICAL_KEYWORDS.some(k => c.includes(k))) return 'electrical_trade'
  if (INTERIOR_KEYWORDS.some(k => c.includes(k))) return 'interior_design'
  return 'unknown'
}

function normalisePhone(p: string): string {
  if (!p) return ''
  const d = p.replace(/\D/g, '')
  let clean = d
  if (clean.startsWith('91') && clean.length === 12) clean = clean.slice(2)
  if (clean.startsWith('0') && clean.length === 11) clean = clean.slice(1)
  if (clean.length === 10 && '6789'.includes(clean[0])) return clean
  return d.length >= 10 ? d.slice(-10) : p
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCSV(text: string, forcedSegment: CampaignSegment | 'auto'): ScrapedRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  // Find the actual header row — scan first 10 lines for one containing 'phone' or 'business name'
  let headerIdx = 0
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const lower = lines[i].toLowerCase()
    if (lower.includes('phone') || lower.includes('business name') || lower.includes('title')) {
      headerIdx = i
      break
    }
  }

  const headers = lines[headerIdx].split(',').map(h => h.trim().toLowerCase().replace(/["\r]/g, ''))

  const col = (row: string[], ...names: string[]) => {
    for (const n of names) {
      const i = headers.indexOf(n)
      if (i !== -1) return (row[i] ?? '').replace(/["\r]/g, '').trim()
    }
    return ''
  }

  const splitRow = (line: string): string[] => {
    const result: string[] = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue }
      if (ch === ',' && !inQ) { result.push(cur); cur = ''; continue }
      cur += ch
    }
    result.push(cur)
    return result
  }

  const rows: ScrapedRow[] = []
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const r = splitRow(lines[i])
    const name = col(r, 'business name', 'title', 'name')
    if (!name) continue
    const category = col(r, 'category')
    const segment = forcedSegment === 'auto' ? detectSegment(category) : forcedSegment
    rows.push({
      name,
      phone: normalisePhone(col(r, 'phone')),
      address: col(r, 'address'),
      category,
      website: col(r, 'website'),
      rating: parseFloat(col(r, 'rating') || '0') || 0,
      reviews: parseInt(col(r, 'reviews', 'review count', 'reviews') || '0') || 0,
      segment,
      existingNotes: col(r, 'call notes', 'notes', 'call_notes'),
    })
  }
  return rows
}

// ─── Call Scripts ─────────────────────────────────────────────────────────────

const ELECTRICAL_SCRIPT = [
  {
    label: 'OPEN',
    color: 'text-blue-400',
    bg: 'bg-blue-900/20 border-blue-800',
    script: 'Hi, am I speaking with [Name]? I\'m calling from Galaxy Home Automation. We\'ve launched a smart switch brand called Elysia — premium finish at very competitive B2B pricing. Do you stock smart switches currently?',
  },
  {
    label: 'QUALIFY',
    color: 'text-purple-400',
    bg: 'bg-purple-900/20 border-purple-800',
    script: '"Which brands are you currently stocking?" — Listen for: Phlipton, Wipro, Legrand, grey imports, no brand. If they say Phlipton, note their margin — we beat it significantly.',
  },
  {
    label: 'PAIN',
    color: 'text-amber-400',
    bg: 'bg-amber-900/20 border-amber-800',
    script: '"What\'s the biggest frustration — warranty issues, margin pressure, delivery time?" — Phlipton finish starts at ₹750–970. Ours is ₹160–264. If margin is the topic: our B2B price gives 30–40% margin at MRP ₹3,200.',
  },
  {
    label: 'PITCH',
    color: 'text-green-400',
    bg: 'bg-green-900/20 border-green-800',
    script: '"We have 4-touch, 8-touch in Glass / PC / Aluminium finishes. B2B price ₹1,375–2,070. 2-year replacement warranty. MOQ is just 5 units to start. Interested in a sample panel?"',
  },
  {
    label: 'CLOSE',
    color: 'text-gold-400',
    bg: 'bg-yellow-900/20 border-yellow-800',
    script: '"Can I WhatsApp you the pricelist and send one demo panel? 30 seconds on your end." → Get WhatsApp number. Confirm delivery address.',
  },
]

const INTERIOR_SCRIPT = [
  {
    label: 'OPEN',
    color: 'text-blue-400',
    bg: 'bg-blue-900/20 border-blue-800',
    script: 'Hi, am I speaking with [Name]? I\'m calling from Galaxy Home Automation. We\'ve launched Elysia — a premium smart switch range designed for luxury residential and commercial interiors. Do you spec smart switches for your projects?',
  },
  {
    label: 'QUALIFY',
    color: 'text-purple-400',
    bg: 'bg-purple-900/20 border-purple-800',
    script: '"What smart switch brands do you usually specify — Phlipton, Legrand, Lutron?" — Listen for premium brands. Position Elysia as equal finish quality at a fraction of the cost, which gives clients better value and you a referral commission.',
  },
  {
    label: 'PAIN',
    color: 'text-amber-400',
    bg: 'bg-amber-900/20 border-amber-800',
    script: '"Is your client ever price-sensitive about the switches? Or does the client push back on Phlipton pricing?" — Our GSP pricing on a 3BHK is often ₹30,000–50,000 cheaper than Phlipton for the same finish quality.',
  },
  {
    label: 'PITCH',
    color: 'text-green-400',
    bg: 'bg-green-900/20 border-green-800',
    script: '"Elysia comes in 4-touch Glass / PC / Aluminium — perfect for luxury interiors. We offer referral commission on every project you specify us for. No stock needed — we deliver to site. Can I send you our finish catalogue?"',
  },
  {
    label: 'CLOSE',
    color: 'text-gold-400',
    bg: 'bg-yellow-900/20 border-yellow-800',
    script: '"Can I WhatsApp you the catalogue and finish samples? I can also arrange a sample panel for your studio." → Confirm WhatsApp number and studio/office address for sample delivery.',
  },
]

// ─── Segment badge ────────────────────────────────────────────────────────────

function SegmentBadge({ segment }: { segment: CampaignSegment }) {
  if (segment === 'electrical_trade') return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-medium bg-blue-900/40 text-blue-400">
      <Zap className="w-2.5 h-2.5" /> Electrical Trade
    </span>
  )
  if (segment === 'interior_design') return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-medium bg-purple-900/40 text-purple-400">
      <Palette className="w-2.5 h-2.5" /> Interior & Design
    </span>
  )
  return <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-gray-800 text-gray-500">Unknown</span>
}

// ─── Tab: Import ──────────────────────────────────────────────────────────────

const SESSION_KEY = 'b2b_import_rows'

function ImportTab() {
  const { user } = useAuth()
  const [rows, setRows] = useState<ScrapedRow[]>(() => {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '[]') } catch { return [] }
  })
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState(false)
  const [forcedSegment, setForcedSegment] = useState<CampaignSegment | 'auto'>('auto')
  const fileRef = useRef<HTMLInputElement>(null)

  const segmentCounts = useMemo(() => {
    const map: Record<string, number> = { electrical_trade: 0, interior_design: 0, unknown: 0 }
    rows.forEach(r => { map[r.segment] = (map[r.segment] || 0) + 1 })
    return map
  }, [rows])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const parsed = parseCSV(text, forcedSegment)
      setRows(parsed)
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed))
      setDone(false)
      setProgress(0)
      if (parsed.length === 0) toast.error('No rows found — check column headers')
      else toast.success(`Parsed ${parsed.length} rows from ${file.name}`)
    }
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  const handleImport = async () => {
    if (!rows.length) return
    setImporting(true)
    setProgress(0)

    const existingSnap = await getDocs(collection(db, 'leads'))
    const existingPhones = new Set(existingSnap.docs.map(d => d.data().phone))

    let created = 0, skipped = 0
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const phone = row.phone
      if (!phone || existingPhones.has(phone)) { skipped++; setProgress(Math.round((i + 1) / rows.length * 100)); continue }

      try {
        const leadCode = await nextLeadCode()
        await addDoc(collection(db, 'leads'), {
          leadCode,
          status: 'new',
          source: 'cold_call',
          businessType: 'b2b',
          name: row.name,
          phone,
          address: row.address || null,
          notes: [
            row.category,
            row.rating ? `Rating: ${row.rating}★ (${row.reviews} reviews)` : '',
            row.website ? `Website: ${row.website}` : '',
            row.existingNotes ? `Call Notes: ${row.existingNotes}` : '',
          ].filter(Boolean).join(' | ') || null,
          campaignSegment: row.segment,
          campaignRating: row.rating || null,
          campaignReviews: row.reviews || null,
          campaignCategory: row.category || null,
          campaignWebsite: row.website || null,
          campaignCity: 'Mumbai',
          assignedTo: user?.id ?? '',
          assignedToName: user?.name ?? null,
          aiScore: Math.min(100, Math.round(30 + (row.rating / 5) * 40 + (row.reviews > 50 ? 15 : row.reviews > 10 ? 8 : 0))),
          demoGiven: false,
          createdBy: user?.id ?? '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        existingPhones.add(phone)
        created++
      } catch { /* skip on error */ }
      setProgress(Math.round((i + 1) / rows.length * 100))
    }
    setImporting(false)
    setDone(true)
    toast.success(`Imported ${created} leads${skipped ? `, skipped ${skipped} duplicates` : ''}`)
  }

  return (
    <div className="space-y-5">
      {/* Segment selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-xs text-gray-500">Which tab are you importing?</p>
        {([
          ['auto', 'Auto-detect from category'],
          ['electrical_trade', 'Electrical Trade (Reseller/Stockist)'],
          ['interior_design', 'Interior & Design (Spec/Referral)'],
        ] as const).map(([val, label]) => (
          <button key={val} onClick={() => setForcedSegment(val)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              forcedSegment === val ? 'border-gold-500 bg-gold-500/10 text-gold-400' : 'border-gray-700 text-gray-500 hover:border-gray-600'
            )}>
            {label}
          </button>
        ))}
      </div>

      {/* Upload zone */}
      <div
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-gray-700 hover:border-gold-500/50 rounded-xl p-10 text-center cursor-pointer transition-colors group"
      >
        <Upload className="w-8 h-8 text-gray-600 group-hover:text-gold-500 mx-auto mb-3 transition-colors" />
        <p className="text-sm font-medium text-gray-300">Drop CSV here or click to browse</p>
        <p className="text-xs text-gray-600 mt-1">
          Export each tab from <span className="text-gray-400">Electrical & Interior Sheet 2026</span> as CSV and import here
        </p>
        <p className="text-xs text-gray-700 mt-1">Columns: Business Name, Phone, Category, Rating, Reviews, Website, Address, Call Notes</p>
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
      </div>

      {rows.length > 0 && (
        <>
          {/* Segment summary */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { key: 'electrical_trade', label: 'Electrical Trade', color: 'border-blue-900 bg-blue-900/10', text: 'text-blue-400' },
              { key: 'interior_design',  label: 'Interior & Design', color: 'border-purple-900 bg-purple-900/10', text: 'text-purple-400' },
              { key: 'unknown',          label: 'Undetected',        color: 'border-gray-800 bg-gray-900/10',  text: 'text-gray-500' },
            ].map(s => (
              <div key={s.key} className={cn('rounded-xl p-3 border', s.color)}>
                <p className={cn('text-xs font-semibold', s.text)}>{s.label}</p>
                <p className="text-2xl font-bold text-white mt-1">{segmentCounts[s.key] || 0}</p>
                <p className="text-[10px] text-gray-600">leads</p>
              </div>
            ))}
          </div>

          {/* Action row */}
          <div className="flex items-center justify-end gap-3">
            {done && <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Import complete</span>}
            <button
              onClick={handleImport}
              disabled={importing || done}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gold-500 text-black text-sm font-semibold hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {importing
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing… {progress}%</>
                : done
                ? <><CheckCircle className="w-4 h-4" /> Done</>
                : <><Upload className="w-4 h-4" /> Import {rows.length} Leads</>
              }
            </button>
          </div>

          {/* Preview table */}
          <div className="rounded-xl border border-gray-800 overflow-hidden">
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-900 border-b border-gray-700">
                  <tr>
                    {['Business Name', 'Phone', 'Segment', 'Category', 'Rating', 'Notes'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-gray-500 font-medium uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {rows.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-800/30">
                      <td className="px-3 py-2 text-gray-200 font-medium max-w-[180px] truncate">{row.name}</td>
                      <td className="px-3 py-2 text-gray-400">{row.phone || <span className="text-red-500">—</span>}</td>
                      <td className="px-3 py-2"><SegmentBadge segment={row.segment} /></td>
                      <td className="px-3 py-2 text-gray-500 max-w-[140px] truncate">{row.category}</td>
                      <td className="px-3 py-2">
                        {row.rating > 0 && (
                          <span className={cn('font-bold', row.rating >= 4.5 ? 'text-green-400' : 'text-gray-400')}>
                            {row.rating}★
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-500 max-w-[160px] truncate">{row.existingNotes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Tab: Call Mode ───────────────────────────────────────────────────────────

function CallModeTab() {
  const { user } = useAuth()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [idx, setIdx] = useState(0)
  const [segmentFilter, setSegmentFilter] = useState<'all' | CampaignSegment>('all')
  const [outcomeFilter, setOutcomeFilter] = useState('all')
  const [note, setNote] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [outcome, setOutcome] = useState<string>('answered')
  const [saving, setSaving] = useState(false)
  const [scriptStep, setScriptStep] = useState(0)

  useEffect(() => {
    const q = query(
      collection(db, 'leads'),
      where('businessType', '==', 'b2b'),
      where('source', '==', 'cold_call'),
      orderBy('createdAt', 'desc'),
    )
    const unsub = onSnapshot(q, snap => {
      setLeads(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead))
      setLoading(false)
    })
    return unsub
  }, [])

  const filtered = useMemo(() => leads.filter(l => {
    const la = l as any
    if (segmentFilter !== 'all' && la.campaignSegment !== segmentFilter) return false
    if (outcomeFilter === 'uncalled' && l.status !== 'new') return false
    if (outcomeFilter === 'contacted' && l.status !== 'contacted') return false
    return true
  }), [leads, segmentFilter, outcomeFilter])

  const lead = filtered[idx]
  const segment: CampaignSegment = (lead as any)?.campaignSegment || 'unknown'
  const script = segment === 'interior_design' ? INTERIOR_SCRIPT : ELECTRICAL_SCRIPT

  const logCall = async () => {
    if (!lead) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'leads', lead.id, 'activities'), {
        leadId: lead.id,
        type: 'call',
        description: note.trim() || `Call — ${outcome}`,
        outcome,
        followUpDate: followUp ? Timestamp.fromDate(new Date(followUp)) : null,
        performedBy: user?.id ?? '',
        performedByName: user?.name ?? '',
        createdAt: serverTimestamp(),
      })
      const updates: Record<string, unknown> = { status: 'contacted', updatedAt: serverTimestamp() }
      if (followUp) updates.nextFollowUp = Timestamp.fromDate(new Date(followUp))
      await updateDoc(doc(db, 'leads', lead.id), updates)
      toast.success('Call logged')
      setNote('')
      setFollowUp('')
      setOutcome('answered')
      if (idx < filtered.length - 1) setIdx(i => i + 1)
    } catch {
      toast.error('Failed to log call')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-600 text-sm gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>

  if (leads.length === 0) return (
    <div className="text-center py-20 text-gray-600">
      <Phone className="w-8 h-8 mx-auto mb-3 opacity-30" />
      <p className="text-sm">No B2B leads yet. Import a call list first.</p>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select value={segmentFilter} onChange={e => { setSegmentFilter(e.target.value as any); setIdx(0) }}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none">
          <option value="all">All Segments</option>
          <option value="electrical_trade">Electrical Trade</option>
          <option value="interior_design">Interior & Design</option>
        </select>
        <select value={outcomeFilter} onChange={e => { setOutcomeFilter(e.target.value); setIdx(0) }}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none">
          <option value="all">All Leads</option>
          <option value="uncalled">Uncalled Only</option>
          <option value="contacted">Contacted</option>
        </select>
        <span className="text-xs text-gray-600 ml-auto">{filtered.length > 0 ? `${idx + 1} / ${filtered.length}` : '0'}</span>
      </div>

      {!lead ? (
        <div className="text-center py-16 text-gray-600 text-sm">No leads match these filters.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: Lead card + log */}
          <div className="space-y-4">
            <Card padding="none">
              <div className="p-4 border-b border-gray-800 flex items-start justify-between">
                <div>
                  <p className="text-base font-semibold text-white">{lead.name}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <SegmentBadge segment={segment} />
                    {(lead as any).campaignRating > 0 && (
                      <span className={cn('text-xs font-bold', (lead as any).campaignRating >= 4.5 ? 'text-green-400' : 'text-gray-400')}>
                        {(lead as any).campaignRating}★
                      </span>
                    )}
                  </div>
                </div>
                <span className={cn('text-[10px] px-2 py-1 rounded border',
                  lead.status === 'new' ? 'border-gray-700 text-gray-500' : 'border-green-800 text-green-400 bg-green-900/20'
                )}>{lead.status}</span>
              </div>
              <div className="p-4 space-y-2.5">
                {lead.phone && (
                  <div className="flex items-center gap-3">
                    <Phone className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                    <a href={`tel:${lead.phone}`} className="text-sm text-gray-300 hover:text-white font-medium">{lead.phone}</a>
                    <a href={`https://wa.me/91${lead.phone}`} target="_blank" rel="noopener noreferrer"
                      className="ml-auto text-gray-600 hover:text-green-400 transition-colors">
                      <MessageSquare className="w-4 h-4" />
                    </a>
                  </div>
                )}
                {(lead as any).campaignCategory && (
                  <div className="flex items-start gap-3">
                    <Hash className="w-3.5 h-3.5 text-gray-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-gray-400">{(lead as any).campaignCategory}</p>
                  </div>
                )}
                {lead.address && (
                  <div className="flex items-start gap-3">
                    <MapPin className="w-3.5 h-3.5 text-gray-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-gray-400 line-clamp-2">{lead.address}</p>
                  </div>
                )}
                {(lead as any).campaignWebsite && (
                  <div className="flex items-center gap-3">
                    <Globe className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                    <a href={(lead as any).campaignWebsite} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:underline truncate max-w-[220px]">
                      {(lead as any).campaignWebsite.replace(/^https?:\/\//, '')}
                    </a>
                  </div>
                )}
                {(lead as any).campaignReviews > 0 && (
                  <div className="flex items-center gap-3">
                    <Star className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                    <p className="text-xs text-gray-400">{(lead as any).campaignReviews} Google reviews</p>
                  </div>
                )}
                {/* Existing notes from sheet */}
                {lead.notes && lead.notes.includes('Call Notes:') && (
                  <div className="mt-1 rounded-lg bg-amber-900/20 border border-amber-800 px-3 py-2">
                    <p className="text-[10px] font-bold text-amber-400 mb-0.5">PREV NOTE FROM SHEET</p>
                    <p className="text-xs text-gray-300">{lead.notes.split('Call Notes:')[1]?.trim()}</p>
                  </div>
                )}
              </div>
            </Card>

            {/* Log call form */}
            <Card padding="none">
              <div className="p-4 border-b border-gray-800">
                <p className="text-sm font-semibold text-white">Log Call</p>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Outcome</label>
                  <select value={outcome} onChange={e => setOutcome(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500">
                    <option value="answered">Answered</option>
                    <option value="interested">Interested</option>
                    <option value="catalogue_sent">Catalogue Sent</option>
                    <option value="sample_requested">Sample Requested</option>
                    <option value="callback_requested">Callback Requested</option>
                    <option value="not_interested">Not Interested</option>
                    <option value="ringing">Ringing / No Answer</option>
                    <option value="voicemail">Voicemail</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Notes</label>
                  <textarea value={note} onChange={e => setNote(e.target.value)}
                    placeholder={segment === 'interior_design'
                      ? 'Which brand do they spec? Commission accepted? Project pipeline size?'
                      : 'What brand do they stock? Margin preference? MOQ concern?'}
                    rows={3}
                    className="w-full bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 placeholder-gray-700 resize-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Next Follow-up</label>
                  <input type="date" value={followUp} onChange={e => setFollowUp(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500" />
                </div>
                <button onClick={logCall} disabled={saving}
                  className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  {saving ? 'Saving…' : 'Log & Next'}
                </button>
              </div>
            </Card>

            {/* Prev / Next */}
            <div className="flex items-center gap-3">
              <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
                className="flex-1 py-2 rounded-lg border border-gray-700 text-sm text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-30 transition-colors flex items-center justify-center gap-1">
                <ChevronLeft className="w-4 h-4" /> Prev
              </button>
              <button onClick={() => setIdx(i => Math.min(filtered.length - 1, i + 1))} disabled={idx === filtered.length - 1}
                className="flex-1 py-2 rounded-lg border border-gray-700 text-sm text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-30 transition-colors flex items-center justify-center gap-1">
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Right: Call Script */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {segment === 'interior_design' ? 'Interior & Design Script' : 'Electrical Trade Script'}
              </p>
              <SegmentBadge segment={segment} />
            </div>
            {script.map((step, i) => (
              <div
                key={step.label}
                onClick={() => setScriptStep(i)}
                className={cn(
                  'rounded-xl border p-3 cursor-pointer transition-all',
                  step.bg,
                  scriptStep === i ? 'ring-1 ring-white/20 scale-[1.01]' : 'opacity-70 hover:opacity-90',
                )}
              >
                <p className={cn('text-[10px] font-bold tracking-widest mb-1', step.color)}>{step.label}</p>
                <p className="text-xs text-gray-300 leading-relaxed">{step.script}</p>
              </div>
            ))}

            {segment === 'interior_design' && (
              <div className="rounded-xl border border-purple-800 bg-purple-900/20 p-3">
                <p className="text-[10px] font-bold text-purple-400 tracking-widest mb-1">COMMISSION MODEL</p>
                <p className="text-xs text-gray-300">No stock required. Galaxy delivers to site. Designer earns a referral commission per project. Focus on: aesthetics, finish options, client value vs Phlipton pricing.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Stats ───────────────────────────────────────────────────────────────

function StatsTab() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(collection(db, 'leads'), where('businessType', '==', 'b2b'), where('source', '==', 'cold_call'))
    const unsub = onSnapshot(q, snap => {
      setLeads(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead))
      setLoading(false)
    })
    return unsub
  }, [])

  const stats = useMemo(() => {
    const segMap: Record<string, { total: number; contacted: number }> = {
      electrical_trade: { total: 0, contacted: 0 },
      interior_design:  { total: 0, contacted: 0 },
      unknown:          { total: 0, contacted: 0 },
    }
    const statusMap: Record<string, number> = {}
    let withPhone = 0, highRating = 0

    leads.forEach(l => {
      const la = l as any
      const seg = la.campaignSegment || 'unknown'
      if (!segMap[seg]) segMap[seg] = { total: 0, contacted: 0 }
      segMap[seg].total++
      if (l.status !== 'new') segMap[seg].contacted++
      statusMap[l.status] = (statusMap[l.status] || 0) + 1
      if (l.phone) withPhone++
      if ((la.campaignRating || 0) >= 4.5) highRating++
    })

    return { segMap, statusMap, withPhone, highRating }
  }, [leads])

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-600 text-sm gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>

  const total = leads.length
  const contacted = total - (stats.statusMap['new'] || 0)

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total B2B Leads', value: total, sub: 'Imported', color: 'text-white' },
          { label: 'Contacted', value: contacted, sub: `${total ? Math.round(contacted / total * 100) : 0}% contact rate`, color: 'text-green-400' },
          { label: 'With Phone', value: stats.withPhone, sub: `${total ? Math.round(stats.withPhone / total * 100) : 0}% coverage`, color: 'text-blue-400' },
          { label: 'High Rating (4.5★+)', value: stats.highRating, sub: 'Priority leads', color: 'text-amber-400' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={cn('text-2xl font-bold mt-1', s.color)}>{s.value}</p>
            <p className="text-xs text-gray-600 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Segment breakdown */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { key: 'electrical_trade', label: 'Electrical Trade', sub: 'Reseller / Stockist', color: 'text-blue-400', bg: 'bg-blue-900/10 border-blue-900' },
          { key: 'interior_design',  label: 'Interior & Design', sub: 'Spec / Referral',    color: 'text-purple-400', bg: 'bg-purple-900/10 border-purple-900' },
        ].map(s => {
          const seg = stats.segMap[s.key] || { total: 0, contacted: 0 }
          return (
            <div key={s.key} className={cn('rounded-xl border p-4', s.bg)}>
              <p className={cn('text-xs font-bold', s.color)}>{s.label}</p>
              <p className="text-[10px] text-gray-600 mb-2">{s.sub}</p>
              <p className="text-3xl font-bold text-white">{seg.total}</p>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                  <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${seg.total ? Math.round(seg.contacted / seg.total * 100) : 0}%` }} />
                </div>
                <span className="text-xs text-gray-400">{seg.contacted} contacted</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Status breakdown */}
      <div className="rounded-xl border border-gray-800 p-4">
        <p className="text-sm font-semibold text-white mb-3">Outcome Breakdown</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(stats.statusMap).map(([status, count]) => (
            <div key={status} className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-1.5">
              <span className="text-xs text-gray-400 capitalize">{status.replace(/_/g, ' ')}</span>
              <span className="text-xs font-bold text-white">{count}</span>
            </div>
          ))}
          {Object.keys(stats.statusMap).length === 0 && (
            <p className="text-xs text-gray-600">No calls logged yet</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'import' | 'call' | 'stats'

export function B2BCampaignPage() {
  const [tab, setTab] = useState<Tab>('import')

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'import', label: 'Import Call List', icon: <Upload className="w-4 h-4" /> },
    { id: 'call',   label: 'Call Mode',        icon: <Phone className="w-4 h-4" /> },
    { id: 'stats',  label: 'Stats',            icon: <BarChart2 className="w-4 h-4" /> },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">B2B Campaign</h1>
        <p className="text-sm text-gray-500 mt-0.5">Mumbai lead list — Electrical Trade &amp; Interior &amp; Design segments</p>
      </div>

      <div className="flex gap-1 bg-gray-900 rounded-xl p-1 w-fit border border-gray-800">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              tab === t.id ? 'bg-gray-700 text-white shadow' : 'text-gray-500 hover:text-gray-300',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'import' && <ImportTab />}
      {tab === 'call'   && <CallModeTab />}
      {tab === 'stats'  && <StatsTab />}
    </div>
  )
}
