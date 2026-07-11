import { createClient } from '@libsql/client/http'

export const turso = createClient({
  url: process.env.TURSO_URL!,
  authToken: process.env.TURSO_TOKEN!,
})

export async function initTables() {
  await turso.executeMultiple(`
    CREATE TABLE IF NOT EXISTS topz_quotations (
      id TEXT PRIMARY KEY,
      quoteNo TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      tripType TEXT NOT NULL,
      isRoundTrip INTEGER NOT NULL DEFAULT 0,
      clientName TEXT NOT NULL,
      clientPhone TEXT NOT NULL DEFAULT '',
      clientEmail TEXT NOT NULL DEFAULT '',
      pickupDate TEXT NOT NULL DEFAULT '',
      pickupLocation TEXT NOT NULL DEFAULT '',
      dropDate TEXT NOT NULL DEFAULT '',
      dropLocation TEXT NOT NULL DEFAULT '',
      passengers TEXT NOT NULL DEFAULT '',
      estimatedKm TEXT NOT NULL DEFAULT '',
      vehicleName TEXT NOT NULL DEFAULT '',
      vehicleCategory TEXT NOT NULL DEFAULT '',
      days INTEGER NOT NULL DEFAULT 1,
      totalAmount REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS topz_bookings (
      id TEXT PRIMARY KEY,
      createdAt TEXT NOT NULL,
      quoteNo TEXT NOT NULL DEFAULT '',
      clientName TEXT NOT NULL,
      clientPhone TEXT NOT NULL DEFAULT '',
      vehicleName TEXT NOT NULL DEFAULT '',
      pickupDate TEXT NOT NULL DEFAULT '',
      dropDate TEXT NOT NULL DEFAULT '',
      pickupLocation TEXT NOT NULL DEFAULT '',
      dropLocation TEXT NOT NULL DEFAULT '',
      totalAmount REAL NOT NULL DEFAULT 0,
      advancePaid REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'confirmed',
      notes TEXT NOT NULL DEFAULT '',
      tripType TEXT NOT NULL DEFAULT 'outstation',
      supplier TEXT
    );
  `)
}
