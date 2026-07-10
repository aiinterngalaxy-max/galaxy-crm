import type { Vehicle, QuotationResult, LocalQuotationResult } from './data/rateCard'

interface PrintArgs {
  form: {
    clientName: string
    clientPhone: string
    clientEmail: string
    pickupDate: string
    pickupTime?: string
    returnTime?: string
    pickupLocation: string
    dropDate: string
    dropLocation: string
    passengers: string
    estimatedKm: string
    tripType: string
    isRoundTrip: boolean
  }
  vehicle: Vehicle
  result: QuotationResult | null
  localResult: LocalQuotationResult | null
  days: number
  quoteNo: string
  nightTier?: 'normal' | 'night_da' | 'night_da_permit' | 'full_day'
  retTier?: 'normal' | 'night_da' | 'night_da_permit' | 'full_day'
  nightExtra?: number
  overrideTotalAmount?: number
  includeTnc?: boolean
  selectedNotes?: Set<string>
}

function fmtTime(t: string): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ampm = h < 12 ? 'AM' : 'PM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}

const fmt = (n: number) => `&#x20B9;${n.toLocaleString('en-IN')}`
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

const TIER_LABEL: Record<string, string> = {
  normal: '',
  night_da: 'NIGHT — DA ×2',
  night_da_permit: 'NIGHT — DA ×2 + Permit',
  full_day: 'NIGHT — Full Extra Day',
}

async function getLogoBase64(): Promise<string> {
  try {
    const res = await fetch('/topz-logo.png')
    const blob = await res.blob()
    return await new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(blob)
    })
  } catch { return '' }
}

export async function printQuotation({ form, vehicle, result, localResult, days, quoteNo, nightTier = 'normal', retTier = 'normal', nightExtra = 0, overrideTotalAmount, includeTnc = false, selectedNotes }: PrintArgs) {
  const has = (id: string) => !selectedNotes || selectedNotes.has(id)
  const logoDataUrl = await getLogoBase64()
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  const isLocal = form.tripType === 'local'
  const baseAmount = overrideTotalAmount ?? result?.total ?? localResult?.total ?? 0
  const totalAmount = baseAmount + nightExtra

  const tripRows = isLocal ? `
    <div class="trip-cell">
      <div class="label">Trip Type</div>
      <div class="value">Local Package</div>
    </div>
    <div class="trip-cell">
      <div class="label">Package</div>
      <div class="value">8 Hours / 80 km</div>
    </div>
    <div class="trip-cell">
      <div class="label">Date</div>
      <div class="value">${fmtDate(form.pickupDate)}</div>
    </div>
    <div class="trip-cell">
      <div class="label">Pickup Location</div>
      <div class="value">${form.pickupLocation}</div>
    </div>
    ${form.dropLocation ? `<div class="trip-cell"><div class="label">Drop Location</div><div class="value">${form.dropLocation}</div></div>` : ''}
    <div class="trip-cell">
      <div class="label">Passengers</div>
      <div class="value">${form.passengers}</div>
    </div>
    ${form.pickupTime ? `<div class="trip-cell"><div class="label">Pickup Time</div><div class="value">${fmtTime(form.pickupTime)}${nightTier !== 'normal' ? ` &nbsp;<span style="color:#c53030;font-size:10px;font-weight:700;">${TIER_LABEL[nightTier]}</span>` : ''}</div></div>` : ''}
  ` : `
    <div class="trip-cell">
      <div class="label">Pickup Date</div>
      <div class="value">${fmtDate(form.pickupDate)}</div>
    </div>
    <div class="trip-cell">
      <div class="label">Return Date</div>
      <div class="value">${fmtDate(form.dropDate)}</div>
    </div>
    <div class="trip-cell">
      <div class="label">Pickup Location</div>
      <div class="value">${form.pickupLocation}</div>
    </div>
    <div class="trip-cell">
      <div class="label">Drop Location</div>
      <div class="value">${form.dropLocation}</div>
    </div>
    <div class="trip-cell">
      <div class="label">Passengers</div>
      <div class="value">${form.passengers}</div>
    </div>
    <div class="trip-cell">
      <div class="label">Duration</div>
      <div class="value">${days} Day${days > 1 ? 's' : ''} &bull; ${result?.totalKm ?? 0} km</div>
    </div>
    ${form.pickupTime ? `<div class="trip-cell"><div class="label">Pickup Time</div><div class="value">${fmtTime(form.pickupTime)}${nightTier !== 'normal' ? ` &nbsp;<span style="color:#c53030;font-size:10px;font-weight:700;">${TIER_LABEL[nightTier]}</span>` : ''}</div></div>` : ''}
    ${form.returnTime ? `<div class="trip-cell"><div class="label">Return Time</div><div class="value">${fmtTime(form.returnTime)}</div></div>` : ''}
  `

  const pricingRows = result ? `
    <tr>
      <td>Base Rate</td>
      <td>${fmt(vehicle.perDayRate)}/day &times; ${result.days} day${result.days > 1 ? 's' : ''}</td>
      <td>${fmt(result.baseCost)}</td>
    </tr>
    <tr>
      <td>Minimum KM Package</td>
      <td>${vehicle.minKmPerDay} km/day &times; ${result.days} day${result.days > 1 ? 's' : ''}</td>
      <td>Included</td>
    </tr>
    ${result.extraKm > 0 ? `<tr><td>Extra KM Charges</td><td>${result.extraKm} km &times; &#x20B9;${vehicle.ratePerKm}/km</td><td>${fmt(result.extraKmCost)}</td></tr>` : ''}
    ${vehicle.permitPerDay > 0 ? `<tr><td>Permit Charges</td><td>${fmt(vehicle.permitPerDay)}/day &times; ${result.days} day${result.days > 1 ? 's' : ''}</td><td>Included</td></tr>` : ''}
    ${vehicle.driverAllowancePerDay > 0 ? `<tr><td>Driver Allowance${nightTier !== 'normal' || retTier !== 'normal' ? ` <span style="color:#c53030;font-size:10px;">(Night surcharge applied)</span>` : ''}</td><td>${fmt(vehicle.driverAllowancePerDay)}/day &times; ${result.days} day${result.days > 1 ? 's' : ''}</td><td>Included</td></tr>` : ''}
    ${(nightTier !== 'normal' && nightTier !== 'full_day') ? `<tr><td>Pickup Night Surcharge <span style="color:#c53030;font-size:10px;">(DA ×2)</span></td><td>${fmt(vehicle.driverAllowancePerDay)}</td><td>${fmt(vehicle.driverAllowancePerDay)}</td></tr>` : ''}
    ${(retTier !== 'normal' && retTier !== 'full_day') ? `<tr><td>Return Night Surcharge <span style="color:#c53030;font-size:10px;">(DA ×2)</span></td><td>${fmt(vehicle.driverAllowancePerDay)}</td><td>${fmt(vehicle.driverAllowancePerDay)}</td></tr>` : ''}
    ${retTier === 'night_da_permit' && vehicle.permitPerDay > 0 ? `<tr><td>Return Night Permit <span style="color:#c53030;font-size:10px;">(after 1AM)</span></td><td>${fmt(vehicle.permitPerDay)}</td><td>${fmt(vehicle.permitPerDay)}</td></tr>` : ''}
    ${nightTier === 'full_day' ? `<tr><td>Pickup Late Night Surcharge <span style="color:#c53030;font-size:10px;">(DA ×2)</span></td><td>${fmt(vehicle.driverAllowancePerDay)}</td><td>${fmt(vehicle.driverAllowancePerDay)}</td></tr>` : ''}
    ${retTier === 'full_day' ? `<tr><td>Extra Day — Return Late Night</td><td>${fmt(vehicle.perDayRate)}</td><td>${fmt(vehicle.perDayRate)}</td></tr>` : ''}
  ` : localResult ? `
    <tr>
      <td>Local Package</td>
      <td>8 Hours / 80 km</td>
      <td>${fmt(localResult.baseCost)}</td>
    </tr>
    ${localResult.extraKm > 0 ? `<tr><td>Extra KM Charges</td><td>${localResult.extraKm} km &times; &#x20B9;${vehicle.ratePerKm}/km</td><td>${fmt(localResult.extraKmCost)}</td></tr>` : ''}
  ` : ''

  const noteLines: string[] = []
  if (isLocal) {
    if (has('min_km')) noteLines.push(`Local package includes 8 hours and 80 km. Extra km charged at &#x20B9;${vehicle.ratePerKm}/km.`)
    if (has('waiting')) noteLines.push('Waiting charges apply beyond 8 hours at actuals.')
  } else {
    if (has('min_km')) noteLines.push(`Minimum ${vehicle.minKmPerDay} km per day applies. Extra km charged at &#x20B9;${vehicle.ratePerKm}/km.`)
    if (has('one_way')) noteLines.push('One-way fare only.')
  }
  if (has('toll')) noteLines.push('Tolls, parking charges, and state taxes are extra unless specified.')
  if (has('inclusive')) noteLines.push('All-inclusive fare — no additional charges.')
  if (has('valid')) noteLines.push('This quotation is valid for 7 days from the date of issue.')
  if (has('advance')) noteLines.push('50% advance required to confirm booking. Balance to be paid before departure.')
  if (has('waiting') && !isLocal) noteLines.push('Waiting charges apply beyond the complimentary waiting period.')
  const termsText = noteLines.map(l => `<p>${l}</p>`).join('\n    ')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${form.clientName} - Topz Cab Quotation</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; background: #fff; font-size: 13px; }
  .page { max-width: 800px; margin: 0 auto; padding: 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 20px; border-bottom: 3px solid #1a1a2e; margin-bottom: 24px; }
  .brand-name { font-size: 32px; font-weight: 900; color: #1a1a2e; letter-spacing: -1px; }
  .brand-tagline { font-size: 11px; color: #666; margin-top: 2px; }
  .brand-contact { font-size: 11px; color: #555; text-align: right; line-height: 1.7; }
  .meta-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
  .meta-box { background: #f8f8f8; border-radius: 10px; padding: 14px 18px; min-width: 200px; }
  .meta-box h3 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 8px; }
  .meta-box p { font-size: 13px; color: #1a1a2e; line-height: 1.6; }
  .meta-box p strong { font-weight: 700; }
  .quote-no-box { text-align: right; }
  .quote-no-box .qno { font-size: 22px; font-weight: 800; color: #1a1a2e; }
  .quote-no-box .qdate { font-size: 11px; color: #888; margin-top: 2px; }
  .section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #888; margin-bottom: 10px; }
  .trip-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
  .trip-cell { background: #f8f8f8; border-radius: 8px; padding: 12px 14px; }
  .trip-cell .label { font-size: 10px; color: #999; font-weight: 600; text-transform: uppercase; margin-bottom: 3px; }
  .trip-cell .value { font-size: 13px; color: #1a1a2e; font-weight: 600; }
  .vehicle-bar { display: flex; justify-content: space-between; align-items: center; background: #1a1a2e; color: #fff; border-radius: 10px; padding: 14px 18px; margin-bottom: 24px; }
  .vehicle-bar .vname { font-size: 16px; font-weight: 700; }
  .vehicle-bar .vmeta { font-size: 11px; color: #aaa; margin-top: 2px; }
  .vehicle-bar .vrate { font-size: 20px; font-weight: 800; color: #f0c040; }
  .vehicle-bar .vrate-label { font-size: 10px; color: #aaa; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { background: #f0f0f0; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #666; padding: 10px 14px; text-align: left; }
  th:last-child { text-align: right; }
  td { padding: 11px 14px; border-bottom: 1px solid #eee; font-size: 13px; color: #1a1a2e; }
  td:last-child { text-align: right; font-weight: 600; }
  .total-row td { background: #1a1a2e; color: #fff; font-weight: 800; font-size: 15px; border-bottom: none; }
  .total-row td:last-child { color: #f0c040; font-size: 18px; }
  .terms { background: #f8f8f8; border-radius: 8px; padding: 14px 16px; margin-bottom: 24px; }
  .terms p { font-size: 11px; color: #666; line-height: 1.8; }
  .terms p::before { content: "•  "; }
  .footer { border-top: 2px solid #eee; padding-top: 16px; display: flex; justify-content: space-between; align-items: center; }
  .footer p { font-size: 11px; color: #aaa; }
  .footer .thank { font-size: 13px; font-weight: 700; color: #1a1a2e; }
  .tnc { border: 1px solid #e5e5e5; border-radius: 8px; padding: 14px 16px; margin-bottom: 24px; background: #fafafa; }
  .tnc-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; }
  .tnc-item { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; border-bottom: 1px solid #eee; font-size: 10.5px; color: #333; line-height: 1.55; }
  .tnc-item:last-child { border-bottom: none; }
  .tnc-n { min-width: 18px; height: 18px; background: #1a1a2e; color: #f0c040; border-radius: 4px; font-size: 9px; font-weight: 800; display: flex; align-items: center; justify-content: center; margin-top: 1px; flex-shrink: 0; }
  .tnc-item strong { font-size: 10.5px; font-weight: 700; color: #1a1a2e; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .page { padding: 20px; } }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <div style="display:flex;align-items:center;gap:14px">
      ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Topz Cab" style="width:72px;height:72px;object-fit:contain" />` : ''}
      <div>
        <div class="brand-name">TOPZ CAB</div>
        <div class="brand-tagline">Outstation &middot; Corporate &middot; Luxury Travel</div>
      </div>
    </div>
    <div class="brand-contact">
      <strong>Topz Cab Services</strong><br/>
      Pune, Maharashtra<br/>
      Contact details coming soon<br/>
      GST: Applied as per norms
    </div>
  </div>

  <div class="meta-row">
    <div class="meta-box">
      <h3>Bill To</h3>
      <p><strong>${form.clientName}</strong></p>
      ${form.clientPhone ? `<p>&#128222; ${form.clientPhone}</p>` : ''}
      ${form.clientEmail ? `<p>&#9993; ${form.clientEmail}</p>` : ''}
    </div>
    <div class="meta-box quote-no-box">
      <h3>Quotation</h3>
      <div class="qno">${quoteNo}</div>
      <div class="qdate">Date: ${today}</div>
    </div>
  </div>

  <p class="section-title">Trip Details</p>
  <div class="trip-grid">
    ${tripRows}
  </div>

  <div class="vehicle-bar">
    <div>
      <div class="vname">${vehicle.name}</div>
      <div class="vmeta">${vehicle.category} &middot; ${vehicle.seats} Seats &middot; &#x20B9;${vehicle.ratePerKm}/km</div>
    </div>
    <div style="text-align:right">
      <div class="vrate">${fmt(isLocal ? vehicle.localRate : vehicle.perDayRate)}</div>
      <div class="vrate-label">${isLocal ? '8hr / 80km package' : 'Per Day (300 km incl.)'}</div>
    </div>
  </div>

  <p class="section-title">Price Breakdown</p>
  <table>
    <thead><tr><th>Description</th><th>Details</th><th>Amount</th></tr></thead>
    <tbody>
      ${pricingRows}
      <tr class="total-row">
        <td colspan="2">TOTAL AMOUNT</td>
        <td>${fmt(totalAmount)}</td>
      </tr>
    </tbody>
  </table>

  ${noteLines.length > 0 ? `<p class="section-title">Notes</p>
  <div class="terms">
    ${termsText}
  </div>` : ''}

  ${includeTnc ? `<p class="section-title" style="margin-top:20px;">Terms &amp; Conditions</p>
  <div class="tnc">` : '<!--'}
    <div class="tnc-cols">
      <div class="tnc-col">
        <div class="tnc-item"><span class="tnc-n">1</span><div><strong>Booking Confirmation</strong><br/>Booking confirmed only after advance payment. Provide complete trip details including pickup, date, time, destination &amp; passenger count.</div></div>
        <div class="tnc-item"><span class="tnc-n">2</span><div><strong>Payment Policy</strong><br/>Advance required to confirm. Balance paid before or at journey start. Accepted: UPI, Bank Transfer, Cash.</div></div>
        <div class="tnc-item"><span class="tnc-n">3</span><div><strong>Toll, Parking &amp; Taxes</strong><br/>Toll, parking, state taxes &amp; entry fees are extra unless marked "Included." Airport &amp; event parking borne by customer.</div></div>
        <div class="tnc-item"><span class="tnc-n">4</span><div><strong>Extra KM &amp; Hour Charges</strong><br/>Extra km/hour charged per package. Duty starts and ends at agreed time. Garage-to-Garage (Malad to Malad) applicable unless stated.</div></div>
        <div class="tnc-item"><span class="tnc-n">5</span><div><strong>Night Driver Allowance</strong><br/>DA applicable for late-night travel or multi-day trips as per company policy.</div></div>
        <div class="tnc-item"><span class="tnc-n">6</span><div><strong>Waiting Charges</strong><br/>Waiting charges apply beyond the complimentary waiting period.</div></div>
        <div class="tnc-item"><span class="tnc-n">7</span><div><strong>Cancellation Policy</strong><br/>Cancellation charges apply. Advance may be non-refundable during peak seasons, festivals, weekends or special events. Eligible refunds processed per standard policy.</div></div>
        <div class="tnc-item"><span class="tnc-n">8</span><div><strong>Customer Responsibilities</strong><br/>Maintain cleanliness. Smoking, alcohol, illegal activities &amp; prohibited items are strictly prohibited. Damage caused by passengers will be charged.</div></div>
      </div>
      <div class="tnc-col">
        <div class="tnc-item"><span class="tnc-n">9</span><div><strong>Driver &amp; Vehicle</strong><br/>All vehicles regularly serviced &amp; sanitized. Drivers are experienced, licensed &amp; verified. Customers must treat drivers respectfully.</div></div>
        <div class="tnc-item"><span class="tnc-n">10</span><div><strong>Delays &amp; Force Majeure</strong><br/>TopzCab is not responsible for delays due to traffic, road closures, weather, strikes, natural disasters or circumstances beyond our control.</div></div>
        <div class="tnc-item"><span class="tnc-n">11</span><div><strong>Passenger Belongings</strong><br/>Check belongings before leaving the vehicle. TopzCab is not liable for loss, theft or damage to personal belongings left inside.</div></div>
        <div class="tnc-item"><span class="tnc-n">12</span><div><strong>Route &amp; Itinerary Changes</strong><br/>Changes in route, destination or itinerary after trip start may result in additional charges.</div></div>
        <div class="tnc-item"><span class="tnc-n">13</span><div><strong>Safety</strong><br/>Seat belts must be worn. Follow all driver safety instructions. Drivers strictly follow all traffic rules &amp; regulations.</div></div>
        <div class="tnc-item"><span class="tnc-n">14</span><div><strong>Liability</strong><br/>TopzCab's liability is limited to the booked transportation service. Not liable for missed flights, trains, meetings or consequential losses.</div></div>
        <div class="tnc-item"><span class="tnc-n">15</span><div><strong>Acceptance</strong><br/>By confirming a booking, the customer acknowledges they have read, understood &amp; agreed to these Terms &amp; Conditions.</div></div>
      </div>
    </div>
  </div>
  ${includeTnc ? '' : '-->'}

  <div class="footer">
    <div>
      <div class="thank">Thank you for choosing Topz Cab!</div>
      <p style="margin-top:4px;">For queries: Contact your booking agent</p>
    </div>
    <div style="text-align:right">
      <p>Authorised Signature</p>
      <div style="margin-top:28px; border-top:1px solid #ccc; padding-top:4px; min-width:120px; font-size:11px; color:#999;">Topz Cab Services</div>
    </div>
  </div>

</div>
<script>window.onload = () => { window.print() }</script>
</body>
</html>`

  const win = window.open('', '_blank', 'width=900,height=700')
  if (win) { win.document.write(html); win.document.close() }
}
