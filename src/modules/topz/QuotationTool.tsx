import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useLocation } from 'react-router-dom'
const RouteMap = lazy(() => import('./RouteMap').then(m => ({ default: m.RouteMap })))
import { MapPin, Calendar, Users, Car, Printer, RotateCcw, Navigation, MessageCircle, ArrowLeftRight, Package, Save, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { getVehicles, calculateQuotation, calculateLocalQuotation, getSuggestedVehicles, daysBetween, type Vehicle, type QuotationResult, type LocalQuotationResult } from './data/rateCard'
import { printQuotation } from './printQuotation'
import { saveQuotation } from './data/storage'
import toast from 'react-hot-toast'

type TripType = 'outstation' | 'local'

interface FormState {
  tripType: TripType
  isRoundTrip: boolean
  clientName: string
  clientPhone: string
  clientEmail: string
  pickupDate: string
  pickupTime: string
  pickupLocation: string
  dropDate: string
  returnTime: string
  dropLocation: string
  passengers: string
  estimatedKm: string
}

const EMPTY: FormState = {
  tripType: 'outstation', isRoundTrip: false,
  clientName: '', clientPhone: '', clientEmail: '',
  pickupDate: '', pickupTime: '', pickupLocation: '', dropDate: '', returnTime: '', dropLocation: '',
  passengers: '', estimatedKm: '',
}

// Tiers apply to both pickup and return times independently.
// Permit is only added when RETURN is after 1AM (not pickup).
// 'normal'         → 06:30 – 23:00
// 'night_da'       → 23:01 – 00:59  (DA ×2)
// 'night_da_permit'→ 01:00 – 01:59  (DA ×2 + permit — return only)
// 'full_day'       → 02:00 – 06:29  (full extra day)
type NightTier = 'normal' | 'night_da' | 'night_da_permit' | 'full_day'

function getNightTier(time: string): NightTier {
  if (!time) return 'normal'
  const [h, m] = time.split(':').map(Number)
  const mins = h * 60 + m
  if (mins >= 390 && mins <= 1380) return 'normal'
  if (mins > 1380 || mins < 60)   return 'night_da'
  if (mins >= 60 && mins < 120)   return 'night_da_permit'
  return 'full_day'
}

const TIER_LABEL: Record<NightTier, string> = {
  normal: '',
  night_da: 'Night — DA ×2',
  night_da_permit: 'Night — DA ×2 + Permit',
  full_day: 'Night — Full Extra Day',
}

type VehicleRates = { driverAllowancePerDay: number; permitPerDay: number; perDayRate: number }

// Pickup surcharge: always just +DA for any non-normal time (no permit, no full day)
function pickupSurcharge(tier: NightTier, v: VehicleRates): number {
  if (tier !== 'normal') return v.driverAllowancePerDay
  return 0
}

// Return surcharge: full tier including permit when applicable
function returnSurcharge(tier: NightTier, v: VehicleRates): number {
  if (tier === 'night_da')        return v.driverAllowancePerDay
  if (tier === 'night_da_permit') return v.driverAllowancePerDay + v.permitPerDay
  if (tier === 'full_day')        return v.perDayRate
  return 0
}

function fmtTime(time: string): string {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  const ampm = h < 12 ? 'AM' : 'PM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`
const uid = () => Math.random().toString(36).slice(2, 10)
const quoteNo = () => `TOPZ-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`

// ── State detection for border tax ─────────────────────────────────────────────
const CITY_STATE: Record<string, string> = {
  // Maharashtra
  mumbai:'MH', bombay:'MH', thane:'MH', 'navi mumbai':'MH', navimumbai:'MH',
  pune:'MH', nashik:'MH', nagpur:'MH', aurangabad:'MH', solapur:'MH',
  kolhapur:'MH', satara:'MH', sangli:'MH', raigad:'MH', ratnagiri:'MH',
  sindhudurg:'MH', alibag:'MH', lonavala:'MH', mahabaleshwar:'MH',
  shirdi:'MH', dadar:'MH', malad:'MH', borivali:'MH', andheri:'MH',
  panvel:'MH', kalyan:'MH', dombivli:'MH', vasai:'MH', virar:'MH',
  // Goa
  goa:'GA', panaji:'GA', panjim:'GA', margao:'GA', vasco:'GA',
  madgaon:'GA', mapusa:'GA', calangute:'GA', candolim:'GA',
  // Gujarat
  ahmedabad:'GJ', surat:'GJ', vadodara:'GJ', baroda:'GJ', rajkot:'GJ',
  gandhinagar:'GJ', bhavnagar:'GJ', jamnagar:'GJ', anand:'GJ',
  kutch:'GJ', bhuj:'GJ', mehsana:'GJ', morbi:'GJ',
  // Rajasthan
  jaipur:'RJ', jodhpur:'RJ', udaipur:'RJ', ajmer:'RJ', bikaner:'RJ',
  kota:'RJ', pushkar:'RJ', mount:'RJ', abu:'RJ',
  // Delhi / NCR
  delhi:'DL', 'new delhi':'DL', noida:'UP', gurugram:'HR', gurgaon:'HR',
  faridabad:'HR', ghaziabad:'UP',
  // Uttar Pradesh
  agra:'UP', mathura:'UP', vrindavan:'UP', lucknow:'UP', varanasi:'UP',
  prayagraj:'UP', allahabad:'UP', kanpur:'UP',
  // Madhya Pradesh
  bhopal:'MP', indore:'MP', gwalior:'MP', jabalpur:'MP', ujjain:'MP',
  // Karnataka
  bangalore:'KA', bengaluru:'KA', mysore:'KA', mysuru:'KA',
  hubli:'KA', dharwad:'KA', mangalore:'KA', belgaum:'KA',
  // Tamil Nadu
  chennai:'TN', madras:'TN', coimbatore:'TN', madurai:'TN',
  trichy:'TN', salem:'TN', tiruppur:'TN',
  // Kerala
  kochi:'KL', cochin:'KL', thiruvananthapuram:'KL', trivandrum:'KL',
  kozhikode:'KL', calicut:'KL', thrissur:'KL', kannur:'KL',
  // Telangana / Andhra
  hyderabad:'TG', warangal:'TG', visakhapatnam:'AP', vizag:'AP',
  // West Bengal
  kolkata:'WB', calcutta:'WB', howrah:'WB', siliguri:'WB',
  // Himachal Pradesh
  shimla:'HP', manali:'HP', dharamshala:'HP', kullu:'HP',
  // Uttarakhand
  dehradun:'UK', haridwar:'UK', rishikesh:'UK', mussoorie:'UK',
  nainital:'UK', jim:'UK',
  // Punjab / Haryana
  chandigarh:'CH', amritsar:'PB', ludhiana:'PB', jalandhar:'PB',
  // Other MH
  mumbra:'MH', bhiwandi:'MH', mira:'MH', igatpuri:'MH', khandala:'MH',
  // State names as keys (when user types the state directly)
  maharashtra:'MH', 'goa state':'GA', gujarat:'GJ', rajasthan:'RJ',
  'uttar pradesh':'UP', 'madhya pradesh':'MP',
  karnataka:'KA', 'tamil nadu':'TN', kerala:'KL',
  telangana:'TG', 'andhra pradesh':'AP', 'west bengal':'WB',
  himachal:'HP', uttarakhand:'UK', haryana:'HR',
}

function detectState(location: string): string | null {
  const lower = location.toLowerCase().replace(/[,.()\-]/g, ' ')
  for (const [city, state] of Object.entries(CITY_STATE)) {
    if (lower.includes(city)) return state
  }
  return null
}

function isCrossState(from: string, to: string): { cross: boolean; dropState: string | null } {
  if (!from || !to) return { cross: false, dropState: null }
  const s1 = detectState(from)
  const s2 = detectState(to)
  if (!s1 || !s2) return { cross: false, dropState: s2 }
  return { cross: s1 !== s2, dropState: s2 }
}

const STATE_NAMES: Record<string, string> = {
  MH:'Maharashtra', GA:'Goa', GJ:'Gujarat', RJ:'Rajasthan', DL:'Delhi',
  UP:'Uttar Pradesh', MP:'Madhya Pradesh', KA:'Karnataka', TN:'Tamil Nadu',
  KL:'Kerala', TG:'Telangana', AP:'Andhra Pradesh', WB:'West Bengal',
  HP:'Himachal Pradesh', UK:'Uttarakhand', PB:'Punjab', HR:'Haryana',
  CH:'Chandigarh',
}

function vehicleIcon(category: string) {
  const c = category.toLowerCase()
  if (c.includes('bus') || c.includes('volvo')) return 'bus'
  if (c.includes('tempo') || c.includes('traveller') || c.includes('van')) return 'van'
  return 'car'
}

export function QuotationTool() {
  const location = useLocation()
  const editQuote = (location.state as any)?.edit ?? null
  const [form, setForm] = useState<FormState>(editQuote ? {
    tripType: editQuote.tripType ?? 'outstation',
    isRoundTrip: editQuote.isRoundTrip ?? false,
    clientName: editQuote.clientName ?? '',
    clientPhone: editQuote.clientPhone ?? '',
    clientEmail: editQuote.clientEmail ?? '',
    pickupDate: editQuote.pickupDate ?? '',
    pickupTime: '',
    dropDate: editQuote.dropDate ?? '',
    returnTime: '',
    pickupLocation: editQuote.pickupLocation ?? '',
    dropLocation: editQuote.dropLocation ?? '',
    passengers: editQuote.passengers ?? '',
    estimatedKm: editQuote.estimatedKm ?? '',
  } : EMPTY)
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)
  const [vehicleOpen, setVehicleOpen] = useState(false)
  const [result, setResult] = useState<QuotationResult | null>(null)
  const [localResult, setLocalResult] = useState<LocalQuotationResult | null>(null)
  const [distLoading, setDistLoading] = useState(false)
  const [mapData, setMapData] = useState<{ from: [number,number]; to: [number,number]; route: [number,number][] } | null>(null)
  const [savedQuoteNo, setSavedQuoteNo] = useState(editQuote?.quoteNo ?? '')
  const [saved, setSaved] = useState(false)
  const [includeTnc, setIncludeTnc] = useState(false)
  const [showNotePicker, setShowNotePicker] = useState(false)
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(
    new Set(['min_km', 'toll_extra'])
  )
  const [finalAmount, setFinalAmount] = useState<number | ''>('')

  const vehicles = getVehicles()

  // Pre-select vehicle when editing a saved quote
  useEffect(() => {
    if (editQuote?.vehicleName) {
      const v = vehicles.find(v => v.name === editQuote.vehicleName)
      if (v) setSelectedVehicle(v)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const passengers = parseInt(form.passengers) || 0
  const suggested = passengers > 0 ? getSuggestedVehicles(passengers, vehicles) : vehicles
  const isLocal = form.tripType === 'local'
  const days = !isLocal && form.pickupDate && form.dropDate
    ? daysBetween(form.pickupDate, form.dropDate) : 1
  const baseTotal = result?.total ?? localResult?.total ?? 0
  const nightTier = getNightTier(form.pickupTime)
  const retTier   = getNightTier(form.returnTime)
  const nightExtra = selectedVehicle
    ? pickupSurcharge(nightTier, selectedVehicle) + returnSurcharge(retTier, selectedVehicle)
    : 0
  const totalBeforeDiscount = baseTotal + nightExtra
  const total = finalAmount !== '' ? finalAmount : totalBeforeDiscount
  const discountAmount = totalBeforeDiscount - total

  const phoneValid = !form.clientPhone || /^\d{10}$/.test(form.clientPhone.replace(/\s/g, ''))
  const passengersValid = !form.passengers || parseInt(form.passengers) >= 1
  const { cross: isCrossStateTrip, dropState: crossDropState } = isCrossState(form.pickupLocation, form.dropLocation)

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    let val = e.target.value
    if (k === 'passengers') {
      const n = parseInt(val)
      if (val !== '' && (isNaN(n) || n < 1)) val = '1'
      setSelectedVehicle(null); setResult(null); setLocalResult(null)
    }
    setForm(f => ({ ...f, [k]: val }))
  }

  function setTripType(t: TripType) {
    setForm(f => ({ ...f, tripType: t, isRoundTrip: false, dropDate: '', estimatedKm: '' }))
    setSelectedVehicle(null); setResult(null); setLocalResult(null)
  }

  function recalc(v: Vehicle, km: number) {
    if (form.tripType === 'outstation') {
      setResult(calculateQuotation(v, days, km)); setLocalResult(null)
    } else {
      setLocalResult(calculateLocalQuotation(v, km)); setResult(null)
    }
  }

  function handleVehicleSelect(v: Vehicle) {
    if (passengers > 0 && v.seats < passengers) {
      toast.error(`${v.name} only fits ${v.seats} passengers`)
      return
    }
    setSelectedVehicle(v)
    setVehicleOpen(false)
    const km = parseInt(form.estimatedKm) || (isLocal ? 80 : days * v.minKmPerDay)
    recalc(v, km)
  }

  function handleOpenVehiclePicker() {
    if (!form.passengers || parseInt(form.passengers) < 1) {
      toast.error('Enter number of passengers first')
      return
    }
    setVehicleOpen(o => !o)
  }

  function handleKmChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(f => ({ ...f, estimatedKm: e.target.value }))
    if (selectedVehicle) recalc(selectedVehicle, parseInt(e.target.value) || 0)
  }

  const autoFetchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!form.pickupLocation || !form.dropLocation) return
    if (autoFetchRef.current) clearTimeout(autoFetchRef.current)
    autoFetchRef.current = setTimeout(() => { fetchDistance() }, 800)
    return () => { if (autoFetchRef.current) clearTimeout(autoFetchRef.current) }
  }, [form.pickupLocation, form.dropLocation, form.isRoundTrip])

  async function geocode(place: string): Promise<[number, number]> {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1&countrycodes=in`
    const r = await fetch(url, { headers: { 'Accept-Language': 'en' } })
    const data = await r.json()
    if (!data.length) throw new Error(`Location not found: "${place}"`)
    return [parseFloat(data[0].lon), parseFloat(data[0].lat)]
  }

  async function fetchDistance() {
    if (!form.pickupLocation || !form.dropLocation) return
    setDistLoading(true)
    try {
      const [fromCoords, toCoords] = await Promise.all([
        geocode(form.pickupLocation),
        geocode(form.dropLocation),
      ])
      const [flon, flat] = fromCoords
      const [tlon, tlat] = toCoords
      const r = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${flon},${flat};${tlon},${tlat}?overview=full&geometries=geojson`
      )
      const d = await r.json()
      if (d.code !== 'Ok') throw new Error('Route not found')
      const oneWayKm = Math.round(d.routes[0].distance / 1000)
      const km = form.isRoundTrip ? oneWayKm * 2 : oneWayKm
      setForm(f => ({ ...f, estimatedKm: String(km) }))
      if (selectedVehicle) recalc(selectedVehicle, km)
      // Store map data: OSRM GeoJSON coords are [lon, lat], Leaflet needs [lat, lon]
      const routeCoords: [number,number][] = d.routes[0].geometry.coordinates.map(
        ([lon, lat]: [number, number]) => [lat, lon]
      )
      setMapData({ from: [flat, flon], to: [tlat, tlon], route: routeCoords })
    } catch (e: any) {
      toast.error('Could not fetch distance: ' + e.message)
    } finally {
      setDistLoading(false)
    }
  }

  async function doSave(qNo: string) {
    if (!selectedVehicle) return
    await saveQuotation({
      id: uid(), quoteNo: qNo, createdAt: new Date().toISOString(), status: 'draft',
      tripType: form.tripType, isRoundTrip: form.isRoundTrip,
      clientName: form.clientName, clientPhone: form.clientPhone, clientEmail: form.clientEmail,
      pickupDate: form.pickupDate, pickupLocation: form.pickupLocation,
      dropDate: form.dropDate, dropLocation: form.dropLocation,
      passengers: form.passengers, estimatedKm: form.estimatedKm,
      vehicleName: selectedVehicle.name, vehicleCategory: selectedVehicle.category,
      days, totalAmount: total,
    })
  }

  async function handleSave() {
    if (!selectedVehicle) return
    const qNo = savedQuoteNo || quoteNo()
    setSavedQuoteNo(qNo)
    await doSave(qNo)
    setSaved(true)
    toast.success('Quote saved')
    setTimeout(() => setSaved(false), 2000)
  }

  async function handlePrint() {
    if (!selectedVehicle) return
    const qNo = savedQuoteNo || quoteNo()
    await printQuotation({ form, vehicle: selectedVehicle, result, localResult, days, quoteNo: qNo, nightTier, retTier, nightExtra, includeTnc, selectedNotes, finalAmount: finalAmount !== '' ? finalAmount : undefined })
  }

  async function handleWhatsApp() {
    if (!selectedVehicle || !form.clientPhone) { toast.error('Client phone number required'); return }
    const qNo = savedQuoteNo || quoteNo()
    const phone = form.clientPhone.replace(/\D/g, '').replace(/^0/, '91').replace(/^(?!91)/, '91')

    const tier = getNightTier(form.pickupTime)
    const rTier = getNightTier(form.returnTime)
    const da = selectedVehicle.driverAllowancePerDay
    const permit = selectedVehicle.permitPerDay
    const hasPickupNight = tier !== 'normal'
    const hasReturnNight = rTier !== 'normal'
    const daLine = da > 0
      ? `${hasPickupNight || hasReturnNight ? da * 2 : da} DA per day${hasPickupNight ? ` _(Pickup: ${TIER_LABEL[tier]})_` : ''}${hasReturnNight ? ` _(Return: ${TIER_LABEL[rTier]})_` : ''}`
      : ''
    const approxKm = form.estimatedKm
      ? parseInt(form.estimatedKm)
      : result ? result.totalKm : localResult ? localResult.actualKm : 0
    const tripLabel = isLocal
      ? 'Local Package (8hr / 80km)'
      : `${form.pickupLocation} to ${form.dropLocation}${form.isRoundTrip ? ' Return' : ''}`

    const sep = '─────────────────────'
    const lines = [
      `🚗 *TOPZ CAB — QUOTATION*`,
      sep,
      `*${selectedVehicle.seats} Seater ${selectedVehicle.name}*`,
      `📍 ${tripLabel}`,
      isLocal ? '' : `🗓 ${days} Day${days > 1 ? 's' : ''}`,
      '',
      sep,
      `*RATE DETAILS*`,
      sep,
      result ? `🔹 Min KM/Day     :  ${selectedVehicle.minKmPerDay} km` : '',
      `🔹 Rate per KM    :  ₹${selectedVehicle.ratePerKm}`,
      permit > 0 ? `🔹 Permit/Day     :  ₹${permit}` : '',
      daLine ? `🔹 Driver Allow.  :  ${daLine}` : '',
      rTier === 'night_da_permit' && permit > 0 ? `🌙 Night Permit    :  ₹${permit} _(Return after 1AM)_` : '',
      rTier === 'full_day' ? `🌙 Late Night      :  ₹${fmt(selectedVehicle.perDayRate)} _(Extra Day — Return)_` : '',
      '',
      sep,
      `*TOTAL  :  ${fmt(total)}*`,
      `_(+ Toll · Parking · Entry Tax extra)_`,
      '',
      approxKm > 0 ? `🔹 Approx KMs     :  ~${approxKm} km` : '',
      `🔹 Extra KM rate  :  ₹${selectedVehicle.ratePerKm}/km`,
      !isLocal && isCrossStateTrip
        ? `🛂 ${crossDropState ? (STATE_NAMES[crossDropState] ?? form.dropLocation) : form.dropLocation} Border Tax extra`
        : '',
      '',
      sep,
      form.pickupTime ? `🕐 Pickup Time    :  ${fmtTime(form.pickupTime)}${tier !== 'normal' ? ` _(${TIER_LABEL[tier]})_` : ''}` : '',
      form.returnTime && !isLocal ? `🕐 Return Time    :  ${fmtTime(form.returnTime)}${rTier !== 'normal' ? ` _(${TIER_LABEL[rTier]})_` : ''}` : '',
      `🔹 Garage to Garage  [ Malad to Malad ]`,
      '',
      sep,
      `🙏 Thanks & Regards`,
      `*Topz Cab*`,
    ].filter(Boolean).join('\n')

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(lines)}`, '_blank')
    toast.success('Opening WhatsApp...')
  }

  function reset() {
    setForm(EMPTY); setSelectedVehicle(null); setResult(null); setLocalResult(null)
    setSavedQuoteNo(''); setSaved(false); setVehicleOpen(false); setMapData(null)
  }

  const showSummary = selectedVehicle && (result || localResult)

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-base)' }}>New Quotation</h1>
        <button onClick={reset} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors"
          style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--text-muted)' }}>
          <RotateCcw className="w-3 h-3" /> Reset
        </button>
      </div>

      {/* Main booking card */}
      <div className="glass-card rounded-2xl overflow-hidden">

        {/* ── Row 1: Trip type + Round trip ── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 gap-4 flex-wrap">
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
            {(['outstation', 'local'] as TripType[]).map(t => (
              <button key={t} onClick={() => setTripType(t)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={form.tripType === t
                  ? { background: 'rgba(240,192,64,0.15)', color: '#f0c040', border: '1px solid rgba(240,192,64,0.4)' }
                  : { color: 'var(--text-muted)', border: '1px solid transparent' }
                }>
                {t === 'outstation' ? <ArrowLeftRight className="w-3 h-3" /> : <Package className="w-3 h-3" />}
                {t === 'outstation' ? 'Outstation' : 'Local 8hr'}
              </button>
            ))}
          </div>

        </div>

        {/* ── Row 2: Pickup / Drop location bar ── */}
        <div className="mx-5 mb-4 flex rounded-xl overflow-hidden border-2"
          style={{ borderColor: 'rgba(201,168,64,0.25)' }}>
          <div className="flex-1 relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2">
              <MapPin className="w-4 h-4" style={{ color: '#f0c040' }} />
            </div>
            <input type="text" value={form.pickupLocation} onChange={set('pickupLocation')}
              placeholder="Pickup location"
              className="w-full py-3.5 pl-9 pr-4 text-sm bg-transparent focus:outline-none"
              style={{ color: 'var(--text-base)' }} />
            <label className="absolute bottom-1 left-9 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>From</label>
          </div>
          <div className="w-px self-stretch my-2" style={{ background: 'var(--glass-border)' }} />
          <div className="flex-1 relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2">
              <MapPin className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            </div>
            <input type="text" value={form.dropLocation} onChange={set('dropLocation')}
              placeholder={isLocal ? 'Drop location (optional)' : 'Drop location'}
              className="w-full py-3.5 pl-9 pr-4 text-sm bg-transparent focus:outline-none"
              style={{ color: 'var(--text-base)' }} />
            <label className="absolute bottom-1 left-9 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>To</label>
          </div>
        </div>

        {/* ── Map / Road Visual ── */}
        {mapData ? (
          <div className="mx-5 mb-4 rounded-xl overflow-hidden" style={{ border: '1px solid var(--glass-border)' }}>
            <Suspense fallback={<div style={{ height: 280, background: 'var(--glass-bg)' }} className="flex items-center justify-center text-xs text-gray-500">Loading map…</div>}>
              <RouteMap
                from={mapData.from}
                to={mapData.to}
                routeCoords={mapData.route}
                fromLabel={form.pickupLocation}
                toLabel={form.dropLocation}
              />
            </Suspense>
          </div>
        ) : form.pickupLocation ? (
          <RoadVisual
            from={form.pickupLocation}
            to={form.dropLocation || '?'}
            roundTrip={!isLocal && form.isRoundTrip}
            vehicleType={selectedVehicle ? vehicleIcon(selectedVehicle.category) : 'car'}
          />
        ) : null}

        {/* ── Cross-state border tax badge ── */}
        {!isLocal && isCrossStateTrip && (
          <div className="mx-5 mb-3 flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold"
            style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.35)', color: '#fbbf24' }}>
            <span>⚠️</span>
            <span>
              Cross-state trip detected — <strong>{crossDropState ? (STATE_NAMES[crossDropState] ?? '') : ''} Border Tax</strong> will be extra
            </span>
          </div>
        )}

        {/* ── Row 3: Date / Time / Passengers / KM ── */}
        <div className="mx-5 mb-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <InputBox label={isLocal ? 'Trip Date' : 'Pickup Date'} icon={<Calendar className="w-3.5 h-3.5" />}>
            <input type="date" value={form.pickupDate} onChange={set('pickupDate')}
              className="w-full bg-transparent text-sm focus:outline-none" style={{ color: 'var(--text-base)' }} />
          </InputBox>
          <InputBox label="Pickup Time" icon={null} error={nightTier !== 'normal'}>
            <div className="flex items-center gap-1.5">
              <input type="time" value={form.pickupTime} onChange={set('pickupTime')}
                className="flex-1 bg-transparent text-sm focus:outline-none" style={{ color: 'var(--text-base)' }} />
              {nightTier === 'night_da' && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171' }}>DA×2</span>
              )}
              {nightTier === 'night_da_permit' && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171' }}>DA×2</span>
              )}
              {nightTier === 'full_day' && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171' }}>DA only</span>
              )}
            </div>
          </InputBox>
          {!isLocal && (
            <InputBox label="Return Date" icon={<Calendar className="w-3.5 h-3.5" />}>
              <input type="date" value={form.dropDate} onChange={set('dropDate')} min={form.pickupDate}
                className="w-full bg-transparent text-sm focus:outline-none" style={{ color: 'var(--text-base)' }} />
            </InputBox>
          )}
          {!isLocal && (
            <InputBox label="Return Time" icon={null} error={retTier !== 'normal'}>
              <div className="flex items-center gap-1.5">
                <input type="time" value={form.returnTime} onChange={set('returnTime')}
                  className="flex-1 bg-transparent text-sm focus:outline-none" style={{ color: 'var(--text-base)' }} />
                {retTier === 'night_da' && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171' }}>DA×2</span>
                )}
                {retTier === 'night_da_permit' && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171' }}>DA×2+Permit</span>
                )}
                {retTier === 'full_day' && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>+Full Day</span>
                )}
              </div>
            </InputBox>
          )}
          <InputBox label="Passengers" icon={<Users className="w-3.5 h-3.5" />} error={!passengersValid}>
            <input type="number" min="1" value={form.passengers} onChange={set('passengers')} placeholder="1"
              onBlur={e => { if (parseInt(e.target.value) < 1 || e.target.value === '0') setForm(f => ({ ...f, passengers: '1' })) }}
              className="w-full bg-transparent text-sm focus:outline-none" style={{ color: 'var(--text-base)' }} />
          </InputBox>
          <InputBox label={isLocal ? 'Est. KM (default 80)' : 'Est. Total KM'} icon={<Navigation className="w-3.5 h-3.5" />}>
            <div className="flex items-center gap-1">
              <input type="number" min="0" value={form.estimatedKm} onChange={handleKmChange}
                placeholder={isLocal ? '80' : '—'}
                className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none" style={{ color: 'var(--text-base)' }} />
              {form.pickupLocation && form.dropLocation && (
                <button onClick={fetchDistance} disabled={distLoading}
                  className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md disabled:opacity-40"
                  style={{ background: 'rgba(240,192,64,0.15)', color: '#f0c040' }}>
                  {distLoading ? '...' : 'Auto'}
                </button>
              )}
            </div>
          </InputBox>
        </div>

        {/* ── Row 4: Client details ── */}
        <div className="mx-5 mb-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <InputBox label="Client Name" icon={null}>
            <input type="text" value={form.clientName} onChange={set('clientName')} placeholder="Full name"
              className="w-full bg-transparent text-sm focus:outline-none" style={{ color: 'var(--text-base)' }} />
          </InputBox>
          <InputBox label="Phone" icon={null} error={!phoneValid}>
            <div className="flex items-center gap-1">
              <input type="tel" value={form.clientPhone} onChange={set('clientPhone')} placeholder="10-digit mobile"
                className="w-full bg-transparent text-sm focus:outline-none" style={{ color: 'var(--text-base)' }} maxLength={10} />
              {form.clientPhone && (
                <span style={{ fontSize: 10, fontWeight: 700, color: phoneValid ? '#34d399' : '#f87171' }}>
                  {phoneValid ? '✓' : `${form.clientPhone.replace(/\s/g,'').length}/10`}
                </span>
              )}
            </div>
          </InputBox>
          <InputBox label="Email (optional)" icon={null}>
            <input type="email" value={form.clientEmail} onChange={set('clientEmail')} placeholder="—"
              className="w-full bg-transparent text-sm focus:outline-none" style={{ color: 'var(--text-base)' }} />
          </InputBox>
        </div>

        {/* Info bar */}
        {!isLocal && days > 0 && form.pickupDate && form.dropDate && (
          <div className="mx-5 mb-5 flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', color: '#60a5fa' }}>
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            <span>
              <strong>{days} day{days > 1 ? 's' : ''}</strong> &middot; {form.pickupDate} → {form.dropDate}
            </span>
          </div>
        )}
        {isLocal && (
          <div className="mx-5 mb-5 flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{ background: 'rgba(240,192,64,0.06)', border: '1px solid rgba(240,192,64,0.2)', color: '#f0c040' }}>
            <Package className="w-3.5 h-3.5 shrink-0" />
            <span><strong>Local Package: 8 hours / 80 km included</strong> &middot; Extra km charged at vehicle rate</span>
          </div>
        )}

        {/* ── Select Vehicle button ── */}
        <div className="mx-5 mb-5">
          <button
            onClick={handleOpenVehiclePicker}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all"
            style={{
              background: selectedVehicle ? 'rgba(201,168,64,0.08)' : 'var(--glass-bg)',
              borderColor: selectedVehicle ? 'rgba(201,168,64,0.5)' : 'rgba(201,168,64,0.25)',
            }}
          >
            <div className="flex items-center gap-3">
              {selectedVehicle
                ? <VehicleSVG type={vehicleIcon(selectedVehicle.category)} size={32} />
                : <Car className="w-5 h-5" style={{ color: '#f0c040' }} />
              }
              <div className="text-left">
                <p className="font-bold text-sm" style={{ color: 'var(--text-base)' }}>
                  {selectedVehicle ? selectedVehicle.name : 'Select Vehicle'}
                </p>
                {selectedVehicle && (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {selectedVehicle.seats} seats · {selectedVehicle.category} · {fmt(isLocal ? selectedVehicle.localRate : selectedVehicle.perDayRate)}
                  </p>
                )}
              </div>
            </div>
            <ChevronDown className="w-4 h-4 shrink-0 transition-transform"
              style={{ color: '#f0c040', transform: vehicleOpen ? 'rotate(180deg)' : 'none' }} />
          </button>
        </div>
      </div>

      {/* ── Vehicle picker panel (inline, below the card) ── */}
      {vehicleOpen && (
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--glass-border)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-base)' }}>
              {passengers > 0 ? `Vehicles for ${passengers} passenger${passengers > 1 ? 's' : ''}` : 'All Vehicles'}
            </p>
            <button onClick={() => setVehicleOpen(false)} className="text-xs" style={{ color: 'var(--text-muted)' }}>Close ×</button>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {vehicles.filter(v => passengers === 0 || v.seats >= passengers).map(v => {
              const rate = isLocal ? v.localRate : v.perDayRate
              const iconType = vehicleIcon(v.category)
              const isSelected = selectedVehicle?.name === v.name
              return (
                <button key={v.name} onClick={() => handleVehicleSelect(v)}
                  className="flex items-center gap-4 p-3 rounded-xl border-2 text-left transition-all"
                  style={{
                    background: isSelected ? 'rgba(201,168,64,0.1)' : 'var(--glass-bg)',
                    borderColor: isSelected ? 'rgba(201,168,64,0.6)' : 'var(--glass-border)',
                    cursor: 'pointer',
                  }}>
                  <div className="shrink-0 opacity-80">
                    <VehicleSVG type={iconType} size={44} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-base)' }}>{v.name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{v.seats} seats · {v.category}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>₹{v.ratePerKm}/km extra</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-base" style={{ color: '#f0c040' }}>{fmt(rate)}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{isLocal ? '8hr pkg' : 'per day'}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Quotation Summary ── */}
      {showSummary && (
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="font-bold text-base" style={{ color: 'var(--text-base)' }}>Quotation Summary</h2>
              {savedQuoteNo && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{savedQuoteNo}</p>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleSave}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all hover:scale-105"
                style={saved
                  ? { background: 'rgba(52,211,153,0.15)', borderColor: 'rgba(52,211,153,0.4)', color: '#34d399' }
                  : { background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--text-muted)' }
                }>
                {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                {saved ? 'Saved!' : 'Save'}
              </button>
              <button onClick={handleWhatsApp}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all hover:scale-105"
                style={{ background: 'rgba(37,211,102,0.12)', borderColor: 'rgba(37,211,102,0.4)', color: '#25d366' }}>
                <MessageCircle className="w-4 h-4" /> WhatsApp
              </button>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold"
                style={{ background: 'var(--glass-bg)', borderColor: finalAmount !== '' ? 'rgba(248,113,113,0.5)' : 'var(--glass-border)', color: 'var(--text-muted)' }}>
                <span>₹</span>
                <input
                  type="number" min={0} value={finalAmount}
                  onChange={e => setFinalAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="Final amt"
                  className="w-20 bg-transparent outline-none font-bold"
                  style={{ color: finalAmount !== '' ? '#f87171' : 'var(--text-muted)' }}
                />
              </div>
              <div className="flex items-center gap-2 relative">
                <button onClick={() => setShowNotePicker(p => !p)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all"
                  style={showNotePicker
                    ? { background: 'rgba(240,192,64,0.12)', borderColor: 'rgba(240,192,64,0.4)', color: '#f0c040' }
                    : { background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--text-muted)' }}>
                  Notes ({selectedNotes.size})
                </button>
                <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs" style={{ color: 'var(--text-muted)' }}>
                  <input type="checkbox" checked={includeTnc} onChange={e => setIncludeTnc(e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-yellow-400 cursor-pointer" />
                  T&amp;C
                </label>
                <button onClick={handlePrint} className="btn-primary flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold">
                  <Printer className="w-4 h-4" /> Print PDF
                </button>
                {showNotePicker && (
                  <div className="absolute bottom-full right-0 mb-2 z-50 rounded-2xl p-4 space-y-2 w-72 shadow-xl"
                    style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--glass-border)' }}>
                    <p className="text-xs font-bold mb-2" style={{ color: 'var(--text-base)' }}>Notes in PDF</p>
                    {[
                      { id: 'min_km',      label: 'Minimum km per day + extra km rate' },
                      { id: 'toll_extra',  label: 'Toll, parking & taxes extra' },
                      { id: 'toll_incl',   label: 'Toll included, only parking extra' },
                      { id: 'atal_setu',   label: 'Atal Setu toll extra' },
                      { id: 'border_tax',  label: 'Border / interstate tax extra' },
                      { id: 'valid',       label: 'Quotation valid for 3 days' },
                      { id: 'advance',     label: '25% advance to confirm booking' },
                      { id: 'ref_image',   label: 'Vehicle images for reference only' },
                      { id: 'inclusive',   label: 'All-inclusive — no extras' },
                      { id: 'cancel',      label: 'Cancellation policy applies' },
                    ].map(n => (
                      <label key={n.id} className="flex items-center gap-2.5 cursor-pointer group">
                        <input type="checkbox"
                          checked={selectedNotes.has(n.id)}
                          onChange={e => {
                            const next = new Set(selectedNotes)
                            e.target.checked ? next.add(n.id) : next.delete(n.id)
                            setSelectedNotes(next)
                          }}
                          className="w-3.5 h-3.5 rounded accent-yellow-400 cursor-pointer shrink-0" />
                        <span className="text-xs group-hover:text-white transition-colors" style={{ color: 'var(--text-muted)' }}>{n.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Vehicle', value: selectedVehicle.name },
              isLocal ? { label: 'Package', value: '8hr / 80km' } : { label: 'Days', value: `${days} day${days > 1 ? 's' : ''}` },
              { label: 'Total KM', value: `${result?.totalKm ?? localResult?.actualKm ?? 0} km` },
              { label: 'Passengers', value: form.passengers || '—' },
            ].map(item => (
              <div key={item.label} className="rounded-xl p-3 text-center"
                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{item.label}</p>
                <p className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>{item.value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--glass-border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--glass-bg)', borderBottom: '1px solid var(--glass-border)' }}>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Description</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold w-28" style={{ color: 'var(--text-muted)' }}>Rate</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold w-16" style={{ color: 'var(--text-muted)' }}>Qty</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold w-28" style={{ color: 'var(--text-muted)' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {result && (() => {
                  const kmRatePerDay = selectedVehicle.perDayRate - selectedVehicle.driverAllowancePerDay - selectedVehicle.permitPerDay
                  const daysLabel = `${result.days} day${result.days > 1 ? 's' : ''}`
                  return (
                    <>
                      <Row4
                        label={`Vehicle charges — ${selectedVehicle.name}`}
                        rate={`${result.minKm} km × ₹${selectedVehicle.ratePerKm}/km`}
                        qty={daysLabel}
                        value={fmt(kmRatePerDay * result.days)}
                      />
                      {selectedVehicle.driverAllowancePerDay > 0 && (
                        <Row4
                          label="Driver allowance"
                          rate={`${fmt(selectedVehicle.driverAllowancePerDay)}/day`}
                          qty={daysLabel}
                          value={fmt(selectedVehicle.driverAllowancePerDay * result.days)}
                          muted
                        />
                      )}
                      {selectedVehicle.permitPerDay > 0 && (
                        <Row4
                          label="Permit"
                          rate={`${fmt(selectedVehicle.permitPerDay)}/day`}
                          qty={daysLabel}
                          value={fmt(selectedVehicle.permitPerDay * result.days)}
                          muted
                        />
                      )}
                      {result.extraKm > 0 && (
                        <Row4
                          label={`Extra km — ${result.extraKm} km beyond ${result.minKm} km/day limit`}
                          rate={`₹${selectedVehicle.ratePerKm}/km`}
                          qty={`${result.extraKm} km`}
                          value={fmt(result.extraKmCost)}
                        />
                      )}
                    </>
                  )
                })()}
                {localResult && (
                  <>
                    <Row4
                      label="Local package — 8 hrs / 80 km included"
                      rate={fmt(selectedVehicle.localRate)}
                      qty="1 package"
                      value={fmt(localResult.baseCost)}
                    />
                    {localResult.extraKm > 0 && (
                      <Row4
                        label={`Extra km — ${localResult.extraKm} km beyond 80 km limit`}
                        rate={`₹${selectedVehicle.ratePerKm}/km`}
                        qty={`${localResult.extraKm} km`}
                        value={fmt(localResult.extraKmCost)}
                      />
                    )}
                  </>
                )}
                {nightTier !== 'normal' && selectedVehicle && (
                  <Row4
                    label={`Pickup night surcharge (${TIER_LABEL[nightTier]})`}
                    rate={nightTier === 'full_day' ? fmt(selectedVehicle.perDayRate) : fmt(selectedVehicle.driverAllowancePerDay)}
                    qty="1"
                    value={fmt(pickupSurcharge(nightTier, selectedVehicle))}
                    muted
                  />
                )}
                {retTier !== 'normal' && selectedVehicle && (
                  <Row4
                    label={`Return night surcharge (${TIER_LABEL[retTier]})`}
                    rate={retTier === 'full_day' ? fmt(selectedVehicle.perDayRate) : fmt(selectedVehicle.driverAllowancePerDay)}
                    qty="1"
                    value={fmt(returnSurcharge(retTier, selectedVehicle))}
                    muted
                  />
                )}
                {retTier === 'night_da_permit' && selectedVehicle.permitPerDay > 0 && (
                  <Row4
                    label="Night permit (return after 1 AM)"
                    rate={fmt(selectedVehicle.permitPerDay)}
                    qty="1"
                    value={fmt(selectedVehicle.permitPerDay)}
                    muted
                  />
                )}
                {finalAmount !== '' && discountAmount > 0 && (
                  <tr style={{ borderTop: '1px solid var(--glass-border)' }}>
                    <td className="px-4 py-2.5 text-sm" style={{ color: '#f87171' }}>Negotiated discount</td>
                    <td colSpan={2} />
                    <td className="px-4 py-2.5 text-right font-semibold" style={{ color: '#f87171' }}>− {fmt(discountAmount)}</td>
                  </tr>
                )}
                <tr style={{ background: 'rgba(201,168,64,0.08)', borderTop: '2px solid rgba(201,168,64,0.3)' }}>
                  <td className="px-4 py-3 font-bold text-sm" style={{ color: 'var(--text-base)' }}>Total</td>
                  <td colSpan={2} />
                  <td className="px-4 py-3 font-bold text-right text-gold-400 text-lg">{fmt(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="text-xs space-y-1 px-1" style={{ color: 'var(--text-muted)' }}>
            {result && <p>&bull; Minimum {selectedVehicle.minKmPerDay} km/day applies. Toll, parking &amp; state taxes extra.</p>}
            {localResult && <p>&bull; Local package: 8 hours &amp; 80 km included. Extra km at &#8377;{selectedVehicle.ratePerKm}/km.</p>}
            <p>&bull; GST applicable as per government norms. Rate valid for one-way trip only.</p>
          </div>
        </div>
      )}
    </div>
  )
}

function VehicleSVG({ type, size = 40 }: { type: 'car' | 'van' | 'bus'; size?: number }) {
  if (type === 'bus') return (
    <svg width={size} height={size * 0.55} viewBox="0 0 80 44" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="4" width="76" height="30" rx="4" stroke="currentColor" strokeWidth="2" fill="none" />
      <rect x="6" y="8" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="22" y="8" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="38" y="8" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="54" y="8" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <line x1="2" y1="22" x2="78" y2="22" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2" y="34" width="76" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="16" cy="40" r="4" stroke="currentColor" strokeWidth="2" fill="none" />
      <circle cx="64" cy="40" r="4" stroke="currentColor" strokeWidth="2" fill="none" />
      <rect x="0" y="14" width="3" height="10" rx="1" fill="currentColor" opacity="0.4" />
    </svg>
  )
  if (type === 'van') return (
    <svg width={size} height={size * 0.65} viewBox="0 0 80 52" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 30 L4 14 Q4 8 10 8 L52 8 Q58 8 62 14 L76 28 L76 38 L4 38 Z" stroke="currentColor" strokeWidth="2" fill="none" />
      <rect x="10" y="12" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="32" y="12" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M54 14 L72 26" stroke="currentColor" strokeWidth="1.5" />
      <line x1="4" y1="30" x2="76" y2="30" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18" cy="43" r="5" stroke="currentColor" strokeWidth="2" fill="none" />
      <circle cx="62" cy="43" r="5" stroke="currentColor" strokeWidth="2" fill="none" />
      <rect x="68" y="20" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  )
  // car
  return (
    <svg width={size} height={size * 0.55} viewBox="0 0 80 44" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 28 L6 20 Q6 16 10 16 L20 10 Q24 8 34 8 L52 8 Q60 8 64 12 L74 20 L74 28 Q74 32 70 32 L10 32 Q6 32 6 28 Z" stroke="currentColor" strokeWidth="2" fill="none" />
      <rect x="18" y="10" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="40" y="10" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="20" cy="37" r="5" stroke="currentColor" strokeWidth="2" fill="none" />
      <circle cx="60" cy="37" r="5" stroke="currentColor" strokeWidth="2" fill="none" />
      <line x1="6" y1="24" x2="74" y2="24" stroke="currentColor" strokeWidth="1" strokeOpacity="0.4" />
    </svg>
  )
}

function RoadVehicle({ type, flip = false, size = 44 }: { type: 'car' | 'van' | 'bus'; flip?: boolean; size?: number }) {
  const s: React.CSSProperties = { display: 'block', transform: flip ? 'scaleX(-1)' : 'none' }
  if (type === 'bus') return (
    <svg width={size} height={Math.round(size * 0.42)} viewBox="0 0 80 34" fill="none" style={s}>
      <rect x="1" y="1" width="78" height="24" rx="3" fill="#4a5568" stroke="#5a6578" strokeWidth="1"/>
      <rect x="4" y="4" width="11" height="8" rx="1" fill="#90cdf4" opacity="0.9"/>
      <rect x="19" y="4" width="11" height="8" rx="1" fill="#90cdf4" opacity="0.9"/>
      <rect x="34" y="4" width="11" height="8" rx="1" fill="#90cdf4" opacity="0.9"/>
      <rect x="49" y="4" width="11" height="8" rx="1" fill="#90cdf4" opacity="0.9"/>
      <rect x="63" y="7" width="10" height="7" rx="1" fill="#fbbf24" opacity="0.95"/>
      <rect x="1" y="7" width="6" height="7" rx="1" fill="#f87171" opacity="0.8"/>
      <rect x="1" y="25" width="78" height="4" rx="1" fill="#2d3748"/>
      <circle cx="16" cy="31" r="3.5" fill="#1a202c" stroke="#718096" strokeWidth="1.2"/>
      <circle cx="16" cy="31" r="1.2" fill="#4a5568"/>
      <circle cx="64" cy="31" r="3.5" fill="#1a202c" stroke="#718096" strokeWidth="1.2"/>
      <circle cx="64" cy="31" r="1.2" fill="#4a5568"/>
    </svg>
  )
  if (type === 'van') return (
    <svg width={size} height={Math.round(size * 0.52)} viewBox="0 0 80 42" fill="none" style={s}>
      <path d="M2 32 L2 16 Q2 8 9 8 L50 8 Q57 8 62 14 L78 28 L78 36 L2 36 Z" fill="#4a5568" stroke="#5a6578" strokeWidth="1"/>
      <rect x="8" y="11" width="16" height="13" rx="2" fill="#90cdf4" opacity="0.9"/>
      <rect x="28" y="11" width="18" height="13" rx="2" fill="#90cdf4" opacity="0.9"/>
      <path d="M50 12 L76 28" stroke="#5a6578" strokeWidth="1"/>
      <rect x="68" y="22" width="9" height="8" rx="1" fill="#fbbf24" opacity="0.95"/>
      <rect x="2" y="22" width="5" height="8" rx="1" fill="#f87171" opacity="0.8"/>
      <circle cx="18" cy="39" r="4" fill="#1a202c" stroke="#718096" strokeWidth="1.2"/>
      <circle cx="18" cy="39" r="1.5" fill="#4a5568"/>
      <circle cx="62" cy="39" r="4" fill="#1a202c" stroke="#718096" strokeWidth="1.2"/>
      <circle cx="62" cy="39" r="1.5" fill="#4a5568"/>
    </svg>
  )
  return (
    <svg width={size} height={Math.round(size * 0.48)} viewBox="0 0 80 38" fill="none" style={s}>
      <path d="M4 26 L4 18 Q4 14 8 14 L18 8 Q22 6 30 6 L52 6 Q60 6 64 10 L76 18 L76 28 Q76 30 72 30 L8 30 Q4 30 4 26Z" fill="#e53e3e" stroke="#c53030" strokeWidth="1"/>
      <rect x="18" y="8" width="16" height="14" rx="2" fill="#90cdf4" opacity="0.9"/>
      <rect x="38" y="8" width="22" height="14" rx="2" fill="#90cdf4" opacity="0.9"/>
      <rect x="66" y="18" width="9" height="7" rx="1" fill="#fbbf24" opacity="0.95"/>
      <rect x="4" y="19" width="6" height="6" rx="1" fill="#f87171" opacity="0.8"/>
      <circle cx="20" cy="35" r="4.5" fill="#1a202c" stroke="#718096" strokeWidth="1.2"/>
      <circle cx="20" cy="35" r="1.5" fill="#4a5568"/>
      <circle cx="60" cy="35" r="4.5" fill="#1a202c" stroke="#718096" strokeWidth="1.2"/>
      <circle cx="60" cy="35" r="1.5" fill="#4a5568"/>
    </svg>
  )
}

function RoadVisual({ from, to, roundTrip, vehicleType }: { from: string; to: string; roundTrip: boolean; vehicleType: 'car' | 'van' | 'bus' }) {
  const label = (s: string) => s.length > 22 ? s.slice(0, 22) + '…' : s
  const roadH = 38
  const gapH  = 10
  const arcW  = (roadH * 2 + gapH) / 2   // = 43 — makes a perfect semicircle

  return (
    <div className="mx-5 mb-4 rounded-xl px-4 py-3"
      style={{ background: 'rgba(0,0,0,0.22)', border: '1px solid var(--glass-border)', overflow: 'hidden' }}>
      <style>{`
        @keyframes rv-fwd {
          0%   { left:-60px; opacity:0 }
          4%   { opacity:1 }
          46%  { opacity:1 }
          50%  { left:calc(100% + 4px); opacity:0 }
          51%  { left:-60px; opacity:0 }
          100% { left:-60px; opacity:0 }
        }
        @keyframes rv-ret {
          0%   { right:-60px; opacity:0 }
          50%  { right:-60px; opacity:0 }
          54%  { opacity:1 }
          96%  { opacity:1 }
          100% { right:calc(100% + 4px); opacity:0 }
        }
      `}</style>

      {/* Labels */}
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
        <span style={{ fontSize:11, fontWeight:700, color:'#f0c040' }}>📍 {label(from)}</span>
        <span style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)' }}>{label(to)} 🏁</span>
      </div>

      {/* Road layout */}
      <div style={{ display:'flex', alignItems:'stretch' }}>

        {/* ── Lanes (left side) ── */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', gap: roundTrip ? gapH : 0 }}>

          {/* Top lane — forward */}
          <div style={{ height:roadH, background:'#252525', borderRadius: roundTrip ? '8px 0 0 8px' : '8px', position:'relative', overflow:'hidden' }}>
            <div style={{ position:'absolute', top:'50%', left:8, right:8, height:3, transform:'translateY(-50%)',
              background:'repeating-linear-gradient(90deg,rgba(240,192,64,0.65) 0,rgba(240,192,64,0.65) 18px,transparent 18px,transparent 32px)' }} />
            <div style={{ position:'absolute', top:'50%', transform:'translateY(-50%)', animation:'rv-fwd 6s linear infinite' }}>
              <RoadVehicle type={vehicleType} size={vehicleType==='bus'?52:vehicleType==='van'?46:42} />
            </div>
          </div>

          {/* Bottom lane — return (round trip only) */}
          {roundTrip && (
            <div style={{ height:roadH, background:'#252525', borderRadius:'8px 0 0 8px', position:'relative', overflow:'hidden' }}>
              <div style={{ position:'absolute', top:'50%', left:8, right:8, height:3, transform:'translateY(-50%)',
                background:'repeating-linear-gradient(90deg,rgba(240,192,64,0.45) 0,rgba(240,192,64,0.45) 18px,transparent 18px,transparent 32px)' }} />
              <div style={{ position:'absolute', top:'50%', transform:'translateY(-50%)', animation:'rv-ret 6s linear infinite' }}>
                <RoadVehicle type={vehicleType} size={vehicleType==='bus'?52:vehicleType==='van'?46:42} flip />
              </div>
            </div>
          )}
        </div>

        {/* ── U-turn arc (right side) ── */}
        {roundTrip && (
          <div style={{
            width: arcW,
            height: roadH * 2 + gapH,
            background: '#252525',
            borderRadius: `0 ${arcW}px ${arcW}px 0`,
            flexShrink: 0,
          }} />
        )}
      </div>
    </div>
  )
}

function InputBox({ label, icon, children, error }: { label: string; icon: React.ReactNode; children: React.ReactNode; error?: boolean }) {
  return (
    <div className="rounded-xl border px-3 pt-2 pb-2.5 transition-colors"
      style={{ background: 'var(--glass-bg)', borderColor: error ? 'rgba(248,113,113,0.6)' : 'var(--glass-border)' }}>
      <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider mb-1"
        style={{ color: error ? '#f87171' : 'var(--text-muted)' }}>
        {icon}<span>{label}</span>
      </label>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
      <td className="px-4 py-2.5 text-sm" style={{ color: 'var(--text-base)' }}>{label}</td>
      <td className="px-4 py-2.5 text-sm text-right font-medium" style={{ color: 'var(--text-base)' }}>{value}</td>
    </tr>
  )
}

function Row4({ label, rate, qty, value, muted }: { label: string; rate: string; qty: string; value: string; muted?: boolean }) {
  const color = muted ? 'var(--text-muted)' : 'var(--text-base)'
  return (
    <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
      <td className="px-4 py-2 text-sm" style={{ color }}>{label}</td>
      <td className="px-4 py-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{rate}</td>
      <td className="px-4 py-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{qty}</td>
      <td className="px-4 py-2 text-right text-sm font-medium" style={{ color }}>{value}</td>
    </tr>
  )
}
