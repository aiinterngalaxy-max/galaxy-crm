import type { VercelRequest, VercelResponse } from '@vercel/node'
import { tursoQuery, tursoExec, initTables } from '../lib/turso'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  await initTables()

  if (req.method === 'GET') {
    const rows = await tursoQuery('SELECT * FROM topz_bookings ORDER BY createdAt DESC')
    return res.status(200).json(rows.map(r => ({
      ...r,
      totalAmount: Number(r.totalAmount),
      advancePaid: Number(r.advancePaid),
      supplier: r.supplier ?? undefined,
    })))
  }

  if (req.method === 'POST') {
    const b = req.body
    await tursoExec(
      `INSERT INTO topz_bookings
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
      [
        b.id, new Date().toISOString(), b.quoteNo ?? '',
        b.clientName, b.clientPhone ?? '', b.vehicleName ?? '',
        b.pickupDate ?? '', b.dropDate ?? '', b.pickupLocation ?? '', b.dropLocation ?? '',
        b.totalAmount ?? 0, b.advancePaid ?? 0, b.status ?? 'confirmed',
        b.notes ?? '', b.tripType ?? 'outstation', b.supplier ?? null,
      ]
    )
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'DELETE') {
    const { id } = req.query
    await tursoExec('DELETE FROM topz_bookings WHERE id=?', [id as string])
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
