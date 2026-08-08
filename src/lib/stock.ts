/**
 * The stock ledger in one place.
 *
 * Closing stock is derived, never typed: it is what opening plus everything
 * received minus everything that left adds up to. That sum is recomputed in
 * several places (Stock In / Stock Out, project material issue, curtain
 * dispatch, CSV import, the Elysia spreadsheet) and every one of them has to
 * use the same terms — a site that forgets one of them quietly resurrects
 * stock that already left the warehouse.
 *
 * `outwardQty` is stock dispatched to a client, as opposed to `issuedQty`
 * which is stock consumed internally (site installs, project material). Both
 * reduce closing; they are separate so the sheet can show where stock went.
 * It is optional because rows created before the column existed have no value
 * for it — treat a missing one as 0 everywhere.
 */

export interface StockLedger {
  openingStock: number
  importedQty: number
  issuedQty: number
  outwardQty?: number
}

export function closingOf(l: StockLedger): number {
  return l.openingStock + l.importedQty - l.issuedQty - (l.outwardQty ?? 0)
}

/**
 * What a stock movement was, in the words the warehouse uses.
 *
 * The stored `type` only says which way the ledger moved: `issue` out, `import`
 * in. That cannot tell a supplier's delivery from a customer's return, so
 * entries made through the register also carry `txnKind`, which can.
 *
 * This mapping lives here because it is read in two places — the register and
 * the transaction log — and a second copy would drift. It already did once:
 * the log called every `import` a return, so deliveries read as customers
 * sending goods back.
 */
export type TxnKind = 'sent' | 'returned' | 'received'

export const TXN_LABEL: Record<TxnKind, string> = {
  sent: 'Sent', returned: 'Returned', received: 'Received',
}

/**
 * Rows written before `txnKind` existed — Stock In/Out buttons, an Imported
 * cell edited on the sheet, a CSV merge — have only the ledger type. Those all
 * mean stock arrived or left, so they read as Received or Sent. Returns are
 * under-reported for that period, which is honest: nothing recorded them.
 */
export function txnKindOf(t: { txnKind?: string | null; type?: string | null }): TxnKind {
  if (t.txnKind === 'sent' || t.txnKind === 'returned' || t.txnKind === 'received') return t.txnKind
  return t.type === 'issue' ? 'sent' : 'received'
}

/** Sent takes stock away; returned and received both bring it back in. */
export function isOutwardKind(k: TxnKind): boolean {
  return k === 'sent'
}
