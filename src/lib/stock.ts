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
