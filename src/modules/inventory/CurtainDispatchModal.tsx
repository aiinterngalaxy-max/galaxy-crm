import { useState } from 'react'
import { X, ChevronRight, ChevronLeft, Package, CheckCircle } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { db, collection, query, where, getDocs, updateDoc, doc, addDoc, serverTimestamp } from '../../lib/firebase'
import { useAuth } from '../../contexts/AuthContext'
import type { InventoryItem } from '../../types'
import toast from 'react-hot-toast'

interface Props { onClose: () => void }

type MotorType = 'standard' | 'tabular'
type Remote    = '1ch' | '2ch' | 'tab' | 'none'
type KaanType  = 'big' | 'small'
type HookSize  = 'normal' | 'small'

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

// ─── Step components ──────────────────────────────────────────────────────────

function OptionBtn({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-5 py-4 rounded-xl border-2 transition-all text-sm font-medium flex items-center justify-between ${
        selected
          ? 'border-gold-500 bg-gold-500/10 text-gold-300'
          : 'border-gray-700 text-gray-300 hover:border-gray-500 hover:bg-gray-800/50'
      }`}
    >
      {children}
      {selected && <CheckCircle className="w-4 h-4 text-gold-400 shrink-0" />}
    </button>
  )
}

export function CurtainDispatchModal({ onClose }: Props) {
  const { user } = useAuth()

  // ── Answers ──────────────────────────────────────────────────────────────────
  const [step, setStep]             = useState(0)
  const [motorType, setMotorType]   = useState<MotorType | null>(null)
  const [feet, setFeet]             = useState<number | ''>('')
  const [remote, setRemote]         = useState<Remote | null>(null)
  const [kaanType, setKaanType]     = useState<KaanType | null>(null)
  const [hookSize, setHookSize]     = useState<HookSize | null>(null)
  const [inclPulley, setInclPulley] = useState<boolean | null>(null)
  const [beltMeters, setBeltMeters] = useState<number | ''>('')
  const [inclLTrack, setInclLTrack] = useState<boolean | null>(null)
  const [lTrackQty, setLTrackQty]   = useState<number | ''>(1)
  const [projectRef, setProjectRef] = useState('')
  const [dispatching, setDispatching] = useState(false)

  const f        = Number(feet) || 0
  const motors   = f <= 19 ? 1 : 2
  const runners  = f * 3
  const brackets = motors * 4
  const kaanQty  = motors * 2
  const hookQty  = motors * 2
  const beltM    = Number(beltMeters) || suggestBelt(f)

  // ── Steps definition ─────────────────────────────────────────────────────────
  // Each step: { question, content, canProceed }
  const steps = [
    // 0 — Motor type
    {
      question: 'What type of motor?',
      hint: 'Choose the motor from the quotation',
      content: (
        <div className="space-y-3">
          <OptionBtn selected={motorType === 'standard'} onClick={() => setMotorType('standard')}>
            <div>
              <p>5 Wire / WiFi Motor</p>
              <p className="text-xs text-gray-500 font-normal mt-0.5">GS/CM/001 · GS/CM/002</p>
            </div>
          </OptionBtn>
          <OptionBtn selected={motorType === 'tabular'} onClick={() => setMotorType('tabular')}>
            <div>
              <p>Tabular Motor</p>
              <p className="text-xs text-gray-500 font-normal mt-0.5">GS/CM/003</p>
            </div>
          </OptionBtn>
        </div>
      ),
      canProceed: motorType !== null,
    },
    // 1 — Track length
    {
      question: 'How many feet is the curtain track?',
      hint: 'Motor count is calculated automatically',
      content: (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              autoFocus
              className="input-field w-36 text-lg text-center"
              placeholder="e.g. 12"
              value={feet}
              onChange={e => setFeet(e.target.value === '' ? '' : Number(e.target.value))}
            />
            <span className="text-gray-400 text-sm">feet</span>
          </div>
          {f > 0 && (
            <div className={`flex items-center gap-3 p-4 rounded-xl border ${f >= 20 ? 'border-amber-600/40 bg-amber-900/20' : 'border-green-700/40 bg-green-900/20'}`}>
              <Package className={`w-5 h-5 ${f >= 20 ? 'text-amber-400' : 'text-green-400'}`} />
              <div>
                <p className={`font-semibold text-sm ${f >= 20 ? 'text-amber-300' : 'text-green-300'}`}>
                  {motors} Motor{motors > 1 ? 's' : ''} needed
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {f} ft · {runners} runners · {brackets} brackets · {kaanQty} kaan
                </p>
              </div>
            </div>
          )}
        </div>
      ),
      canProceed: f > 0,
    },
    // 2 — Kaan type (standard only) OR hook size (tabular)
    ...(motorType === 'standard' ? [{
      question: 'Big Kaan or Small Kaan?',
      hint: `${kaanQty} kaan needed (2 per motor)`,
      content: (
        <div className="space-y-3">
          <OptionBtn selected={kaanType === 'small'} onClick={() => setKaanType('small')}>
            <div>
              <p>Small Kaan (Swing Kan)</p>
              <p className="text-xs text-gray-500 font-normal mt-0.5">Standard — most common</p>
            </div>
          </OptionBtn>
          <OptionBtn selected={kaanType === 'big'} onClick={() => setKaanType('big')}>
            <div>
              <p>Big Kaan (Tabular Kan)</p>
              <p className="text-xs text-gray-500 font-normal mt-0.5">For heavier curtains</p>
            </div>
          </OptionBtn>
        </div>
      ),
      canProceed: kaanType !== null,
    }] : [{
      question: 'Normal hook or small hook?',
      hint: `${hookQty} hooks needed (2 per motor)`,
      content: (
        <div className="space-y-3">
          <OptionBtn selected={hookSize === 'normal'} onClick={() => setHookSize('normal')}>
            <div>
              <p>Normal Size (Pair)</p>
              <p className="text-xs text-gray-500 font-normal mt-0.5">Tabular Hook [Pair]</p>
            </div>
          </OptionBtn>
          <OptionBtn selected={hookSize === 'small'} onClick={() => setHookSize('small')}>
            <div>
              <p>Small Hook</p>
              <p className="text-xs text-gray-500 font-normal mt-0.5">Tabular Hook Small</p>
            </div>
          </OptionBtn>
        </div>
      ),
      canProceed: hookSize !== null,
    }]),
    // 3 — Driver pulley (standard only) OR skip
    ...(motorType === 'standard' ? [{
      question: 'Include Driver Pulley?',
      hint: '1 driver pulley per order',
      content: (
        <div className="space-y-3">
          <OptionBtn selected={inclPulley === true} onClick={() => setInclPulley(true)}>
            <p>Yes — Include 1 Driver Pulley</p>
          </OptionBtn>
          <OptionBtn selected={inclPulley === false} onClick={() => setInclPulley(false)}>
            <p>No — Not Required</p>
          </OptionBtn>
        </div>
      ),
      canProceed: inclPulley !== null,
    }] : []),
    // 4 — Belt (standard only)
    ...(motorType === 'standard' ? [{
      question: 'How many metres of belt?',
      hint: `Suggested: ${suggestBelt(f)}m for ${f}ft track`,
      content: (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="number"
              step="0.5"
              min="0"
              autoFocus
              className="input-field w-36 text-lg text-center"
              placeholder={String(suggestBelt(f))}
              value={beltMeters}
              onChange={e => setBeltMeters(e.target.value === '' ? '' : Number(e.target.value))}
            />
            <span className="text-gray-400 text-sm">metres</span>
          </div>
          <div className="text-xs text-gray-500 space-y-1 bg-gray-800/40 rounded-lg px-3 py-2">
            <p className="text-gray-400 font-medium mb-1">Reference guide:</p>
            <p>10 ft → 7m &nbsp;·&nbsp; 12 ft → 8m &nbsp;·&nbsp; 15 ft → 9.5m</p>
            <p className="text-amber-400/70">Leave blank to use suggested: {suggestBelt(f)}m</p>
          </div>
        </div>
      ),
      canProceed: true,
    }] : []),
    // 5 — Remote
    {
      question: 'Which remote does the client want?',
      hint: 'Select one option',
      content: (
        <div className="space-y-3">
          <OptionBtn selected={remote === '1ch'} onClick={() => setRemote('1ch')}>
            <div><p>1 Channel Remote</p><p className="text-xs text-gray-500 font-normal mt-0.5">GS/CM/004</p></div>
          </OptionBtn>
          <OptionBtn selected={remote === '2ch'} onClick={() => setRemote('2ch')}>
            <div><p>2 Channel Remote</p><p className="text-xs text-gray-500 font-normal mt-0.5">GS/CM/005</p></div>
          </OptionBtn>
          <OptionBtn selected={remote === 'tab'} onClick={() => setRemote('tab')}>
            <div><p>Tab Remote</p><p className="text-xs text-gray-500 font-normal mt-0.5">For tabular motor</p></div>
          </OptionBtn>
          <OptionBtn selected={remote === 'none'} onClick={() => setRemote('none')}>
            <p>No Remote</p>
          </OptionBtn>
        </div>
      ),
      canProceed: remote !== null,
    },
    // 6 — L Track
    {
      question: 'Include L Track?',
      hint: 'For corner/angled installations',
      content: (
        <div className="space-y-3">
          <OptionBtn selected={inclLTrack === false} onClick={() => setInclLTrack(false)}>
            <p>No — Not Required</p>
          </OptionBtn>
          <OptionBtn selected={inclLTrack === true} onClick={() => setInclLTrack(true)}>
            <p>Yes — Include L Track</p>
          </OptionBtn>
          {inclLTrack === true && (
            <div className="flex items-center gap-3 pt-1">
              <span className="text-sm text-gray-400">How many?</span>
              <input
                type="number"
                min={1}
                className="input-field w-24 text-center"
                value={lTrackQty}
                onChange={e => setLTrackQty(e.target.value === '' ? '' : Number(e.target.value))}
              />
              <span className="text-sm text-gray-400">pcs</span>
            </div>
          )}
        </div>
      ),
      canProceed: inclLTrack !== null,
    },
    // 7 — Project ref + summary
    {
      question: 'Review & Dispatch',
      hint: 'Confirm the order details before dispatching',
      content: null, // rendered separately below
      canProceed: true,
    },
  ]

  const currentStep = steps[step]
  const isLastStep  = step === steps.length - 1

  // ── Build dispatch lines ─────────────────────────────────────────────────────
  function buildLines(): DispatchLine[] {
    const lines: DispatchLine[] = []
    if (motorType === 'standard') {
      lines.push({ itemCode: 'MOTOR',         label: 'Motor',         qty: motors })
      lines.push({ itemCode: 'RUNNERS(Pack)', label: 'Runners',       qty: runners,  note: `3 per ft × ${f}ft` })
      lines.push({ itemCode: 'CARRIERS',      label: 'Carriers',      qty: motors,   note: '1 per motor' })
      lines.push({ itemCode: 'BRACKET',       label: 'Bracket',       qty: brackets, note: '4 per motor' })
      lines.push({
        itemCode: kaanType === 'big' ? 'BIG KAAN' : 'SMALL KAAN',
        label: kaanType === 'big' ? 'Big Kaan' : 'Small Kaan',
        qty: kaanQty, note: '2 per motor',
      })
      if (inclPulley) lines.push({ itemCode: 'DRIVER PULLEY', label: 'Driver Pulley', qty: 1 })
      lines.push({ itemCode: 'BELT', label: 'Belt', qty: beltM, note: `${beltM}m` })
    } else {
      lines.push({ itemCode: 'TABULAR', label: 'Tabular Motor', qty: motors })
      lines.push({
        itemCode: hookSize === 'normal' ? 'TABULAR HOOK [PAIR]' : 'TABULAR HOOK SMALL',
        label: hookSize === 'normal' ? 'Tabular Hook (Pair)' : 'Tabular Hook Small',
        qty: hookQty, note: '2 per motor',
      })
    }
    if (remote && remote !== 'none') {
      const map = { '1ch': ['1 CH REMOTE', '1 Channel Remote'], '2ch': ['2 CH REMOTE', '2 Channel Remote'], 'tab': ['TAB REMOTE', 'Tab Remote'] }
      const [code, label] = map[remote]
      lines.push({ itemCode: code, label, qty: 1 })
    }
    if (inclLTrack && Number(lTrackQty) > 0) {
      lines.push({ itemCode: 'L TRACK', label: 'L Track', qty: Number(lTrackQty) })
    }
    return lines
  }

  const dispatchLines = isLastStep ? buildLines() : []

  // ── Dispatch ─────────────────────────────────────────────────────────────────
  const handleDispatch = async () => {
    setDispatching(true)
    try {
      const snap = await getDocs(query(collection(db, 'inventory'), where('productLine', '==', 'curtains')))
      const itemMap = new Map<string, InventoryItem & { id: string }>()
      snap.docs.forEach(d => itemMap.set(d.data().itemCode, { id: d.id, ...d.data() } as InventoryItem & { id: string }))

      for (const line of dispatchLines) {
        const item = itemMap.get(line.itemCode)
        if (!item) { toast.error(`Not found: ${line.itemCode}`); continue }
        const newIssued  = (item.issuedQty ?? 0) + line.qty
        const newClosing = (item.openingStock ?? 0) + (item.importedQty ?? 0) - newIssued
        const newStatus  = newClosing <= 0 ? 'out_of_stock' : newClosing <= (item.reorderLevel ?? 0) ? 'low_stock' : 'in_stock'
        await updateDoc(doc(db, 'inventory', item.id), { issuedQty: newIssued, closingStock: newClosing, stockStatus: newStatus, updatedAt: serverTimestamp() })
        await addDoc(collection(db, 'inventory', item.id, 'transactions'), {
          itemId: item.id, itemCode: item.itemCode, itemName: item.itemName,
          type: 'issue', quantity: line.qty, note: line.note ?? '',
          projectRef: projectRef || null, recordedBy: user?.id ?? '', recordedByName: user?.name ?? '',
          createdAt: serverTimestamp(),
        })
      }
      toast.success(`Dispatched for ${f}ft curtain order`)
      onClose()
    } catch (err) {
      toast.error('Dispatch failed')
      console.error(err)
    } finally {
      setDispatching(false)
    }
  }

  // ── UI ───────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col" style={{ maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
              Step {step + 1} of {steps.length}
            </p>
            <h2 className="text-base font-semibold text-white mt-0.5">{currentStep.question}</h2>
            {currentStep.hint && <p className="text-xs text-gray-500 mt-0.5">{currentStep.hint}</p>}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-gray-800">
          <div
            className="h-1 bg-gold-500 transition-all duration-300"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLastStep ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 font-medium">Project Reference (optional)</label>
                <input
                  className="input-field mt-1.5 w-full"
                  placeholder="e.g. GHA-P-2026-012 or client name"
                  value={projectRef}
                  onChange={e => setProjectRef(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="rounded-xl border border-gray-700 overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-800/60 border-b border-gray-700 flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">Materials to Dispatch</p>
                  <p className="text-xs text-gray-500">{motorType === 'standard' ? 'Standard' : 'Tabular'} · {f}ft</p>
                </div>
                <div className="divide-y divide-gray-800">
                  {dispatchLines.map(line => (
                    <div key={line.itemCode} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm text-gray-200 font-medium">{line.label}</p>
                        {line.note && <p className="text-xs text-gray-600 mt-0.5">{line.note}</p>}
                      </div>
                      <span className="w-10 h-10 rounded-full bg-gold-500/15 text-gold-400 font-bold text-sm flex items-center justify-center">
                        {line.qty}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            currentStep.content
          )}
        </div>

        {/* Footer nav */}
        <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-between">
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={step === 0}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>

          {isLastStep ? (
            <Button variant="primary" loading={dispatching} onClick={handleDispatch}>
              Dispatch Materials
            </Button>
          ) : (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={!currentStep.canProceed}
              className="flex items-center gap-1.5 text-sm px-5 py-2.5 rounded-xl bg-gold-500 text-black font-semibold hover:bg-gold-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
