import type { VercelRequest, VercelResponse } from '@vercel/node'
import { turso, initTables } from '../lib/turso'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  await initTables()

  // GET /api/topz/quotations
  if (req.method === 'GET') {
    const result = await turso.execute(
      'SELECT * FROM topz_quotations ORDER BY createdAt DESC'
    )
    const rows = result.rows.map(r => ({
      id: r.id,
      quoteNo: r.quoteNo,
      createdAt: r.createdAt,
      status: r.status,
      tripType: r.tripType,
      isRoundTrip: r.isRoundTrip === 1,
      clientName: r.clientName,
      clientPhone: r.clientPhone,
      clientEmail: r.clientEmail,
      pickupDate: r.pickupDate,
      pickupLocation: r.pickupLocation,
      dropDate: r.dropDate,
      dropLocation: r.dropLocation,
      passengers: r.passengers,
      estimatedKm: r.estimatedKm,
      vehicleName: r.vehicleName,
      vehicleCategory: r.vehicleCategory,
      days: r.days,
      totalAmount: r.totalAmount,
    }))
    return res.status(200).json(rows)
  }

  // POST /api/topz/quotations  — upsert
  if (req.method === 'POST') {
    const q = req.body
    await turso.execute({
      sql: `INSERT INTO topz_quotations
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
      args: [
        q.id, q.quoteNo, new Date().toISOString(), q.status ?? 'draft',
        q.tripType, q.isRoundTrip ? 1 : 0,
        q.clientName, q.clientPhone ?? '', q.clientEmail ?? '',
        q.pickupDate ?? '', q.pickupLocation ?? '', q.dropDate ?? '', q.dropLocation ?? '',
        q.passengers ?? '', q.estimatedKm ?? '', q.vehicleName ?? '', q.vehicleCategory ?? '',
        q.days ?? 1, q.totalAmount ?? 0,
      ],
    })
    return res.status(200).json({ ok: true })
  }

  // PUT /api/topz/quotations?id=xxx&status=yyy
  if (req.method === 'PUT') {
    const { id, status } = req.query
    await turso.execute({
      sql: 'UPDATE topz_quotations SET status=? WHERE id=?',
      args: [status as string, id as string],
    })
    return res.status(200).json({ ok: true })
  }

  // DELETE /api/topz/quotations?id=xxx
  if (req.method === 'DELETE') {
    const { id } = req.query
    await turso.execute({ sql: 'DELETE FROM topz_quotations WHERE id=?', args: [id as string] })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
