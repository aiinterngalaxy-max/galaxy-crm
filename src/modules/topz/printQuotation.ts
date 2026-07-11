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
  discountPct?: number
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

function numberToWords(n: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  if (n === 0) return 'Zero Rupees Only'
  function helper(num: number): string {
    if (num === 0) return ''
    if (num < 20) return ones[num] + ' '
    if (num < 100) return tens[Math.floor(num / 10)] + ' ' + helper(num % 10)
    if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred ' + helper(num % 100)
    if (num < 100000) return helper(Math.floor(num / 1000)) + 'Thousand ' + helper(num % 1000)
    if (num < 10000000) return helper(Math.floor(num / 100000)) + 'Lakh ' + helper(num % 100000)
    return helper(Math.floor(num / 10000000)) + 'Crore ' + helper(num % 10000000)
  }
  return helper(n).trim() + ' Rupees Only'
}

async function fetchBase64(path: string): Promise<string> {
  try {
    const res = await fetch(path)
    const blob = await res.blob()
    return await new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(blob)
    })
  } catch { return '' }
}

const getLogoBase64 = () => fetchBase64('/topz-logo.png')

export async function printQuotation({ form, vehicle, result, localResult, days, quoteNo, nightTier = 'normal', retTier = 'normal', nightExtra = 0, overrideTotalAmount, includeTnc = false, selectedNotes, discountPct = 0 }: PrintArgs) {
  const has = (id: string) => !selectedNotes || selectedNotes.has(id)
  const [logoDataUrl, qrDataUrl] = await Promise.all([getLogoBase64(), fetchBase64('/topz-qr.png')])
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  const isLocal = form.tripType === 'local'
  const baseAmount = overrideTotalAmount ?? result?.total ?? localResult?.total ?? 0
  const beforeDiscount = baseAmount + nightExtra
  const discountAmount = Math.round(beforeDiscount * discountPct / 100)
  const totalAmount = beforeDiscount - discountAmount

  // Description block for the main table row
  const dutyType = isLocal
    ? `LOCAL PACKAGE - 8 HRS / 80 KMS`
    : `OUTSTATION - 300 KMS PER DAY (${form.pickupLocation} - ${form.dropLocation})`

  const dateRange = isLocal
    ? fmtDate(form.pickupDate)
    : `${fmtDate(form.pickupDate)}${form.dropDate && form.dropDate !== form.pickupDate ? ` to ${fmtDate(form.dropDate)}` : ''}`

  const pickupTimeStr = form.pickupTime
    ? `Pickup Time: ${fmtTime(form.pickupTime)}${nightTier !== 'normal' ? ` (${TIER_LABEL[nightTier]})` : ''}`
    : ''
  const returnTimeStr = form.returnTime && !isLocal
    ? `Return Time: ${fmtTime(form.returnTime)}${retTier !== 'normal' ? ` (${TIER_LABEL[retTier]})` : ''}`
    : ''

  const descriptionHtml = `
    <strong>Vehicle:</strong> ${vehicle.name} | ${vehicle.category} | ${vehicle.seats} Seater<br/>
    <strong>Duty Type:</strong> ${dutyType}<br/>
    <strong>Date:</strong> ${dateRange}<br/>
    <strong>Passengers:</strong> ${form.passengers}
    ${pickupTimeStr ? `<br/><strong>${pickupTimeStr}</strong>` : ''}
    ${returnTimeStr ? `<br/><strong>${returnTimeStr}</strong>` : ''}
  `

  // Main pricing row
  const baseRate = isLocal ? vehicle.localRate : vehicle.perDayRate
  const qty = isLocal ? 1 : days
  const baseCost = result?.baseCost ?? localResult?.baseCost ?? baseAmount

  // Extra rows
  const extraRows: string[] = []

  if (result?.extraKm && result.extraKm > 0) {
    extraRows.push(`<tr>
      <td style="text-align:center"></td>
      <td>Extra KM Charges — ${result.extraKm} km &times; &#x20B9;${vehicle.ratePerKm}/km</td>
      <td style="text-align:right">${fmt(vehicle.ratePerKm)}</td>
      <td style="text-align:center">${result.extraKm}</td>
      <td style="text-align:right">${fmt(result.extraKmCost)}</td>
    </tr>`)
  }
  if (localResult?.extraKm && localResult.extraKm > 0) {
    extraRows.push(`<tr>
      <td style="text-align:center"></td>
      <td>Extra KM Charges — ${localResult.extraKm} km &times; &#x20B9;${vehicle.ratePerKm}/km</td>
      <td style="text-align:right">${fmt(vehicle.ratePerKm)}</td>
      <td style="text-align:center">${localResult.extraKm}</td>
      <td style="text-align:right">${fmt(localResult.extraKmCost)}</td>
    </tr>`)
  }
  if (nightTier !== 'normal') {
    const extra = nightTier === 'full_day' ? vehicle.perDayRate : vehicle.driverAllowancePerDay
    extraRows.push(`<tr>
      <td style="text-align:center"></td>
      <td>Pickup Night Surcharge (${TIER_LABEL[nightTier]})</td>
      <td style="text-align:right">${fmt(extra)}</td>
      <td style="text-align:center">1</td>
      <td style="text-align:right">${fmt(extra)}</td>
    </tr>`)
  }
  if (retTier !== 'normal') {
    const extra = retTier === 'full_day' ? vehicle.perDayRate : vehicle.driverAllowancePerDay
    extraRows.push(`<tr>
      <td style="text-align:center"></td>
      <td>Return Night Surcharge (${TIER_LABEL[retTier]})</td>
      <td style="text-align:right">${fmt(extra)}</td>
      <td style="text-align:center">1</td>
      <td style="text-align:right">${fmt(extra)}</td>
    </tr>`)
    if (retTier === 'night_da_permit' && vehicle.permitPerDay > 0) {
      extraRows.push(`<tr>
        <td style="text-align:center"></td>
        <td>Return Night Permit (after 1AM)</td>
        <td style="text-align:right">${fmt(vehicle.permitPerDay)}</td>
        <td style="text-align:center">1</td>
        <td style="text-align:right">${fmt(vehicle.permitPerDay)}</td>
      </tr>`)
    }
  }

  // Notes
  const noteLines: string[] = []
  if (isLocal) {
    if (has('min_km')) noteLines.push(`Local package includes 8 hours and 80 km. Extra km charged at &#x20B9;${vehicle.ratePerKm}/km.`)
  } else {
    if (has('min_km')) noteLines.push(`Minimum ${vehicle.minKmPerDay} km per day applies. Extra km charged at &#x20B9;${vehicle.ratePerKm}/km.`)
  }
  if (has('toll_extra')) noteLines.push('Toll charges, parking fees, and state taxes are extra and will be charged at actuals.')
  if (has('toll_incl')) noteLines.push('Toll charges are included in the fare. Parking fees are extra and will be charged at actuals.')
  if (has('atal_setu')) noteLines.push('Atal Setu (Sea Link) toll charges are extra and will be borne by the client.')
  if (has('border_tax')) noteLines.push('Interstate border / entry tax is extra and will be charged at actuals.')
  if (has('valid')) noteLines.push('This quotation is valid for 3 days from the date of issue.')
  if (has('advance')) noteLines.push('25% advance payment required to confirm the booking. Balance to be paid before departure.')
  if (has('ref_image')) noteLines.push('Vehicle images shown are for reference only. Actual vehicle may vary subject to availability.')
  if (has('inclusive')) noteLines.push('All-inclusive fare — no additional charges applicable.')
  if (has('cancel')) noteLines.push('Cancellation policy applies. Advance paid may be non-refundable upon cancellation.')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${form.clientName} - Topz Cab Quotation</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; color: #1a1a1a; background: #fff; font-size: 12px; }
  .page { max-width: 780px; margin: 0 auto; padding: 28px 32px; }

  /* Header */
  .header { display: flex; align-items: flex-start; justify-content: space-between; padding-bottom: 14px; border-bottom: 2px solid #1a1a1a; margin-bottom: 16px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-name { font-size: 28px; font-weight: 900; letter-spacing: -0.5px; color: #1a1a1a; }
  .brand-tagline { font-size: 10px; color: #777; margin-top: 1px; }
  .header-contact { font-size: 10.5px; color: #444; text-align: right; line-height: 1.75; }

  /* Bill To / Quote meta */
  .meta-row { display: flex; justify-content: space-between; margin-bottom: 16px; gap: 20px; }
  .bill-to { font-size: 11px; color: #333; line-height: 1.7; }
  .bill-to strong { font-size: 12px; color: #1a1a1a; }
  .quote-meta { text-align: right; font-size: 11px; color: #333; line-height: 1.7; white-space: nowrap; }
  .quote-meta .qno { font-size: 15px; font-weight: 800; color: #1a1a1a; }

  /* Table */
  table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
  thead tr { background: #1a1a1a; color: #fff; }
  thead th { padding: 8px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; text-align: left; }
  thead th.r { text-align: right; }
  thead th.c { text-align: center; }
  tbody tr { border-bottom: 1px solid #e5e5e5; }
  tbody tr:last-child { border-bottom: none; }
  td { padding: 10px 10px; font-size: 11.5px; vertical-align: top; color: #1a1a1a; }
  td.r { text-align: right; font-weight: 600; }
  td.c { text-align: center; }

  /* Totals */
  .totals-table { width: 100%; border-collapse: collapse; margin-top: 0; }
  .totals-table td { padding: 6px 10px; font-size: 11.5px; border-top: 1px solid #e5e5e5; }
  .totals-table .label { color: #555; }
  .totals-table .val { text-align: right; font-weight: 600; }
  .totals-table .total-row td { background: #1a1a1a; color: #fff; font-weight: 800; font-size: 13px; border-top: none; padding: 9px 10px; }
  .totals-table .total-row .val { color: #f0c040; font-size: 15px; }
  .in-words { font-size: 10.5px; color: #444; padding: 6px 10px; border-top: 1px solid #e5e5e5; font-style: italic; }

  /* Bank + Notes */
  .bottom-row { display: flex; gap: 24px; margin-top: 20px; }
  .bank-box { flex: 1; }
  .bank-box h4 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #1a1a1a; border-bottom: 1px solid #1a1a1a; padding-bottom: 4px; margin-bottom: 8px; }
  .bank-box p { font-size: 10.5px; color: #333; line-height: 1.75; }
  .notes-box { flex: 1; }
  .notes-box h4 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #1a1a1a; border-bottom: 1px solid #1a1a1a; padding-bottom: 4px; margin-bottom: 8px; }
  .notes-box p { font-size: 10.5px; color: #444; line-height: 1.75; }
  .notes-box p::before { content: "• "; }

  /* Footer */
  .footer { margin-top: 20px; border-top: 1px solid #ddd; padding-top: 12px; display: flex; justify-content: space-between; align-items: flex-end; }
  .footer .thank { font-size: 12px; font-weight: 700; color: #1a1a1a; }
  .footer p { font-size: 10px; color: #888; margin-top: 3px; }

  /* T&C */
  .tnc { border: 1px solid #e5e5e5; border-radius: 6px; padding: 12px 14px; margin-top: 20px; background: #fafafa; }
  .tnc-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; color: #1a1a1a; }
  .tnc-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; }
  .tnc-item { display: flex; gap: 7px; align-items: flex-start; padding: 5px 0; border-bottom: 1px solid #eee; font-size: 9.5px; color: #333; line-height: 1.5; }
  .tnc-item:last-child { border-bottom: none; }
  .tnc-n { min-width: 16px; height: 16px; background: #1a1a1a; color: #f0c040; border-radius: 3px; font-size: 8px; font-weight: 800; display: flex; align-items: center; justify-content: center; margin-top: 1px; flex-shrink: 0; }
  .tnc-item strong { font-weight: 700; color: #1a1a1a; }

  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .page { padding: 20px 24px; } }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="brand">
      ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Topz Cab" style="width:60px;height:60px;object-fit:contain" />` : ''}
      <div>
        <div class="brand-name">TOPZ CAB</div>
        <div class="brand-tagline">Outstation &middot; Corporate &middot; Luxury Travel</div>
      </div>
    </div>
    <div class="header-contact">
      <strong>Topzcab</strong><br/>
      Conwood Paragon, 508/510, Opp. Indian Oil Petrol Pump,<br/>
      Near Cama Industrial Estate, Goregaon East, Mumbai 400063<br/>
      📞 +91 77188 82898 &nbsp;|&nbsp; +91 98192 68979<br/>
      ✉ topzonmove@gmail.com
    </div>
  </div>

  <!-- Bill To + Quote Meta -->
  <div class="meta-row">
    <div class="bill-to">
      <strong>${form.clientName}</strong><br/>
      ${form.clientPhone ? `📞 ${form.clientPhone}<br/>` : ''}
      ${form.clientEmail ? `✉ ${form.clientEmail}<br/>` : ''}
    </div>
    <div class="quote-meta">
      <div class="qno">${quoteNo}</div>
      Date: ${today}
    </div>
  </div>

  <!-- Main Table -->
  <table>
    <thead>
      <tr>
        <th style="width:32px" class="c">SR.</th>
        <th>DESCRIPTION</th>
        <th class="r" style="width:90px">RATE</th>
        <th class="c" style="width:50px">QTY</th>
        <th class="r" style="width:90px">AMOUNT</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="c">1</td>
        <td>${descriptionHtml}</td>
        <td class="r">${fmt(baseRate)}</td>
        <td class="c">${qty}</td>
        <td class="r">${fmt(baseCost)}</td>
      </tr>
      ${extraRows.join('\n')}
    </tbody>
  </table>

  <!-- Totals -->
  <table class="totals-table">
    <tbody>
      <tr><td class="label">Sub Total</td><td class="val">${fmt(beforeDiscount)}</td></tr>
      ${discountPct > 0 ? `<tr><td class="label" style="color:#c53030;">Discount (${discountPct}%)</td><td class="val" style="color:#c53030;">− ${fmt(discountAmount)}</td></tr>` : ''}
    </tbody>
    <tr class="in-words"><td colspan="2">In words: <em>${numberToWords(totalAmount)}</em></td></tr>
    <tbody>
      <tr class="total-row"><td class="label">TOTAL</td><td class="val">${fmt(totalAmount)}</td></tr>
    </tbody>
  </table>

  <!-- Bank Details + Notes -->
  <div class="bottom-row">
    <div class="bank-box">
      <h4>Bank Details</h4>
      <div style="display:flex;gap:14px;align-items:flex-start">
        <p>
          <strong>Account Holder:</strong> Krish Ketan Shah<br/>
          <strong>Bank:</strong> Kotak Mahindra Bank<br/>
          <strong>Account Type:</strong> Saving Account<br/>
          <strong>Account No.:</strong> 06510120025723<br/>
          <strong>IFSC:</strong> KKBK0000681<br/>
          <strong>Branch:</strong> Andheri East<br/>
          <strong>UPI:</strong> shahkrish2003@oksbi
        </p>
        ${qrDataUrl ? `<div style="text-align:center;flex-shrink:0">
          <img src="${qrDataUrl}" style="width:220px;height:220px;object-fit:contain;display:block" />
          <span style="font-size:10px;color:#555;font-weight:600">Scan to pay via UPI</span>
        </div>` : ''}
      </div>
    </div>
    ${noteLines.length > 0 ? `<div class="notes-box">
      <h4>Notes</h4>
      ${noteLines.map(l => `<p>${l}</p>`).join('\n      ')}
    </div>` : ''}
  </div>

  <!-- Footer -->
  <div class="footer">
    <div>
      <div class="thank">Thank you for choosing Topz Cab!</div>
      <p>📞 +91 77188 82898 &nbsp;|&nbsp; +91 98192 68979 &nbsp;|&nbsp; ✉ topzonmove@gmail.com</p>
    </div>
  </div>

  <!-- T&C -->
  ${includeTnc ? `<div class="tnc">
    <div class="tnc-title">Terms &amp; Conditions</div>
    <div class="tnc-cols">
      <div>
        <div class="tnc-item"><span class="tnc-n">1</span><div><strong>Booking Confirmation</strong><br/>Booking confirmed only after advance payment. Provide complete trip details including pickup, date, time, destination &amp; passenger count.</div></div>
        <div class="tnc-item"><span class="tnc-n">2</span><div><strong>Payment Policy</strong><br/>Advance required to confirm. Balance paid before or at journey start. Accepted: UPI, Bank Transfer, Cash.</div></div>
        <div class="tnc-item"><span class="tnc-n">3</span><div><strong>Toll, Parking &amp; Taxes</strong><br/>Toll, parking, state taxes &amp; entry fees are extra unless marked "Included."</div></div>
        <div class="tnc-item"><span class="tnc-n">4</span><div><strong>Extra KM &amp; Hour Charges</strong><br/>Extra km/hour charged per package. Duty starts and ends at agreed time. Garage-to-Garage (Malad to Malad) applicable unless stated.</div></div>
        <div class="tnc-item"><span class="tnc-n">5</span><div><strong>Night Driver Allowance</strong><br/>DA applicable for late-night travel or multi-day trips as per company policy.</div></div>
        <div class="tnc-item"><span class="tnc-n">6</span><div><strong>Waiting Charges</strong><br/>Waiting charges apply beyond the complimentary waiting period.</div></div>
        <div class="tnc-item"><span class="tnc-n">7</span><div><strong>Cancellation Policy</strong><br/>Cancellation charges apply. Advance may be non-refundable during peak seasons or special events.</div></div>
        <div class="tnc-item"><span class="tnc-n">8</span><div><strong>Customer Responsibilities</strong><br/>Maintain cleanliness. Smoking, alcohol &amp; illegal activities strictly prohibited. Damage will be charged.</div></div>
      </div>
      <div>
        <div class="tnc-item"><span class="tnc-n">9</span><div><strong>Driver &amp; Vehicle</strong><br/>All vehicles regularly serviced &amp; sanitized. Drivers are experienced, licensed &amp; verified.</div></div>
        <div class="tnc-item"><span class="tnc-n">10</span><div><strong>Delays &amp; Force Majeure</strong><br/>TopzCab is not responsible for delays due to traffic, weather, strikes, or circumstances beyond our control.</div></div>
        <div class="tnc-item"><span class="tnc-n">11</span><div><strong>Passenger Belongings</strong><br/>Check belongings before leaving the vehicle. TopzCab is not liable for loss or damage to personal belongings.</div></div>
        <div class="tnc-item"><span class="tnc-n">12</span><div><strong>Route Changes</strong><br/>Changes in route or destination after trip start may result in additional charges.</div></div>
        <div class="tnc-item"><span class="tnc-n">13</span><div><strong>Safety</strong><br/>Seat belts must be worn. Follow all driver safety instructions and traffic rules.</div></div>
        <div class="tnc-item"><span class="tnc-n">14</span><div><strong>Liability</strong><br/>TopzCab's liability is limited to the booked transportation service only.</div></div>
        <div class="tnc-item"><span class="tnc-n">15</span><div><strong>Acceptance</strong><br/>By confirming a booking, the customer agrees to these Terms &amp; Conditions.</div></div>
      </div>
    </div>
  </div>` : ''}

</div>
<script>window.onload = () => { document.title = "${form.clientName} - Topz Cab Quotation"; window.print() }</script>
</body>
</html>`

  const win = window.open('', '_blank', 'width=900,height=700')
  if (win) { win.document.write(html); win.document.close() }
}
