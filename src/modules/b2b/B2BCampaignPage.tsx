import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Upload, Phone, MessageSquare, ChevronLeft, ChevronRight,
  BarChart2, CheckCircle, XCircle, AlertCircle, Globe,
  MapPin, Star, Hash, Download, Loader2, Filter,
} from 'lucide-react'
import {
  db, collection, addDoc, getDocs, query, where,
  serverTimestamp, updateDoc, doc, onSnapshot, orderBy,
} from '../../lib/firebase'
import { useAuth } from '../../contexts/AuthContext'
import { nextLeadCode } from '../../lib/counters'
import { cn } from '../../lib/utils'
import { Timestamp } from 'firebase/firestore'
import toast from 'react-hot-toast'
import type { Lead, LeadActivity } from '../../types'
import { Card } from '../../components/ui/Card'

// ─── Types ────────────────────────────────────────────────────────────────────

type CampaignModel = 'M1_Direct' | 'M2_Channel' | 'Unknown'

interface ScrapedRow {
  name: string
  phone: string
  address: string
  category: string
  website: string
  link: string
  rating: number
  reviews: number
  city: string
  model: CampaignModel
}

// ─── City detection (mirrors make_call_list.py) ───────────────────────────────

const CITY_KEYWORDS: Record<string, string[]> = {
  Bangalore:  ['bangalore', 'bengaluru', 'bengalur'],
  Hyderabad:  ['hyderabad', 'secunderabad', 'cyberabad'],
  Surat:      ['surat'],
  Coimbatore: ['coimbatore', 'kovai'],
  Jaipur:     ['jaipur'],
  Nashik:     ['nashik', 'nasik'],
  Mumbai:     ['mumbai', 'bombay'],
  Pune:       ['pune'],
  Indore:     ['indore'],
  Kochi:      ['kochi', 'cochin'],
  Chandigarh: ['chandigarh'],
  Lucknow:    ['lucknow'],
  Nagpur:     ['nagpur'],
}

const M1_CITIES = new Set(['Bangalore', 'Hyderabad', 'Mumbai', 'Pune'])
const M2_CITIES = new Set(['Surat', 'Coimbatore', 'Jaipur', 'Nashik', 'Indore', 'Kochi', 'Chandigarh', 'Lucknow', 'Nagpur'])

function detectCity(address: string): string {
  const txt = address.toLowerCase()
  for (const [city, kws] of Object.entries(CITY_KEYWORDS)) {
    if (kws.some(k => txt.includes(k))) return city
  }
  return 'Other'
}

function detectModel(city: string): CampaignModel {
  if (M1_CITIES.has(city)) return 'M1_Direct'
  if (M2_CITIES.has(city)) return 'M2_Channel'
  return 'Unknown'
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

// ─── CSV parser (handles gosom output + processed call list) ─────────────────

function parseCSV(text: string): ScrapedRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''))

  const col = (row: string[], ...names: string[]) => {
    for (const n of names) {
      const i = headers.indexOf(n)
      if (i !== -1) return (row[i] ?? '').replace(/"/g, '').trim()
    }
    return ''
  }

  // simple CSV split respecting quoted fields
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
  for (let i = 1; i < lines.length; i++) {
    const r = splitRow(lines[i])
    const name = col(r, 'title', 'business name', 'name')
    if (!name) continue
    const address = col(r, 'address')
    const city = col(r, 'city') || detectCity(address)
    const model = (col(r, 'model') as CampaignModel) || detectModel(city)
    rows.push({
      name,
      phone: normalisePhone(col(r, 'phone')),
      address,
      category: col(r, 'category'),
      website: col(r, 'website'),
      link: col(r, 'link'),
      rating: parseFloat(col(r, 'rating', 'review_rating') || '0') || 0,
      reviews: parseInt(col(r, 'reviews', 'review_count') || '0') || 0,
      city,
      model,
    })
  }
  return rows
}

// ─── Call Script ──────────────────────────────────────────────────────────────

const CALL_SCRIPT_STEPS = [
  {
    label: 'OPEN',
    color: 'text-blue-400',
    bg: 'bg-blue-900/20 border-blue-800',
    script: 'Hi, am I speaking with [Name]? I\'m calling from Galaxy Home Automation. We\'re launching a smart switch line called Elysia — premium finish panels at B2B trade pricing. Do you have 2 minutes?',
  },
  {
    label: 'QUALIFY',
    color: 'text-purple-400',
    bg: 'bg-purple-900/20 border-purple-800',
    script: '"What smart switch brands are you currently fitting / stocking?" — Listen for: Phlipton, Wipro, no brand / grey imports.',
  },
  {
    label: 'PAIN',
    color: 'text-amber-400',
    bg: 'bg-amber-900/20 border-amber-800',
    script: '"What\'s your biggest frustration with the current product? Warranty? Price? Delivery time?" — Phlipton\'s finish premium is ₹750–970. Ours is ₹160–264. Mention this if they bring up price.',
  },
  {
    label: 'INTEREST',
    color: 'text-green-400',
    bg: 'bg-green-900/20 border-green-800',
    script: '"We do 4-touch and 8-touch in PC / Glass / Aluminium. B2B price ₹1,375–2,070 with a 2-year replacement warranty. Interested in a sample?"',
  },
  {
    label: 'CLOSE',
    color: 'text-gold-400',
    bg: 'bg-yellow-900/20 border-yellow-800',
    script: '"Can I WhatsApp you our pricelist and send a demo panel? Takes 30 seconds on your end." → Get WhatsApp number.',
  },
  {
    label: 'DISTRIBUTOR',
    color: 'text-rose-400',
    bg: 'bg-rose-900/20 border-rose-800',
    script: 'For channel cities (Surat/Coimbatore/Jaipur/Nashik): "We\'re looking for an exclusive distributor for [city]. MRP ₹3,200, your margin is 30–42%, and we support with co-op marketing. Interested in a 15-min call?"',
  },
]

// ─── Tab: Import ──────────────────────────────────────────────────────────────

function ImportTab() {
  const { user } = useAuth()
  const [rows, setRows] = useState<ScrapedRow[]>([])
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [cityFilter, setCityFilter] = useState('all')
  const [done, setDone] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const cities = useMemo(() => Array.from(new Set(rows.map(r => r.city))).sort(), [rows])

  const filtered = useMemo(() =>
    cityFilter === 'all' ? rows : rows.filter(r => r.city === cityFilter),
  [rows, cityFilter])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const parsed = parseCSV(text)
      setRows(parsed)
      setDone(false)
      setProgress(0)
      if (parsed.length === 0) toast.error('No rows found — check CSV format')
      else toast.success(`Parsed ${parsed.length} rows from ${file.name}`)
    }
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  const handleImport = async () => {
    if (!filtered.length) return
    setImporting(true)
    setProgress(0)

    // fetch existing phones to skip dups
    const existingSnap = await getDocs(collection(db, 'leads'))
    const existingPhones = new Set(existingSnap.docs.map(d => d.data().phone))

    let created = 0, skipped = 0
    for (let i = 0; i < filtered.length; i++) {
      const row = filtered[i]
      const phone = row.phone
      if (!phone || existingPhones.has(phone)) { skipped++; setProgress(Math.round((i + 1) / filtered.length * 100)); continue }

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
          ].filter(Boolean).join(' | ') || null,
          campaignCity: row.city,
          campaignModel: row.model,
          campaignRating: row.rating || null,
          campaignReviews: row.reviews || null,
          campaignCategory: row.category || null,
          campaignWebsite: row.website || null,
          campaignLink: row.link || null,
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
      setProgress(Math.round((i + 1) / filtered.length * 100))
    }
    setImporting(false)
    setDone(true)
    toast.success(`Imported ${created} leads${skipped ? `, skipped ${skipped} duplicates` : ''}`)
  }

  const cityStats = useMemo(() => {
    const map: Record<string, { count: number; model: string; withPhone: number }> = {}
    rows.forEach(r => {
      if (!map[r.city]) map[r.city] = { count: 0, model: r.model, withPhone: 0 }
      map[r.city].count++
      if (r.phone) map[r.city].withPhone++
    })
    return Object.entries(map).sort((a, b) => b[1].count - a[1].count)
  }, [rows])

  return (
    <div className="space-y-5">
      {/* Upload zone */}
      <div
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-gray-700 hover:border-gold-500/50 rounded-xl p-10 text-center cursor-pointer transition-colors group"
      >
        <Upload className="w-8 h-8 text-gray-600 group-hover:text-gold-500 mx-auto mb-3 transition-colors" />
        <p className="text-sm font-medium text-gray-300">Drop CSV here or click to browse</p>
        <p className="text-xs text-gray-600 mt-1">
          Accepts <span className="text-gray-400">raw_direct.csv</span>,{' '}
          <span className="text-gray-400">raw_channel.csv</span>, or{' '}
          <span className="text-gray-400">Elysia_Call_List.csv</span> from the scraper
        </p>
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
      </div>

      {rows.length > 0 && (
        <>
          {/* City breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {cityStats.map(([city, { count, model, withPhone }]) => (
              <div key={city} className={cn(
                'rounded-xl p-3 border cursor-pointer transition-colors',
                cityFilter === city ? 'border-gold-500 bg-gold-500/10' : 'border-gray-800 hover:border-gray-700',
                model === 'M1_Direct' ? 'bg-blue-900/10' : model === 'M2_Channel' ? 'bg-amber-900/10' : 'bg-gray-900/10',
              )} onClick={() => setCityFilter(c => c === city ? 'all' : city)}>
                <p className="text-xs font-semibold text-gray-200">{city}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{model === 'M1_Direct' ? 'M1 Direct' : model === 'M2_Channel' ? 'M2 Channel' : 'Other'}</p>
                <p className="text-lg font-bold text-white mt-1">{count}</p>
                <p className="text-[10px] text-gray-600">{withPhone} with phone</p>
              </div>
            ))}
          </div>

          {/* Filter + action row */}
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={cityFilter}
              onChange={e => setCityFilter(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none"
            >
              <option value="all">All Cities ({rows.length})</option>
              {cities.map(c => <option key={c} value={c}>{c} ({rows.filter(r => r.city === c).length})</option>)}
            </select>

            <div className="ml-auto flex items-center gap-3">
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
                  : <><Upload className="w-4 h-4" /> Import {filtered.length} Leads</>
                }
              </button>
            </div>
          </div>

          {/* Preview table */}
          <div className="rounded-xl border border-gray-800 overflow-hidden">
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-900 border-b border-gray-700">
                  <tr>
                    {['Business Name', 'Phone', 'City', 'Model', 'Category', 'Rating', 'Website'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-gray-500 font-medium uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {filtered.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-800/30">
                      <td className="px-3 py-2 text-gray-200 font-medium max-w-[180px] truncate">{row.name}</td>
                      <td className="px-3 py-2 text-gray-400">{row.phone || <span className="text-red-500">—</span>}</td>
                      <td className="px-3 py-2 text-gray-400">{row.city}</td>
                      <td className="px-3 py-2">
                        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium',
                          row.model === 'M1_Direct' ? 'bg-blue-900/40 text-blue-400' :
                          row.model === 'M2_Channel' ? 'bg-amber-900/40 text-amber-400' : 'bg-gray-800 text-gray-500'
                        )}>{row.model}</span>
                      </td>
                      <td className="px-3 py-2 text-gray-500 max-w-[140px] truncate">{row.category}</td>
                      <td className="px-3 py-2">
                        {row.rating > 0 && (
                          <span className={cn('font-bold', row.rating >= 4.5 ? 'text-green-400' : 'text-gray-400')}>
                            {row.rating}★
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-blue-400 max-w-[160px] truncate">
                        {row.website ? <a href={row.website} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="hover:underline">{row.website.replace(/^https?:\/\//, '')}</a> : '—'}
                      </td>
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
  const [cityFilter, setCityFilter] = useState('all')
  const [modelFilter, setModelFilter] = useState('all')
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

  const cities = useMemo(() => Array.from(new Set(leads.map(l => (l as any).campaignCity).filter(Boolean))).sort(), [leads])

  const filtered = useMemo(() => leads.filter(l => {
    const la = l as any
    if (cityFilter !== 'all' && la.campaignCity !== cityFilter) return false
    if (modelFilter !== 'all' && la.campaignModel !== modelFilter) return false
    if (outcomeFilter === 'uncalled' && l.status !== 'new') return false
    if (outcomeFilter === 'contacted' && l.status !== 'contacted') return false
    return true
  }), [leads, cityFilter, modelFilter, outcomeFilter])

  const lead = filtered[idx]

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
      const updates: Record<string, unknown> = {
        status: 'contacted',
        updatedAt: serverTimestamp(),
      }
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
        <select value={cityFilter} onChange={e => { setCityFilter(e.target.value); setIdx(0) }}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none">
          <option value="all">All Cities</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={modelFilter} onChange={e => { setModelFilter(e.target.value); setIdx(0) }}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none">
          <option value="all">All Models</option>
          <option value="M1_Direct">M1 Direct</option>
          <option value="M2_Channel">M2 Channel</option>
        </select>
        <select value={outcomeFilter} onChange={e => { setOutcomeFilter(e.target.value); setIdx(0) }}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none">
          <option value="all">All Leads</option>
          <option value="uncalled">Uncalled Only</option>
          <option value="contacted">Contacted</option>
        </select>
        <span className="text-xs text-gray-600 ml-auto">{idx + 1} / {filtered.length}</span>
      </div>

      {!lead ? (
        <div className="text-center py-16 text-gray-600 text-sm">No leads match these filters.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: Lead card */}
          <div className="space-y-4">
            <Card padding="none">
              <div className="p-4 border-b border-gray-800 flex items-start justify-between">
                <div>
                  <p className="text-base font-semibold text-white">{lead.name}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={cn('text-[10px] px-2 py-0.5 rounded font-medium',
                      (lead as any).campaignModel === 'M1_Direct' ? 'bg-blue-900/40 text-blue-400' : 'bg-amber-900/40 text-amber-400'
                    )}>{(lead as any).campaignModel}</span>
                    {(lead as any).campaignCity && <span className="text-xs text-gray-500">{(lead as any).campaignCity}</span>}
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
                    <option value="callback_requested">Callback Requested</option>
                    <option value="not_interested">Not Interested</option>
                    <option value="ringing">Ringing / No Answer</option>
                    <option value="voicemail">Voicemail</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Notes</label>
                  <textarea value={note} onChange={e => setNote(e.target.value)}
                    placeholder="What did they say? Any competitor mentioned? Budget range?"
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
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Call Script — 5 min validation</p>
            {CALL_SCRIPT_STEPS.map((step, i) => (
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

            {/* M2 note */}
            {(lead as any).campaignModel === 'M2_Channel' && (
              <div className="rounded-xl border border-rose-800 bg-rose-900/20 p-3">
                <p className="text-[10px] font-bold text-rose-400 tracking-widest mb-1">M2 DISTRIBUTOR PITCH</p>
                <p className="text-xs text-gray-300">This is a <strong>channel city</strong> ({(lead as any).campaignCity}). Lead with the exclusive distributor offer — 30–42% margin, co-op marketing support.</p>
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
    const cityMap: Record<string, { total: number; contacted: number; model: string }> = {}
    const modelMap: Record<string, number> = { M1_Direct: 0, M2_Channel: 0, Unknown: 0 }
    const statusMap: Record<string, number> = {}
    let withPhone = 0, highRating = 0

    leads.forEach(l => {
      const la = l as any
      const city = la.campaignCity || 'Other'
      const model = la.campaignModel || 'Unknown'
      if (!cityMap[city]) cityMap[city] = { total: 0, contacted: 0, model }
      cityMap[city].total++
      if (l.status !== 'new') cityMap[city].contacted++
      modelMap[model] = (modelMap[model] || 0) + 1
      statusMap[l.status] = (statusMap[l.status] || 0) + 1
      if (l.phone) withPhone++
      if ((la.campaignRating || 0) >= 4.5) highRating++
    })

    return { cityMap, modelMap, statusMap, withPhone, highRating }
  }, [leads])

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-600 text-sm gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>

  const total = leads.length
  const contacted = total - (stats.statusMap['new'] || 0)

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total B2B Leads', value: total, sub: 'Imported', color: 'text-white' },
          { label: 'Contacted', value: contacted, sub: `${total ? Math.round(contacted / total * 100) : 0}% of total`, color: 'text-green-400' },
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

      {/* City breakdown */}
      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-4 py-3 bg-gray-800/40 border-b border-gray-800">
          <p className="text-sm font-semibold text-white">City Breakdown</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              {['City', 'Model', 'Total', 'Contacted', 'Contact Rate'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs text-gray-500 font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {Object.entries(stats.cityMap).sort((a, b) => b[1].total - a[1].total).map(([city, s]) => (
              <tr key={city} className="hover:bg-gray-800/20">
                <td className="px-4 py-2.5 text-gray-200 font-medium">{city}</td>
                <td className="px-4 py-2.5">
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium',
                    s.model === 'M1_Direct' ? 'bg-blue-900/40 text-blue-400' :
                    s.model === 'M2_Channel' ? 'bg-amber-900/40 text-amber-400' : 'bg-gray-800 text-gray-500'
                  )}>{s.model}</span>
                </td>
                <td className="px-4 py-2.5 text-gray-300">{s.total}</td>
                <td className="px-4 py-2.5 text-green-400">{s.contacted}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-800 rounded-full h-1.5 max-w-[80px]">
                      <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${s.total ? Math.round(s.contacted / s.total * 100) : 0}%` }} />
                    </div>
                    <span className="text-xs text-gray-400">{s.total ? Math.round(s.contacted / s.total * 100) : 0}%</span>
                  </div>
                </td>
              </tr>
            ))}
            {Object.keys(stats.cityMap).length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-600 text-xs">No data yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Status breakdown */}
      <div className="rounded-xl border border-gray-800 p-4">
        <p className="text-sm font-semibold text-white mb-3">Lead Status Breakdown</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(stats.statusMap).map(([status, count]) => (
            <div key={status} className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-1.5">
              <span className="text-xs text-gray-400 capitalize">{status.replace('_', ' ')}</span>
              <span className="text-xs font-bold text-white">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* M1 vs M2 */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'M1 Direct', key: 'M1_Direct', color: 'text-blue-400', bg: 'bg-blue-900/10 border-blue-900', desc: 'Bangalore, Hyderabad, Mumbai, Pune' },
          { label: 'M2 Channel', key: 'M2_Channel', color: 'text-amber-400', bg: 'bg-amber-900/10 border-amber-900', desc: 'Surat, Coimbatore, Jaipur, Nashik…' },
        ].map(m => (
          <div key={m.key} className={cn('rounded-xl border p-4', m.bg)}>
            <p className={cn('text-xs font-bold', m.color)}>{m.label}</p>
            <p className="text-3xl font-bold text-white mt-1">{stats.modelMap[m.key] || 0}</p>
            <p className="text-xs text-gray-600 mt-1">{m.desc}</p>
          </div>
        ))}
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
        <p className="text-sm text-gray-500 mt-0.5">Import scraped leads, run your call session, track outcomes</p>
      </div>

      {/* Tabs */}
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
