import type { Vehicle, QuotationResult, LocalQuotationResult } from './data/rateCard'

interface PrintArgs {
  form: {
    clientName: string
    clientPhone: string
    clientEmail: string
    pickupDate: string
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
}

const fmt = (n: number) => `&#x20B9;${n.toLocaleString('en-IN')}`
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

export function printQuotation({ form, vehicle, result, localResult, days, quoteNo }: PrintArgs) {
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  const isLocal = form.tripType === 'local'
  const totalAmount = result?.total ?? localResult?.total ?? 0

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
  ` : `
    <div class="trip-cell">
      <div class="label">Pickup Date</div>
      <div class="value">${fmtDate(form.pickupDate)}</div>
    </div>
    <div class="trip-cell">
      <div class="label">Drop Date</div>
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
      <div class="value">${days} Day${days > 1 ? 's' : ''} ${form.isRoundTrip ? '&bull; Round Trip' : '&bull; One Way'} &bull; ${result?.totalKm ?? 0} km</div>
    </div>
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
    ${vehicle.driverAllowancePerDay > 0 ? `<tr><td>Driver Allowance</td><td>${fmt(vehicle.driverAllowancePerDay)}/day &times; ${result.days} day${result.days > 1 ? 's' : ''}</td><td>Included</td></tr>` : ''}
  ` : localResult ? `
    <tr>
      <td>Local Package</td>
      <td>8 Hours / 80 km</td>
      <td>${fmt(localResult.baseCost)}</td>
    </tr>
    ${localResult.extraKm > 0 ? `<tr><td>Extra KM Charges</td><td>${localResult.extraKm} km &times; &#x20B9;${vehicle.ratePerKm}/km</td><td>${fmt(localResult.extraKmCost)}</td></tr>` : ''}
  ` : ''

  const termsText = isLocal
    ? `<p>Local package includes 8 hours and 80 km. Extra km charged at &#x20B9;${vehicle.ratePerKm}/km.</p>
       <p>Waiting charges apply beyond 8 hours at actuals.</p>`
    : `<p>Minimum ${vehicle.minKmPerDay} km per day applies. Extra km charged at &#x20B9;${vehicle.ratePerKm}/km.</p>
       <p>${form.isRoundTrip ? 'Round trip fare — includes both legs of the journey.' : 'One-way fare only.'}</p>`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Quotation ${quoteNo} &mdash; Topz Cab</title>
<style>
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
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .page { padding: 20px; } }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <div>
      <div class="brand-name">TOPZ CAB</div>
      <div class="brand-tagline">Outstation &middot; Corporate &middot; Luxury Travel</div>
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

  <p class="section-title">Terms &amp; Conditions</p>
  <div class="terms">
    ${termsText}
    <p>Toll, parking charges, state entry taxes &amp; road taxes are extra and charged at actuals.</p>
    <p>GST will be charged as per applicable government norms.</p>
    <p>This quotation is valid for 7 days from the date of issue.</p>
    <p>50% advance required to confirm booking. Balance to be paid before departure.</p>
    <p>Cancellation charges apply as per company policy.</p>
  </div>

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
