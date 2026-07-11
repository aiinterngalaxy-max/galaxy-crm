import type { VercelRequest, VercelResponse } from '@vercel/node'
import { turso, initTables } from '../lib/turso'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  await initTables()

  // GET /api/topz/bookings
  if (req.method === 'GET') {
    const result = await turso.execute(
      'SELECT * FROM topz_bookings ORDER BY createdAt DESC'
    )
    const rows = result.rows.map(r => ({
      id: r.id,
      createdAt: r.createdAt,
      quoteNo: r.quoteNo,
      clientName: r.clientName,
      clientPhone: r.clientPhone,
      vehicleName: r.vehicleName,
      pickupDate: r.pickupDate,
      dropDate: r.dropDate,
      pickupLocation: r.pickupLocation,
      dropLocation: r.dropLocation,
      totalAmount: r.totalAmount,
      advancePaid: r.advancePaid,
      status: r.status,
      notes: r.notes,
      tripType: r.tripType,
      supplier: r.supplier ?? undefined,
    }))
    return res.status(200).json(rows)
  }

  // POST /api/topz/bookings — upsert
  if (req.method === 'POST') {
    const b = req.body
    await turso.execute({
      sql: `INSERT INTO topz_bookings
        (id,createdAt,quoteNo,clientName,clientPhone,vehicleName,pickupDate,dropDate,
         pickupLocation,dropLocation,totalAmount,advancePaid,status,notes,tripType,supplier)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          quoteNo=excluded.quoteNo, clientName=excluded.clientName,
          clientPhone=excluded.clientPhone, vehicleName=excluded.vehicleName,
          pickupDate=excluded.pickupDate, dropDate=excluded.dropDate,
          pickupLocation=excluded.pickupLocation, dropLocation=excluded.dropLocation,
          totalAmount=excluded.totalAmount, advancePaid=excluded.advancePaid,
          status=excluded.status, notes=excluded.notes,
          tripType=excluded.tripType, supplier=excluded.supplier`,
      args: [
        b.id, new Date().toISOString(), b.quoteNo ?? '',
        b.clientName, b.clientPhone ?? '', b.vehicleName ?? '',
        b.pickupDate ?? '', b.dropDate ?? '', b.pickupLocation ?? '', b.dropLocation ?? '',
        b.totalAmount ?? 0, b.advancePaid ?? 0, b.status ?? 'confirmed',
        b.notes ?? '', b.tripType ?? 'outstation', b.supplier ?? null,
      ],
    })
    return res.status(200).json({ ok: true })
  }

  // DELETE /api/topz/bookings?id=xxx
  if (req.method === 'DELETE') {
    const { id } = req.query
    await turso.execute({ sql: 'DELETE FROM topz_bookings WHERE id=?', args: [id as string] })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
