import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Upload, Phone, MessageSquare, ChevronLeft, ChevronRight,
  BarChart2, CheckCircle, Globe, MapPin, Star, Hash,
  Loader2, Zap, Palette, List, ExternalLink,
} from 'lucide-react'
import {
  db, collection, addDoc, getDocs,
  serverTimestamp, updateDoc, doc, onSnapshot,
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

type CampaignModel   = 'M1_Direct' | 'M2_Channel' | 'Unknown'
type CampaignSegment = 'electrical_trade' | 'interior_design' | 'unknown'

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
  segment: CampaignSegment
  existingNotes: string
}

// ─── City / Model detection (mirrors make_call_list.py) ──────────────────────

const CITY_KEYWORDS: Record<string, string[]> = {
  Bangalore:  ['bangalore', 'bengaluru', 'bengalur'],
  Hyderabad:  ['hyderabad', 'secunderabad', 'cyberabad'],
  Surat:      ['surat'],
  Coimbatore: ['coimbatore', 'kovai'],
  Jaipur:     ['jaipur'],
  Nashik:     ['nashik', 'nasik'],
  Mumbai:     ['mumbai', 'bombay', 'navi mumbai'],
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

// ─── Segment detection from category (for Mumbai sheet) ──────────────────────

const ELECTRICAL_KW = ['electrician', 'electrical', 'hardware', 'automation', 'electric', 'wiring', 'switchgear', 'contractor']
const INTERIOR_KW   = ['interior', 'architect', 'design', 'decorator', 'construction', 'renovation', 'turnkey']

function detectSegment(category: string): CampaignSegment {
  const c = category.toLowerCase()
  if (ELECTRICAL_KW.some(k => c.includes(k))) return 'electrical_trade'
  if (INTERIOR_KW.some(k => c.includes(k)))   return 'interior_design'
  return 'unknown'
}

function normalisePhone(p: string): string {
  if (!p) return ''
  const d = p.replace(/\D/g, '')
  let clean = d
  if (clean.startsWith('91') && clean.length === 12) clean = clean.slice(2)
  if (clean.startsWith('0')  && clean.length === 11) clean = clean.slice(1)
  if (clean.length === 10 && '6789'.includes(clean[0])) return clean
  return d.length >= 10 ? d.slice(-10) : p
}

// ─── CSV parser — handles both raw scraper CSV and processed Mumbai sheet ─────

function parseCSV(text: string, forcedSegment: CampaignSegment | 'auto', forcedCity: string | 'auto'): ScrapedRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

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
    const name = col(r, 'title', 'business name', 'name')
    if (!name) continue
    const address  = col(r, 'address')
    const category = col(r, 'category')
    const city     = forcedCity !== 'auto' ? forcedCity : (col(r, 'city') || detectCity(address))
    const model    = (col(r, 'model') as CampaignModel) || detectModel(city)
    const segment  = forcedSegment !== 'auto' ? forcedSegment : detectSegment(category)
    rows.push({
      name,
      phone:         normalisePhone(col(r, 'phone')),
      address,
      category,
      website:       col(r, 'website'),
      link:          col(r, 'link'),
      rating:        parseFloat(col(r, 'review_rating', 'rating') || '0') || 0,
      reviews:       parseInt(col(r, 'review_count', 'reviews') || '0') || 0,
      city,
      model,
      segment,
      existingNotes: col(r, 'call notes', 'call_notes', 'notes'),
    })
  }
  return rows
}

// ─── Call Scripts ─────────────────────────────────────────────────────────────

const DIRECT_SCRIPT = [
  {
    label: 'OPEN', color: 'text-blue-400', bg: 'bg-blue-900/20 border-blue-800',
    script: "Hi, am I speaking with [Name]? I'm calling from Galaxy Home Automation. We're launching a smart switch line called Elysia — premium finish panels at B2B trade pricing. Do you have 2 minutes?",
  },
  {
    label: 'QUALIFY', color: 'text-purple-400', bg: 'bg-purple-900/20 border-purple-800',
    script: '"What smart switch brands are you currently fitting / stocking?" — Listen for: Phlipton, Wipro, no brand / grey imports.',
  },
  {
    label: 'PAIN', color: 'text-amber-400', bg: 'bg-amber-900/20 border-amber-800',
    script: '"What\'s your biggest frustration with the current product? Warranty? Price? Delivery time?" — Phlipton\'s finish premium is ₹750–970. Ours is ₹160–264. Mention this if they bring up price.',
  },
  {
    label: 'INTEREST', color: 'text-green-400', bg: 'bg-green-900/20 border-green-800',
    script: '"We do 4-touch and 8-touch in PC / Glass / Aluminium. B2B price ₹1,375–2,070 with a 2-year replacement warranty. Interested in a sample?"',
  },
  {
    label: 'CLOSE', color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-800',
    script: '"Can I WhatsApp you our pricelist and send a demo panel? Takes 30 seconds on your end." → Get WhatsApp number.',
  },
]

const DISTRIBUTOR_SCRIPT = [
  {
    label: 'OPEN', color: 'text-blue-400', bg: 'bg-blue-900/20 border-blue-800',
    script: "Hi, am I speaking with [Name]? I'm calling from Galaxy Home Automation. We're launching a smart switch brand called Elysia and looking for an exclusive distributor in [city]. Do you have 2 minutes?",
  },
  {
    label: 'QUALIFY', color: 'text-purple-400', bg: 'bg-purple-900/20 border-purple-800',
    script: '"What electrical brands do you currently distribute?" — Listen for Havells, Legrand, Wipro. Ask about their reach: how many retailers / electricians do they supply?',
  },
  {
    label: 'PAIN', color: 'text-amber-400', bg: 'bg-amber-900/20 border-amber-800',
    script: '"What margins are you getting on smart switches currently?" — Most distributors get 15–22%. Our margin is 30–42% at MRP ₹3,200. Mention this if they ask.',
  },
  {
    label: 'PITCH', color: 'text-green-400', bg: 'bg-green-900/20 border-green-800',
    script: '"We offer exclusive territory rights for [city], 30–42% margin, co-op marketing support, and initial display stock at no cost. MOQ is 25 units to start."',
  },
  {
    label: 'CLOSE', color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-800',
    script: '"Can I WhatsApp you our distributor deck? And can we schedule a 15-minute call this week?" → Get WhatsApp + best time for call.',
  },
]

const INTERIOR_SCRIPT = [
  {
    label: 'OPEN', color: 'text-blue-400', bg: 'bg-blue-900/20 border-blue-800',
    script: "Hi, am I speaking with [Name]? I'm calling from Galaxy Home Automation. We've launched Elysia — a premium smart switch range designed for luxury residential interiors. Do you spec smart switches for your projects?",
  },
  {
    label: 'QUALIFY', color: 'text-purple-400', bg: 'bg-purple-900/20 border-purple-800',
    script: '"What smart switch brands do you usually specify?" — Listen for Phlipton, Legrand, Lutron. Position Elysia as equal finish quality at a fraction of the cost, giving clients better value and you a referral commission.',
  },
  {
    label: 'PAIN', color: 'text-amber-400', bg: 'bg-amber-900/20 border-amber-800',
    script: '"Is your client ever price-sensitive about switches?" — Our GSP on a 3BHK is often ₹30,000–50,000 cheaper than Phlipton for the same finish quality.',
  },
  {
    label: 'PITCH', color: 'text-green-400', bg: 'bg-green-900/20 border-green-800',
    script: '"Elysia comes in 4-touch & 8-touch Glass / PC / Aluminium — perfect for luxury interiors. We offer referral commission on every project. No stock needed — we deliver to site."',
  },
  {
    label: 'CLOSE', color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-800',
    script: '"Can I WhatsApp you the catalogue and arrange a sample panel for your studio?" → Confirm WhatsApp + studio address.',
  },
]

function getScript(model: CampaignModel, segment: CampaignSegment) {
  if (segment === 'interior_design') return { script: INTERIOR_SCRIPT, label: 'Interior & Design Script' }
  if (model === 'M2_Channel')        return { script: DISTRIBUTOR_SCRIPT, label: 'M2 Distributor Script' }
  return { script: DIRECT_SCRIPT, label: 'M1 Direct Script' }
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function ModelBadge({ model }: { model: CampaignModel }) {
  if (model === 'M1_Direct')  return <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-blue-900/40 text-blue-400">M1 Direct</span>
  if (model === 'M2_Channel') return <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-amber-900/40 text-amber-400">M2 Channel</span>
  return <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-gray-800 text-gray-500">Unknown</span>
}

function SegmentBadge({ segment }: { segment: CampaignSegment }) {
  if (segment === 'electrical_trade') return <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-medium bg-blue-900/30 text-blue-300"><Zap className="w-2.5 h-2.5" /> Electrical</span>
  if (segment === 'interior_design')  return <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-medium bg-purple-900/40 text-purple-400"><Palette className="w-2.5 h-2.5" /> Interior</span>
  return null
}

// ─── Session cache ────────────────────────────────────────────────────────────

const SESSION_KEY = 'b2b_import_rows'

// ─── Tab: Import ──────────────────────────────────────────────────────────────

function ImportTab() {
  const { user } = useAuth()
  const [rows, setRows] = useState<ScrapedRow[]>(() => {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '[]') } catch { return [] }
  })
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState(false)
  const [forcedSegment, setForcedSegment] = useState<CampaignSegment | 'auto'>('auto')
  const [forcedCity, setForcedCity] = useState<string>('auto')
  const fileRef = useRef<HTMLInputElement>(null)

  const cityStats = useMemo(() => {
    const map: Record<string, { count: number; model: CampaignModel; withPhone: number }> = {}
    rows.forEach(r => {
      if (!map[r.city]) map[r.city] = { count: 0, model: r.model, withPhone: 0 }
      map[r.city].count++
      if (r.phone) map[r.city].withPhone++
    })
    return Object.entries(map).sort((a, b) => b[1].count - a[1].count)
  }, [rows])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const parsed = parseCSV(text, forcedSegment, forcedCity)
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
          status:        'new',
          source:        'cold_call',
          businessType:  'b2b',
          name:          row.name,
          phone,
          address:       row.address || null,
          notes: [
            row.category,
            row.rating   ? `Rating: ${row.rating}★ (${row.reviews} reviews)` : '',
            row.website  ? `Website: ${row.website}` : '',
            row.existingNotes ? `Call Notes: ${row.existingNotes}` : '',
          ].filter(Boolean).join(' | ') || null,
          campaignCity:     row.city,
          campaignModel:    row.model,
          campaignSegment:  row.segment,
          campaignRating:   row.rating   || null,
          campaignReviews:  row.reviews  || null,
          campaignCategory: row.category || null,
          campaignWebsite:  row.website  || null,
          campaignLink:     row.link     || null,
          assignedTo:       user?.id     ?? '',
          assignedToName:   user?.name   ?? null,
          aiScore: Math.min(100, Math.round(30 + (row.rating / 5) * 40 + (row.reviews > 50 ? 15 : row.reviews > 10 ? 8 : 0))),
          demoGiven:  false,
          createdBy:  user?.id ?? '',
          createdAt:  serverTimestamp(),
          updatedAt:  serverTimestamp(),
        })
        existingPhones.add(phone)
        created++
      } catch { /* skip */ }
      setProgress(Math.round((i + 1) / rows.length * 100))
    }
    setImporting(false)
    setDone(true)
    toast.success(`Imported ${created} leads${skipped ? `, skipped ${skipped} duplicates` : ''}`)
  }

  const ALL_CITIES = ['auto', 'Bangalore', 'Hyderabad', 'Surat', 'Coimbatore', 'Jaipur', 'Nashik', 'Mumbai', 'Pune', 'Indore', 'Kochi', 'Chandigarh', 'Lucknow', 'Nagpur']

  return (
    <div className="space-y-5">
      {/* Config row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl border border-gray-800 bg-gray-900/40">
        <div>
          <p className="text-xs text-gray-500 mb-2 font-medium">Segment (for Mumbai-style sheets)</p>
          <div className="flex flex-wrap gap-2">
            {([['auto', 'Auto-detect'], ['electrical_trade', 'Electrical Trade'], ['interior_design', 'Interior & Design']] as const).map(([val, label]) => (
              <button key={val} onClick={() => setForcedSegment(val)}
                className={cn('px-3 py-1 rounded-lg text-xs font-medium border transition-colors',
                  forcedSegment === val ? 'border-gold-500 bg-gold-500/10 text-gold-400' : 'border-gray-700 text-gray-500 hover:border-gray-600'
                )}>{label}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-2 font-medium">City override (if address detection fails)</p>
          <select value={forcedCity} onChange={e => setForcedCity(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-1.5 focus:outline-none w-full">
            {ALL_CITIES.map(c => <option key={c} value={c}>{c === 'auto' ? 'Auto-detect from address' : c}</option>)}
          </select>
        </div>
      </div>

      {/* Upload zone */}
      <div onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-gray-700 hover:border-gold-500/50 rounded-xl p-10 text-center cursor-pointer transition-colors group">
        <Upload className="w-8 h-8 text-gray-600 group-hover:text-gold-500 mx-auto mb-3 transition-colors" />
        <p className="text-sm font-medium text-gray-300">Drop CSV here or click to browse</p>
        <p className="text-xs text-gray-600 mt-1">
          Accepts <span className="text-gray-400">raw_direct.csv</span> · <span className="text-gray-400">raw_channel.csv</span> · or Mumbai sheet CSV export
        </p>
        <p className="text-xs text-gray-700 mt-0.5">Columns auto-detected: title/Business Name, phone, address, category, rating, reviews, website</p>
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
      </div>

      {rows.length > 0 && (
        <>
          {/* City breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {cityStats.map(([city, { count, model, withPhone }]) => (
              <div key={city} className={cn('rounded-xl p-3 border',
                model === 'M1_Direct'  ? 'border-blue-900 bg-blue-900/10'  :
                model === 'M2_Channel' ? 'border-amber-900 bg-amber-900/10' : 'border-gray-800'
              )}>
                <p className="text-xs font-semibold text-gray-200">{city}</p>
                <ModelBadge model={model} />
                <p className="text-xl font-bold text-white mt-1">{count}</p>
                <p className="text-[10px] text-gray-600">{withPhone} with phone</p>
              </div>
            ))}
          </div>

          {/* Action */}
          <div className="flex items-center justify-end gap-3">
            {done && <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Import complete</span>}
            <button onClick={handleImport} disabled={importing || done}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gold-500 text-black text-sm font-semibold hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {importing ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing… {progress}%</>
               : done    ? <><CheckCircle className="w-4 h-4" /> Done</>
               : <><Upload className="w-4 h-4" /> Import {rows.length} Leads</>}
            </button>
          </div>

          {/* Preview table */}
          <div className="rounded-xl border border-gray-800 overflow-hidden">
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-900 border-b border-gray-700">
                  <tr>
                    {['Business Name', 'Phone', 'City', 'Model', 'Category', 'Rating', 'Notes'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-gray-500 font-medium uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {rows.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-800/30">
                      <td className="px-3 py-2 text-gray-200 font-medium max-w-[180px] truncate">{row.name}</td>
                      <td className="px-3 py-2 text-gray-400">{row.phone || <span className="text-red-500">—</span>}</td>
                      <td className="px-3 py-2 text-gray-400">{row.city}</td>
                      <td className="px-3 py-2"><ModelBadge model={row.model} /></td>
                      <td className="px-3 py-2 text-gray-500 max-w-[140px] truncate">{row.category}</td>
                      <td className="px-3 py-2">
                        {row.rating > 0 && <span className={cn('font-bold', row.rating >= 4.5 ? 'text-green-400' : 'text-gray-400')}>{row.rating}★</span>}
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

// ─── Shared leads fetcher hook ────────────────────────────────────────────────

function useB2BLeads() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const q = query(collection(db, 'leads'), where('businessType', '==', 'b2b'))
    const unsub = onSnapshot(q, snap => {
      setLeads(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead).filter(l => (l as any).source === 'cold_call'))
      setLoading(false)
    })
    return unsub
  }, [])
  return { leads, loading }
}

// ─── Tab: All Leads ───────────────────────────────────────────────────────────

function LeadsListTab() {
  const { leads, loading } = useB2BLeads()
  const [cityFilter, setCityFilter]       = useState('all')
  const [modelFilter, setModelFilter]     = useState('all')
  const [statusFilter, setStatusFilter]   = useState('all')
  const [search, setSearch]               = useState('')

  const cities = useMemo(() => Array.from(new Set(leads.map(l => (l as any).campaignCity).filter(Boolean))).sort(), [leads])

  const filtered = useMemo(() => leads.filter(l => {
    const la = l as any
    if (cityFilter   !== 'all' && la.campaignCity  !== cityFilter)  return false
    if (modelFilter  !== 'all' && la.campaignModel !== modelFilter)  return false
    if (statusFilter !== 'all' && l.status         !== statusFilter) return false
    if (search) {
      const s = search.toLowerCase()
      if (!l.name?.toLowerCase().includes(s) && !l.phone?.includes(s) && !la.campaignCategory?.toLowerCase().includes(s)) return false
    }
    return true
  }).sort((a, b) => ((b as any).campaignRating || 0) - ((a as any).campaignRating || 0)), [leads, cityFilter, modelFilter, statusFilter, search])

  const STATUS_COLORS: Record<string, string> = {
    new: 'bg-gray-800 text-gray-400', contacted: 'bg-blue-900/40 text-blue-400',
    interested: 'bg-green-900/40 text-green-400', not_interested: 'bg-red-900/40 text-red-400',
    qualified: 'bg-purple-900/40 text-purple-400', won: 'bg-yellow-900/40 text-yellow-400',
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-600 text-sm gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, phone, category…"
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none w-52 placeholder-gray-600" />
        <select value={cityFilter} onChange={e => setCityFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none">
          <option value="all">All Cities</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={modelFilter} onChange={e => setModelFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none">
          <option value="all">M1 + M2</option>
          <option value="M1_Direct">M1 Direct</option>
          <option value="M2_Channel">M2 Channel</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none">
          <option value="all">All Status</option>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="interested">Interested</option>
          <option value="not_interested">Not Interested</option>
        </select>
        <span className="text-xs text-gray-600 ml-auto">{filtered.length} leads</span>
      </div>

      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-900 border-b border-gray-700">
              <tr>
                {['Business Name', 'Phone', 'City', 'Model', 'Category', 'Rating', 'Status', ''].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-gray-500 font-medium uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map(lead => {
                const la = lead as any
                return (
                  <tr key={lead.id} className="hover:bg-gray-800/30">
                    <td className="px-3 py-2.5 text-gray-200 font-medium max-w-[200px] truncate">{lead.name}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">{lead.phone || '—'}</span>
                        {lead.phone && <a href={`https://wa.me/91${lead.phone}`} target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-green-400"><MessageSquare className="w-3 h-3" /></a>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-400">{la.campaignCity || '—'}</td>
                    <td className="px-3 py-2.5"><ModelBadge model={la.campaignModel || 'Unknown'} /></td>
                    <td className="px-3 py-2.5 text-gray-500 max-w-[140px] truncate">{la.campaignCategory || '—'}</td>
                    <td className="px-3 py-2.5">
                      {la.campaignRating > 0 && <span className={cn('font-bold', la.campaignRating >= 4.5 ? 'text-green-400' : 'text-gray-400')}>{la.campaignRating}★</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn('px-2 py-0.5 rounded text-[10px] font-medium', STATUS_COLORS[lead.status] || 'bg-gray-800 text-gray-500')}>
                        {lead.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <a href={`/leads/${lead.id}`} className="text-gray-600 hover:text-gray-300"><ExternalLink className="w-3.5 h-3.5" /></a>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-600">No leads match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Tab: Call Mode ───────────────────────────────────────────────────────────

function CallModeTab() {
  const { user } = useAuth()
  const { leads, loading } = useB2BLeads()
  const [idx, setIdx]                     = useState(0)
  const [cityFilter, setCityFilter]       = useState('all')
  const [modelFilter, setModelFilter]     = useState('all')
  const [outcomeFilter, setOutcomeFilter] = useState('all')
  const [note, setNote]                   = useState('')
  const [followUp, setFollowUp]           = useState('')
  const [outcome, setOutcome]             = useState('answered')
  const [saving, setSaving]               = useState(false)
  const [scriptStep, setScriptStep]       = useState(0)
  const [scriptOpen, setScriptOpen]       = useState(false)

  const cities = useMemo(() => Array.from(new Set(leads.map(l => (l as any).campaignCity).filter(Boolean))).sort(), [leads])

  const filtered = useMemo(() => leads.filter(l => {
    const la = l as any
    if (cityFilter   !== 'all' && la.campaignCity  !== cityFilter)  return false
    if (modelFilter  !== 'all' && la.campaignModel !== modelFilter)  return false
    if (outcomeFilter === 'uncalled'  && l.status !== 'new')        return false
    if (outcomeFilter === 'contacted' && l.status !== 'contacted')  return false
    return true
  }), [leads, cityFilter, modelFilter, outcomeFilter])

  const lead    = filtered[idx]
  const la      = lead as any
  const model: CampaignModel   = la?.campaignModel  || 'Unknown'
  const segment: CampaignSegment = la?.campaignSegment || 'unknown'
  const { script, label: scriptLabel } = getScript(model, segment)

  const logCall = async () => {
    if (!lead) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'leads', lead.id, 'activities'), {
        leadId: lead.id, type: 'call',
        description: note.trim() || `Call — ${outcome}`,
        outcome,
        followUpDate: followUp ? Timestamp.fromDate(new Date(followUp)) : null,
        performedBy: user?.id ?? '', performedByName: user?.name ?? '',
        createdAt: serverTimestamp(),
      })
      const updates: Record<string, unknown> = { status: 'contacted', updatedAt: serverTimestamp() }
      if (followUp) updates.nextFollowUp = Timestamp.fromDate(new Date(followUp))
      await updateDoc(doc(db, 'leads', lead.id), updates)
      toast.success('Call logged')
      setNote(''); setFollowUp(''); setOutcome('answered'); setScriptOpen(false)
      if (idx < filtered.length - 1) setIdx(i => i + 1)
    } catch { toast.error('Failed to log call') }
    finally { setSaving(false) }
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-600 text-sm gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
  if (leads.length === 0) return <div className="text-center py-20 text-gray-600"><Phone className="w-8 h-8 mx-auto mb-3 opacity-30" /><p className="text-sm">No B2B leads yet. Import a call list first.</p></div>

  return (
    <div className="space-y-4">
      {/* Filters row */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={cityFilter} onChange={e => { setCityFilter(e.target.value); setIdx(0) }}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none min-w-0 flex-1 sm:flex-none">
          <option value="all">All Cities</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={modelFilter} onChange={e => { setModelFilter(e.target.value); setIdx(0) }}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none min-w-0 flex-1 sm:flex-none">
          <option value="all">M1 + M2</option>
          <option value="M1_Direct">M1 Direct</option>
          <option value="M2_Channel">M2 Channel</option>
        </select>
        <select value={outcomeFilter} onChange={e => { setOutcomeFilter(e.target.value); setIdx(0) }}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none min-w-0 flex-1 sm:flex-none">
          <option value="all">All Leads</option>
          <option value="uncalled">Uncalled Only</option>
          <option value="contacted">Contacted</option>
        </select>
        <span className="text-xs text-gray-600 ml-auto shrink-0">{filtered.length > 0 ? `${idx + 1} / ${filtered.length}` : '0'}</span>
      </div>

      {!lead ? (
        <div className="text-center py-16 text-gray-600 text-sm">No leads match these filters.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left column — lead card + log form + nav */}
          <div className="space-y-4">
            {/* Lead card */}
            <Card padding="none">
              <div className="p-4 border-b border-gray-800 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-white truncate">{lead.name}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <ModelBadge model={model} />
                    {la.campaignCity && <span className="text-xs text-gray-500">{la.campaignCity}</span>}
                    <SegmentBadge segment={segment} />
                    {la.campaignRating > 0 && <span className={cn('text-xs font-bold', la.campaignRating >= 4.5 ? 'text-green-400' : 'text-gray-400')}>{la.campaignRating}★</span>}
                  </div>
                </div>
                <span className={cn('text-[10px] px-2 py-1 rounded border shrink-0',
                  lead.status === 'new' ? 'border-gray-700 text-gray-500' : 'border-green-800 text-green-400 bg-green-900/20'
                )}>{lead.status}</span>
              </div>
              <div className="p-4 space-y-3">
                {lead.phone && (
                  <div className="flex items-center gap-3">
                    <a href={`tel:${lead.phone}`}
                      className="flex-1 flex items-center gap-3 py-3 px-4 rounded-xl bg-indigo-900/30 border border-indigo-800 hover:bg-indigo-900/50 active:scale-95 transition-all touch-manipulation">
                      <Phone className="w-5 h-5 text-indigo-400 shrink-0" />
                      <span className="text-base font-bold text-white tracking-wide">{lead.phone}</span>
                    </a>
                    <a href={`https://wa.me/91${lead.phone}`} target="_blank" rel="noopener noreferrer"
                      className="p-3 rounded-xl bg-green-900/30 border border-green-800 hover:bg-green-900/50 active:scale-95 transition-all">
                      <MessageSquare className="w-5 h-5 text-green-400" />
                    </a>
                  </div>
                )}
                {la.campaignCategory && <div className="flex items-start gap-3"><Hash className="w-3.5 h-3.5 text-gray-600 shrink-0 mt-0.5" /><p className="text-xs text-gray-400">{la.campaignCategory}</p></div>}
                {lead.address && <div className="flex items-start gap-3"><MapPin className="w-3.5 h-3.5 text-gray-600 shrink-0 mt-0.5" /><p className="text-xs text-gray-400 line-clamp-2">{lead.address}</p></div>}
                {la.campaignWebsite && (
                  <div className="flex items-center gap-3">
                    <Globe className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                    <a href={la.campaignWebsite} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline truncate max-w-[220px]">{la.campaignWebsite.replace(/^https?:\/\//, '')}</a>
                  </div>
                )}
                {la.campaignReviews > 0 && <div className="flex items-center gap-3"><Star className="w-3.5 h-3.5 text-gray-600 shrink-0" /><p className="text-xs text-gray-400">{la.campaignReviews} Google reviews</p></div>}
                {lead.notes?.includes('Call Notes:') && (
                  <div className="rounded-lg bg-amber-900/20 border border-amber-800 px-3 py-2">
                    <p className="text-[10px] font-bold text-amber-400 mb-0.5">PREV NOTE FROM SHEET</p>
                    <p className="text-xs text-gray-300">{lead.notes.split('Call Notes:')[1]?.trim()}</p>
                  </div>
                )}
              </div>
            </Card>

            {/* Script — mobile collapsible, desktop always visible */}
            <div className="lg:hidden">
              <button onClick={() => setScriptOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-700 bg-gray-900/50 text-sm text-gray-300 font-medium touch-manipulation active:bg-gray-800">
                <span>{scriptLabel}</span>
                <ChevronRight className={cn('w-4 h-4 transition-transform', scriptOpen && 'rotate-90')} />
              </button>
              {scriptOpen && (
                <div className="mt-2 space-y-2">
                  {script.map((step, i) => (
                    <div key={step.label} onClick={() => setScriptStep(i)}
                      className={cn('rounded-xl border p-3 cursor-pointer transition-all touch-manipulation', step.bg,
                        scriptStep === i ? 'ring-1 ring-white/20' : 'opacity-75')}>
                      <p className={cn('text-[10px] font-bold tracking-widest mb-1', step.color)}>{step.label}</p>
                      <p className="text-xs text-gray-300 leading-relaxed">{step.script}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Log form */}
            <Card padding="none">
              <div className="p-4 border-b border-gray-800"><p className="text-sm font-semibold text-white">Log Call</p></div>
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Outcome</label>
                  <select value={outcome} onChange={e => setOutcome(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2.5 focus:outline-none">
                    <option value="answered">Answered</option>
                    <option value="interested">Interested</option>
                    <option value="catalogue_sent">Catalogue Sent</option>
                    <option value="sample_requested">Sample Requested</option>
                    <option value="distributor_interested">Distributor Interested</option>
                    <option value="callback_requested">Callback Requested</option>
                    <option value="not_interested">Not Interested</option>
                    <option value="ringing">Ringing / No Answer</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Notes</label>
                  <textarea value={note} onChange={e => setNote(e.target.value)}
                    placeholder={model === 'M2_Channel' ? 'Distribution reach? Current brands? Margin expectation?' : 'Brand they stock? Pain point mentioned? Budget?'}
                    rows={3} className="w-full bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none placeholder-gray-700 resize-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Next Follow-up</label>
                  <input type="date" value={followUp} onChange={e => setFollowUp(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2.5 focus:outline-none" />
                </div>
                <button onClick={logCall} disabled={saving}
                  className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-base font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2 touch-manipulation">
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                  {saving ? 'Saving…' : 'Log & Next'}
                </button>
              </div>
            </Card>

            {/* Prev / Next nav */}
            <div className="flex items-center gap-3">
              <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
                className="flex-1 py-3.5 rounded-xl border border-gray-700 text-sm font-medium text-gray-400 hover:text-white hover:border-gray-600 active:scale-95 disabled:opacity-30 transition-all flex items-center justify-center gap-1.5 touch-manipulation">
                <ChevronLeft className="w-4 h-4" /> Prev
              </button>
              <button onClick={() => setIdx(i => Math.min(filtered.length - 1, i + 1))} disabled={idx === filtered.length - 1}
                className="flex-1 py-3.5 rounded-xl border border-gray-700 text-sm font-medium text-gray-400 hover:text-white hover:border-gray-600 active:scale-95 disabled:opacity-30 transition-all flex items-center justify-center gap-1.5 touch-manipulation">
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Right column — script (desktop only) */}
          <div className="hidden lg:block space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{scriptLabel}</p>
            {script.map((step, i) => (
              <div key={step.label} onClick={() => setScriptStep(i)}
                className={cn('rounded-xl border p-3 cursor-pointer transition-all', step.bg,
                  scriptStep === i ? 'ring-1 ring-white/20 scale-[1.01]' : 'opacity-70 hover:opacity-90')}>
                <p className={cn('text-[10px] font-bold tracking-widest mb-1', step.color)}>{step.label}</p>
                <p className="text-xs text-gray-300 leading-relaxed">{step.script}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Stats ───────────────────────────────────────────────────────────────

const CITY_ORDER = ['Bangalore', 'Hyderabad', 'Surat', 'Coimbatore', 'Jaipur', 'Nashik', 'Mumbai', 'Pune', 'Other']

function StatsTab() {
  const { leads, loading } = useB2BLeads()

  const stats = useMemo(() => {
    const cityMap: Record<string, { total: number; contacted: number; model: CampaignModel }> = {}
    const modelMap: Record<string, number> = { M1_Direct: 0, M2_Channel: 0, Unknown: 0 }
    const statusMap: Record<string, number> = {}
    let withPhone = 0, highRating = 0

    leads.forEach(l => {
      const la = l as any
      const city  = la.campaignCity  || 'Other'
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

  const total     = leads.length
  const contacted = total - (stats.statusMap['new'] || 0)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total B2B Leads',    value: total,           sub: 'Imported',                                          color: 'text-white' },
          { label: 'Contacted',          value: contacted,       sub: `${total ? Math.round(contacted/total*100) : 0}% rate`, color: 'text-green-400' },
          { label: 'With Phone',         value: stats.withPhone, sub: `${total ? Math.round(stats.withPhone/total*100) : 0}% coverage`, color: 'text-blue-400' },
          { label: 'High Rating (4.5★+)', value: stats.highRating, sub: 'Priority leads',                                 color: 'text-amber-400' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={cn('text-2xl font-bold mt-1', s.color)}>{s.value}</p>
            <p className="text-xs text-gray-600 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* M1 vs M2 */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { key: 'M1_Direct',  label: 'M1 Direct',  sub: 'Bangalore · Hyderabad · Mumbai · Pune', color: 'text-blue-400',  bg: 'bg-blue-900/10 border-blue-900' },
          { key: 'M2_Channel', label: 'M2 Channel', sub: 'Surat · Coimbatore · Jaipur · Nashik',  color: 'text-amber-400', bg: 'bg-amber-900/10 border-amber-900' },
        ].map(m => (
          <div key={m.key} className={cn('rounded-xl border p-4', m.bg)}>
            <p className={cn('text-xs font-bold', m.color)}>{m.label}</p>
            <p className="text-[10px] text-gray-600 mb-2">{m.sub}</p>
            <p className="text-3xl font-bold text-white">{stats.modelMap[m.key] || 0}</p>
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
            {[...CITY_ORDER, ...Object.keys(stats.cityMap).filter(c => !CITY_ORDER.includes(c))]
              .filter(c => stats.cityMap[c])
              .map(city => {
                const s = stats.cityMap[city]
                return (
                  <tr key={city} className="hover:bg-gray-800/20">
                    <td className="px-4 py-2.5 text-gray-200 font-medium">{city}</td>
                    <td className="px-4 py-2.5"><ModelBadge model={s.model} /></td>
                    <td className="px-4 py-2.5 text-gray-300">{s.total}</td>
                    <td className="px-4 py-2.5 text-green-400">{s.contacted}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-800 rounded-full h-1.5 max-w-[80px]">
                          <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${s.total ? Math.round(s.contacted/s.total*100) : 0}%` }} />
                        </div>
                        <span className="text-xs text-gray-400">{s.total ? Math.round(s.contacted/s.total*100) : 0}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            {Object.keys(stats.cityMap).length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-600 text-xs">No data yet</td></tr>
            )}
          </tbody>
        </table>
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
          {Object.keys(stats.statusMap).length === 0 && <p className="text-xs text-gray-600">No calls logged yet</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'import' | 'leads' | 'call' | 'stats'

export function B2BCampaignPage() {
  const [tab, setTab] = useState<Tab>('import')

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'import', label: 'Import',    icon: <Upload className="w-4 h-4" /> },
    { id: 'leads',  label: 'All Leads', icon: <List className="w-4 h-4" /> },
    { id: 'call',   label: 'Call Mode', icon: <Phone className="w-4 h-4" /> },
    { id: 'stats',  label: 'Stats',     icon: <BarChart2 className="w-4 h-4" /> },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">B2B Campaign</h1>
        <p className="text-sm text-gray-500 mt-0.5">M1 Direct (Bangalore · Hyderabad) &amp; M2 Channel (Surat · Coimbatore · Jaipur · Nashik)</p>
      </div>

      <div className="flex gap-1 bg-gray-900 rounded-xl p-1 w-fit border border-gray-800">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              tab === t.id ? 'bg-gray-700 text-white shadow' : 'text-gray-500 hover:text-gray-300')}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === 'import' && <ImportTab />}
      {tab === 'leads'  && <LeadsListTab />}
      {tab === 'call'   && <CallModeTab />}
      {tab === 'stats'  && <StatsTab />}
    </div>
  )
}
