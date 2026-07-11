import type { VercelRequest, VercelResponse } from '@vercel/node'
import { tursoQuery, tursoExec, initTables } from '../lib/turso'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  await initTables()

  if (req.method === 'GET') {
    const rows = await tursoQuery('SELECT * FROM topz_quotations ORDER BY createdAt DESC')
    return res.status(200).json(rows.map(r => ({
      ...r,
      isRoundTrip: r.isRoundTrip === 1 || r.isRoundTrip === '1',
      days: Number(r.days),
      totalAmount: Number(r.totalAmount),
    })))
  }

  if (req.method === 'POST') {
    const q = req.body
    await tursoExec(
      `INSERT INTO topz_quotations
        (id,quoteNo,createdAt,status,tripType,isRoundTrip,clientName,clientPhone,clientEmail,
         pickupDate,pickupLocation,dropDate,dropLocation,passengers,estimatedKm,
         vehicleName,vehicleCategory,days,totalAmount)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          quoteNo=excluded.quoteNo, status=excluded.status, tripType=excluded.tripType,
          isRoundTrip=excluded.isRoundTrip, clientName=excluded.clientName,
          clientPhone=excluded.clientPhone, clientEmail=excluded.clientEmail,
          pickupDate=excluded.pickupDate, pickupLocation=excluded.pickupLocation,
          dropDate=excluded.dropDate, dropLocation=excluded.dropLocation,
          passengers=excluded.passengers, estimatedKm=excluded.estimatedKm,
          vehicleName=excluded.vehicleName, vehicleCategory=excluded.vehicleCategory,
          days=excluded.days, totalAmount=excluded.totalAmount`,
      [
        q.id, q.quoteNo, new Date().toISOString(), q.status ?? 'draft',
        q.tripType, q.isRoundTrip ? 1 : 0,
        q.clientName, q.clientPhone ?? '', q.clientEmail ?? '',
        q.pickupDate ?? '', q.pickupLocation ?? '', q.dropDate ?? '', q.dropLocation ?? '',
        q.passengers ?? '', q.estimatedKm ?? '', q.vehicleName ?? '', q.vehicleCategory ?? '',
        q.days ?? 1, q.totalAmount ?? 0,
      ]
    )
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'PUT') {
    const { id, status } = req.query
    await tursoExec('UPDATE topz_quotations SET status=? WHERE id=?', [status as string, id as string])
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'DELETE') {
    const { id } = req.query
    await tursoExec('DELETE FROM topz_quotations WHERE id=?', [id as string])
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
