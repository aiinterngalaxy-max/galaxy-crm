import { useState, useMemo } from 'react'
import { X, Calculator, CheckCircle, AlertTriangle } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { db, collection, query, where, getDocs, updateDoc, doc, addDoc, serverTimestamp } from '../../lib/firebase'
import { useAuth } from '../../contexts/AuthContext'
import type { InventoryItem } from '../../types'
import toast from 'react-hot-toast'

interface Props {
  onClose: () => void
}

type MotorType = 'standard' | 'tabular'
type Remote    = '1ch' | '2ch' | 'tab' | 'none'
type KaanType  = 'big' | 'small'
type HookSize  = 'normal' | 'small'

// Belt suggestion based on known reference points
function suggestBelt(feet: number): number {
  if (feet <= 10) return 7
  if (feet <= 12) return 8
  if (feet <= 15) return 9.5
  if (feet <= 20) return 12
  return Math.ceil(feet * 0.62)
}

interface DispatchLine {
  itemCode: string
  label: string
  qty: number
  note?: string
}

export function CurtainDispatchModal({ onClose }: Props) {
  const { user } = useAuth()

  // ── Inputs ──────────────────────────────────────────────────────────────────
  const [motorType, setMotorType]   = useState<MotorType>('standard')
  const [feet, setFeet]             = useState<number | ''>('')
  const [remote, setRemote]         = useState<Remote>('none')
  const [kaanType, setKaanType]     = useState<KaanType>('small')
  const [hookSize, setHookSize]     = useState<HookSize>('normal')
  const [inclPulley, setInclPulley] = useState(false)
  const [beltOverride, setBeltOverride] = useState<number | ''>('')
  const [inclLTrack, setInclLTrack] = useState(false)
  const [lTrackQty, setLTrackQty]   = useState<number | ''>(1)
  const [projectRef, setProjectRef] = useState('')
  const [dispatching, setDispatching] = useState(false)
  const [confirmed, setConfirmed]   = useState(false)

  // ── Auto-calculations ───────────────────────────────────────────────────────
  const calc = useMemo(() => {
    const f = Number(feet) || 0
    if (!f) return null

    const motors   = f <= 19 ? 1 : 2
    const runners  = f * 3
    const carriers = motors                          // 1 carrier per motor
    const brackets = motors * 4
    const kaanQty  = motors * 2                      // 2 kaan per motor
    const beltM    = Number(beltOverride) || suggestBelt(f)
    const hookQty  = motorType === 'tabular' ? motors * 2 : 0

    const lines: DispatchLine[] = []

    if (motorType === 'standard') {
      lines.push({ itemCode: 'MOTOR',         label: 'Motor',         qty: motors })
      lines.push({ itemCode: 'RUNNERS(Pack)', label: 'Runners',       qty: runners,  note: `3 per ft × ${f} ft` })
      lines.push({ itemCode: 'CARRIERS',      label: 'Carriers',      qty: carriers, note: `1 per motor` })
      lines.push({ itemCode: 'BRACKET',       label: 'Bracket',       qty: brackets, note: `4 per motor` })
      lines.push({ itemCode: kaanType === 'big' ? 'BIG KAAN' : 'SMALL KAAN',
                   label: kaanType === 'big' ? 'Big Kaan' : 'Small Kaan',
                   qty: kaanQty, note: `2 per motor` })
      if (inclPulley) lines.push({ itemCode: 'DRIVER PULLEY', label: 'Driver Pulley', qty: 1 })
      lines.push({ itemCode: 'BELT', label: 'Belt', qty: beltM, note: `${beltM}m` })
    } else {
      lines.push({ itemCode: 'TABULAR',       label: 'Tabular Motor', qty: motors })
      lines.push({ itemCode: hookSize === 'normal' ? 'TABULAR HOOK [PAIR]' : 'TABULAR HOOK SMALL',
                   label: hookSize === 'normal' ? 'Tabular Hook (Pair)' : 'Tabular Hook Small',
                   qty: hookQty, note: `2 per motor` })
    }

    if (remote !== 'none') {
      const remoteCode = remote === '1ch' ? '1 CH REMOTE' : remote === '2ch' ? '2 CH REMOTE' : 'TAB REMOTE'
      const remoteLabel = remote === '1ch' ? '1 Channel Remote' : remote === '2ch' ? '2 Channel Remote' : 'Tab Remote'
      lines.push({ itemCode: remoteCode, label: remoteLabel, qty: 1 })
    }

    if (inclLTrack && Number(lTrackQty) > 0) {
      lines.push({ itemCode: 'L TRACK', label: 'L Track', qty: Number(lTrackQty) })
    }

    return { motors, runners, carriers, brackets, kaanQty, beltM, hookQty, lines }
  }, [feet, motorType, remote, kaanType, hookSize, inclPulley, beltOverride, inclLTrack, lTrackQty])

  // ── Dispatch ────────────────────────────────────────────────────────────────
  const handleDispatch = async () => {
    if (!calc || !confirmed) return
    setDispatching(true)
    try {
      const snap = await getDocs(query(collection(db, 'inventory'), where('productLine', '==', 'curtains')))
      const itemMap = new Map<string, InventoryItem & { id: string }>()
      snap.docs.forEach(d => itemMap.set(d.data().itemCode, { id: d.id, ...d.data() } as InventoryItem & { id: string }))

      for (const line of calc.lines) {
        const item = itemMap.get(line.itemCode)
        if (!item) { toast.error(`Item not found in inventory: ${line.itemCode}`); continue }

        const newIssued  = (item.issuedQty ?? 0) + line.qty
        const newClosing = (item.openingStock ?? 0) + (item.importedQty ?? 0) - newIssued
        const newStatus  = newClosing <= 0 ? 'out_of_stock' : newClosing <= (item.reorderLevel ?? 0) ? 'low_stock' : 'in_stock'

        await updateDoc(doc(db, 'inventory', item.id), {
          issuedQty:    newIssued,
          closingStock: newClosing,
          stockStatus:  newStatus,
          updatedAt:    serverTimestamp(),
        })

        await addDoc(collection(db, 'inventory', item.id, 'transactions'), {
          itemId:          item.id,
          itemCode:        item.itemCode,
          itemName:        item.itemName,
          type:            'issue',
          quantity:        line.qty,
          note:            line.note ?? '',
          projectRef:      projectRef || null,
          recordedBy:      user?.id ?? '',
          recordedByName:  user?.name ?? '',
          createdAt:       serverTimestamp(),
        })
      }

      toast.success(`Dispatched ${calc.lines.length} items for ${Number(feet)} ft curtain order`)
      onClose()
    } catch (err) {
      toast.error('Dispatch failed')
      console.error(err)
    } finally {
      setDispatching(false)
    }
  }

  // ── UI ───────────────────────────────────────────────────────────────────────
  const feetVal = Number(feet) || 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gold-500/20 flex items-center justify-center">
              <Calculator className="w-4 h-4 text-gold-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Curtain Dispatch Calculator</h2>
              <p className="text-xs text-gray-500">Auto-calculates materials based on track length</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* Project ref */}
          <div>
            <label className="form-label">Project Reference (optional)</label>
            <input
              className="input-field mt-1"
              placeholder="e.g. GHA-P-2026-012 or client name"
              value={projectRef}
              onChange={e => setProjectRef(e.target.value)}
            />
          </div>

          {/* Motor type */}
          <div>
            <label className="form-label mb-2 block">Motor Type *</label>
            <div className="flex gap-3">
              {([['standard', '5 Wire / WiFi Motor (GS/CM/001 & 002)'], ['tabular', 'Tabular Motor (GS/CM/003)']] as const).map(([v, label]) => (
                <label key={v} className={`flex-1 flex items-center gap-2 py-2.5 px-4 rounded-xl border cursor-pointer text-sm font-medium transition-all ${
                  motorType === v ? 'border-gold-500 bg-gold-500/10 text-gold-400' : 'border-gray-700 text-gray-400 hover:border-gray-600'
                }`}>
                  <input type="radio" className="sr-only" checked={motorType === v} onChange={() => setMotorType(v)} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* Track length */}
          <div>
            <label className="form-label">Track Length (feet) *</label>
            <div className="flex items-center gap-3 mt-1">
              <input
                type="number"
                min={1}
                className="input-field w-32"
                placeholder="e.g. 12"
                value={feet}
                onChange={e => { setFeet(e.target.value === '' ? '' : Number(e.target.value)); setBeltOverride('') }}
              />
              {feetVal > 0 && (
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-400">→</span>
                  <span className={`font-semibold ${feetVal >= 20 ? 'text-amber-400' : 'text-green-400'}`}>
                    {feetVal <= 19 ? '1 Motor' : '2 Motors'}
                  </span>
                  {feetVal >= 20 && <span className="text-xs text-amber-400/70">(≥20 ft = 2 motors)</span>}
                </div>
              )}
            </div>
          </div>

          {feetVal > 0 && (
            <>
              {/* Standard motor options */}
              {motorType === 'standard' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Kaan type */}
                    <div>
                      <label className="form-label mb-2 block">Kaan Type (2 per motor = {(feetVal <= 19 ? 1 : 2) * 2} total)</label>
                      <div className="flex gap-2">
                        {([['small', 'Small Kaan'], ['big', 'Big Kaan']] as const).map(([v, label]) => (
                          <label key={v} className={`flex-1 flex items-center justify-center py-2 px-3 rounded-lg border cursor-pointer text-sm transition-all ${
                            kaanType === v ? 'border-gold-500 bg-gold-500/10 text-gold-400' : 'border-gray-700 text-gray-400 hover:border-gray-600'
                          }`}>
                            <input type="radio" className="sr-only" checked={kaanType === v} onChange={() => setKaanType(v)} />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Driver pulley */}
                    <div>
                      <label className="form-label mb-2 block">Driver Pulley</label>
                      <div className="flex gap-2">
                        {([true, false] as const).map(v => (
                          <label key={String(v)} className={`flex-1 flex items-center justify-center py-2 px-3 rounded-lg border cursor-pointer text-sm transition-all ${
                            inclPulley === v ? 'border-gold-500 bg-gold-500/10 text-gold-400' : 'border-gray-700 text-gray-400 hover:border-gray-600'
                          }`}>
                            <input type="radio" className="sr-only" checked={inclPulley === v} onChange={() => setInclPulley(v)} />
                            {v ? 'Include (1 pc)' : 'Not Required'}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Belt */}
                  <div>
                    <label className="form-label">Belt Length (metres)</label>
                    <div className="flex items-center gap-3 mt-1">
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        className="input-field w-32"
                        placeholder={String(suggestBelt(feetVal))}
                        value={beltOverride}
                        onChange={e => setBeltOverride(e.target.value === '' ? '' : Number(e.target.value))}
                      />
                      <span className="text-xs text-gray-500">
                        Suggested: {suggestBelt(feetVal)}m for {feetVal}ft
                        {beltOverride !== '' && Number(beltOverride) !== suggestBelt(feetVal) && (
                          <span className="text-amber-400 ml-2">(overridden)</span>
                        )}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">Reference: 10ft=7m · 12ft=8m · 15ft=9.5m</p>
                  </div>
                </>
              )}

              {/* Tabular motor options */}
              {motorType === 'tabular' && (
                <div>
                  <label className="form-label mb-2 block">Hook Size (2 per motor = {(feetVal <= 19 ? 1 : 2) * 2} total)</label>
                  <div className="flex gap-3 max-w-xs">
                    {([['normal', 'Normal (Pair)'], ['small', 'Small']] as const).map(([v, label]) => (
                      <label key={v} className={`flex-1 flex items-center justify-center py-2 px-3 rounded-lg border cursor-pointer text-sm transition-all ${
                        hookSize === v ? 'border-gold-500 bg-gold-500/10 text-gold-400' : 'border-gray-700 text-gray-400 hover:border-gray-600'
                      }`}>
                        <input type="radio" className="sr-only" checked={hookSize === v} onChange={() => setHookSize(v)} />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Remote */}
              <div>
                <label className="form-label mb-2 block">Remote</label>
                <div className="flex gap-2 flex-wrap">
                  {([['1ch', '1 Channel'], ['2ch', '2 Channel'], ['tab', 'Tab Remote'], ['none', 'No Remote']] as const).map(([v, label]) => (
                    <label key={v} className={`flex items-center gap-2 py-2 px-4 rounded-lg border cursor-pointer text-sm transition-all ${
                      remote === v ? 'border-gold-500 bg-gold-500/10 text-gold-400' : 'border-gray-700 text-gray-400 hover:border-gray-600'
                    }`}>
                      <input type="radio" className="sr-only" checked={remote === v} onChange={() => setRemote(v)} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              {/* L Track */}
              <div>
                <label className="form-label mb-2 block">L Track</label>
                <div className="flex items-center gap-4">
                  {([true, false] as const).map(v => (
                    <label key={String(v)} className={`flex items-center gap-2 py-2 px-4 rounded-lg border cursor-pointer text-sm transition-all ${
                      inclLTrack === v ? 'border-gold-500 bg-gold-500/10 text-gold-400' : 'border-gray-700 text-gray-400 hover:border-gray-600'
                    }`}>
                      <input type="radio" className="sr-only" checked={inclLTrack === v} onChange={() => setInclLTrack(v)} />
                      {v ? 'Include' : 'Not Required'}
                    </label>
                  ))}
                  {inclLTrack && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-400">Qty:</span>
                      <input
                        type="number"
                        min={1}
                        className="input-field w-20"
                        value={lTrackQty}
                        onChange={e => setLTrackQty(e.target.value === '' ? '' : Number(e.target.value))}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Dispatch Summary */}
              {calc && (
                <div className="rounded-xl border border-gray-700 overflow-hidden">
                  <div className="px-4 py-2.5 bg-gray-800/60 border-b border-gray-700">
                    <h3 className="text-sm font-semibold text-white">Dispatch Summary</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {motorType === 'standard' ? 'Standard' : 'Tabular'} motor · {feetVal} ft track
                    </p>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 border-b border-gray-800">
                        <th className="px-4 py-2 text-left">Item</th>
                        <th className="px-4 py-2 text-center">Qty to Dispatch</th>
                        <th className="px-4 py-2 text-left text-gray-600">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {calc.lines.map(line => (
                        <tr key={line.itemCode} className="hover:bg-gray-800/30">
                          <td className="px-4 py-2.5 font-medium text-white">{line.label}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gold-500/15 text-gold-400 font-bold text-sm">
                              {line.qty}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-500 text-xs">{line.note ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Confirm checkbox */}
              {calc && (
                <label className="flex items-start gap-3 cursor-pointer">
                  <div className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                    confirmed ? 'border-gold-500 bg-gold-500' : 'border-gray-600'
                  }`}
                    onClick={() => setConfirmed(c => !c)}>
                    {confirmed && <CheckCircle className="w-3.5 h-3.5 text-black" />}
                  </div>
                  <span className="text-sm text-gray-300">
                    I confirm the above quantities are correct and will be deducted from curtain inventory stock.
                  </span>
                </label>
              )}
            </>
          )}

          {!feetVal && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
              <AlertTriangle className="w-4 h-4" />
              Enter the track length in feet to see the dispatch summary.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800 flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!calc || !confirmed}
            loading={dispatching}
            onClick={handleDispatch}
          >
            Dispatch Materials
          </Button>
        </div>
      </div>
    </div>
  )
}
