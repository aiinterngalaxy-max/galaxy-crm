import { TOPZ_TEAM, TOPZ_BUSINESS_NAME, type SavedQuotation } from './data/storage'

function ordinalDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const day = d.getDate()
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th'
  const month = d.toLocaleString('en-IN', { month: 'long' })
  return `${day}${suffix} ${month} ${d.getFullYear()}`
}

const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`

/** Builds the client-facing WhatsApp message for a Quick Quote, generated dynamically from its fields. */
export function buildQuickQuoteMessage(q: SavedQuotation): string {
  const businessName = q.sentBy && TOPZ_BUSINESS_NAME[q.sentBy as typeof TOPZ_TEAM[number]]
    ? TOPZ_BUSINESS_NAME[q.sentBy as typeof TOPZ_TEAM[number]]
    : 'Topz Cab'
  const route = `${q.pickupLocation}${q.dropLocation ? ` → ${q.dropLocation}` : ''}${q.isRoundTrip ? ' Return' : ''}`

  const details = [
    q.pickupDate ? `📅 Date: ${ordinalDate(q.pickupDate)}` : '',
    route.trim() ? `📍 Route: ${route}` : '',
    q.vehicleName ? `🚌 Vehicle: ${q.vehicleName}${(q.units ?? 1) > 1 ? ` × ${q.units}` : ''}` : '',
    q.timing ? `⏰ Time: ${q.timing}` : '',
    q.passengers ? `👥 Passengers: ${q.passengers}` : '',
  ].filter(Boolean)

  const sections = [
    [`🚗 *TOPZ CAB — QUICK QUOTATION*`],
    details,
    [`*Total Amount: ${fmt(q.totalAmount)}/-*`],
    ...(q.extraChargesText?.trim() ? [[q.extraChargesText.trim()]] : []),
    [`🙏 Thanks & Regards`, `*${businessName}*`, `www.topzcab.in`],
  ]

  return sections.map(s => s.join('\n')).join('\n\n')
}

/** Normalizes an Indian mobile number to WhatsApp's international format (91XXXXXXXXXX). */
export function whatsappPhone(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^0/, '91').replace(/^(?!91)/, '91')
}

/** Opens WhatsApp with the given number and a pre-filled message — the user still presses Send. */
export function openWhatsApp(phone: string, message: string) {
  window.open(`https://wa.me/${whatsappPhone(phone)}?text=${encodeURIComponent(message)}`, '_blank')
}
