import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Sparkles, Plus, Trash2, Loader2, ExternalLink, FileText, CheckCircle2,
} from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Textarea } from '../../components/ui/Textarea'
import { useAuth } from '../../contexts/AuthContext'
import { db, doc, getDoc, updateDoc, serverTimestamp } from '../../lib/firebase'
import { downloadFromDrive, uploadBlobToDrive } from '../../lib/googleDrive'
import { extractRawText, extractStructuredInvoiceData, ExtractionError } from '../../lib/documentExtraction'
import { buildInvoicePdf, buildPackingListPdf } from '../../lib/generateAccountsPdf'
import { nextAccountsInvoiceNumber } from '../../lib/counters'
import toast from 'react-hot-toast'
import type { AccountDocument, CompanyProfile, ExtractedInvoiceData, ExtractedLineItem } from '../../types'

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

const EMPTY_ITEM = (): ExtractedLineItem => ({ id: uid(), description: '', quantity: 1, unitPrice: 0 })

export function DocumentReviewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [doc_, setDoc_] = useState<AccountDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [extracting, setExtracting] = useState(false)

  // Editable review state — the AI's output plus whatever the accountant has
  // changed on top of it. Kept in local state rather than writing to Firestore
  // per keystroke; it is persisted explicitly on Generate and on Save & Confirm.
  const [data, setData] = useState<ExtractedInvoiceData>({ items: [] })

  const [profile, setProfile] = useState<CompanyProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)

  const [generating, setGenerating] = useState(false)
  const [invoicePreviewUrl, setInvoicePreviewUrl] = useState<string | null>(null)
  const [packingPreviewUrl, setPackingPreviewUrl] = useState<string | null>(null)
  const invoiceBlobRef = useRef<Blob | null>(null)
  const packingBlobRef = useRef<Blob | null>(null)
  const [savingFinal, setSavingFinal] = useState(false)

  useEffect(() => {
    if (!id) return
    getDoc(doc(db, 'accountDocuments', id)).then(snap => {
      if (snap.exists()) {
        const d = { id: snap.id, ...snap.data() } as AccountDocument
        setDoc_(d)
        if (d.extractedData) setData(d.extractedData)
      }
      setLoading(false)
    })
  }, [id])

  useEffect(() => {
    getDoc(doc(db, 'settings', 'accountsCompanyProfile')).then(snap => {
      if (snap.exists()) setProfile(snap.data() as CompanyProfile)
      setProfileLoading(false)
    }).catch(() => setProfileLoading(false))
  }, [])

  // Revoke blob: URLs on unmount / regeneration so they don't leak memory.
  useEffect(() => () => {
    if (invoicePreviewUrl) URL.revokeObjectURL(invoicePreviewUrl)
    if (packingPreviewUrl) URL.revokeObjectURL(packingPreviewUrl)
  }, [invoicePreviewUrl, packingPreviewUrl])

  const handleExtract = useCallback(async () => {
    if (!doc_ || !id) return
    setExtracting(true)
    try {
      const blob = await downloadFromDrive(doc_.driveFileId)
      const rawText = await extractRawText(blob, doc_.mimeType, doc_.fileName)
      const extracted = await extractStructuredInvoiceData(rawText)

      await updateDoc(doc(db, 'accountDocuments', id), {
        extractedData: extracted,
        status: 'extracted',
        updatedAt: serverTimestamp(),
      })
      setData(extracted)
      setDoc_(prev => prev ? { ...prev, extractedData: extracted, status: 'extracted' } : prev)
      toast.success('Extracted — review the details below before generating')
    } catch (err) {
      const message = err instanceof ExtractionError ? err.message : 'Extraction failed — please try again'
      toast.error(message)
      if (err instanceof ExtractionError) {
        // Still a usable outcome: an empty review form the accountant fills by
        // hand, rather than a dead end.
        setData({ items: [EMPTY_ITEM()] })
      }
    } finally {
      setExtracting(false)
    }
  }, [doc_, id])

  const updateItem = (itemId: string, patch: Partial<ExtractedLineItem>) => {
    setData(d => ({ ...d, items: d.items.map(it => (it.id === itemId ? { ...it, ...patch } : it)) }))
  }
  const addItem = () => setData(d => ({ ...d, items: [...d.items, EMPTY_ITEM()] }))
  const removeItem = (itemId: string) => setData(d => ({ ...d, items: d.items.filter(it => it.id !== itemId) }))

  const total = data.items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0)

  const handleGenerate = useCallback(async () => {
    if (!doc_ || !id) return
    if (!profile?.name || !profile.address || !profile.gstin) {
      toast.error('Company profile is not set up yet — ask a manager to fill it in under Settings → System')
      return
    }
    if (data.items.length === 0 || data.items.every(it => !it.description.trim())) {
      toast.error('Add at least one line item first')
      return
    }

    setGenerating(true)
    try {
      // Reuse the same invoice number across regenerations — a fresh number on
      // every click would burn the sequence and confuse anyone matching a draft
      // back to what they saw a minute ago.
      const invoiceNumber = doc_.invoiceNumber ?? await nextAccountsInvoiceNumber()

      const invoiceBlob = buildInvoicePdf(profile, data, invoiceNumber)
      const packingBlob = buildPackingListPdf(profile, data, invoiceNumber)

      if (invoicePreviewUrl) URL.revokeObjectURL(invoicePreviewUrl)
      if (packingPreviewUrl) URL.revokeObjectURL(packingPreviewUrl)
      invoiceBlobRef.current = invoiceBlob
      packingBlobRef.current = packingBlob
      setInvoicePreviewUrl(URL.createObjectURL(invoiceBlob))
      setPackingPreviewUrl(URL.createObjectURL(packingBlob))

      // This is the "Save Changes" checkpoint from the accountant's point of
      // view: their edits and the invoice number are persisted now, so a
      // refresh mid-review does not lose either. The generated PDFs themselves
      // are not uploaded to Drive until Save & Confirm — no reason to litter
      // Drive with a version for every regeneration before they are happy.
      await updateDoc(doc(db, 'accountDocuments', id), {
        extractedData: data,
        invoiceNumber,
        status: 'generated',
        updatedAt: serverTimestamp(),
      })
      setDoc_(prev => prev ? { ...prev, extractedData: data, invoiceNumber, status: 'generated' } : prev)
      toast.success('Preview generated — check both documents below')
    } catch (err) {
      console.error(err)
      toast.error('Could not generate the documents — please try again')
    } finally {
      setGenerating(false)
    }
  }, [doc_, id, profile, data, invoicePreviewUrl, packingPreviewUrl])

  const handleSaveConfirm = useCallback(async () => {
    if (!doc_ || !id || !invoiceBlobRef.current || !packingBlobRef.current || !doc_.invoiceNumber) return
    setSavingFinal(true)
    try {
      const invoiceUpload = await uploadBlobToDrive(invoiceBlobRef.current, `Invoice ${doc_.invoiceNumber}.pdf`)
      const packingUpload = await uploadBlobToDrive(packingBlobRef.current, `Packing List ${doc_.invoiceNumber}.pdf`)

      await updateDoc(doc(db, 'accountDocuments', id), {
        status: 'saved',
        invoicePdf: invoiceUpload,
        packingListPdf: packingUpload,
        savedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      setDoc_(prev => prev ? {
        ...prev, status: 'saved', invoicePdf: invoiceUpload, packingListPdf: packingUpload,
      } : prev)
      toast.success('Saved — invoice and packing list are final')
    } catch (err) {
      console.error(err)
      toast.error('Could not save the final documents to Drive — please try again')
    } finally {
      setSavingFinal(false)
    }
  }, [doc_, id])

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-gray-600 text-sm gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
  }
  if (!doc_) {
    return (
      <div className="max-w-2xl">
        <p className="text-sm text-gray-500">Document not found.</p>
        <Button variant="secondary" onClick={() => navigate('/accounts/documents')} className="mt-3">Back to Documents Upload</Button>
      </div>
    )
  }

  const canEdit = user?.role !== 'pending'

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/accounts/documents')} className="text-gray-400 hover:text-gray-200 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="page-title truncate">{doc_.fileName}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {doc_.status === 'saved' ? 'Final — invoice and packing list saved'
              : doc_.status === 'generated' ? 'Preview generated — review, then Save & Confirm'
              : doc_.status === 'extracted' ? 'Extracted — review the details below'
              : 'Uploaded — not yet processed'}
          </p>
        </div>
        <a href={doc_.driveViewUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-200 shrink-0">
          <ExternalLink className="w-3.5 h-3.5" /> Source file
        </a>
      </div>

      {!doc_.extractedData && (
        <Card>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-200">Read this document</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Pulls out the buyer's details and line items automatically. You review and fix anything wrong next.
              </p>
            </div>
            <Button onClick={handleExtract} loading={extracting} icon={<Sparkles className="w-4 h-4" />}>
              Extract Information
            </Button>
          </div>
        </Card>
      )}

      {doc_.extractedData !== undefined && (
        <>
          {profileLoading ? null : (!profile?.name || !profile.address || !profile.gstin) && (
            <Card className="border-yellow-800/40 bg-yellow-900/10">
              <p className="text-xs text-yellow-400">
                Company profile is not set up — an invoice cannot be generated until a manager fills in Galaxy's
                name, address and GSTIN under <strong>Settings → System → Company profile</strong>.
              </p>
            </Card>
          )}

          {/* Buyer details */}
          <Card>
            <h2 className="text-sm font-semibold text-gray-200 mb-3">Buyer details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Name" value={data.buyerName ?? ''} disabled={!canEdit}
                onChange={e => setData(d => ({ ...d, buyerName: e.target.value }))} />
              <Input label="GSTIN" value={data.buyerGstin ?? ''} disabled={!canEdit}
                onChange={e => setData(d => ({ ...d, buyerGstin: e.target.value }))} />
              <div className="sm:col-span-2">
                <Input label="Address" value={data.buyerAddress ?? ''} disabled={!canEdit}
                  onChange={e => setData(d => ({ ...d, buyerAddress: e.target.value }))} />
              </div>
              <Input label="Contact" value={data.buyerContact ?? ''} disabled={!canEdit}
                onChange={e => setData(d => ({ ...d, buyerContact: e.target.value }))} />
            </div>
          </Card>

          {/* Line items */}
          <Card padding="none">
            <div className="p-4 pb-0 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-200">Line items</h2>
              {canEdit && (
                <button onClick={addItem} className="flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300">
                  <Plus className="w-3.5 h-3.5" /> Add item
                </button>
              )}
            </div>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-[11px] uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-2 min-w-[220px]">Description</th>
                    <th className="px-2 py-2 min-w-[120px]">Model</th>
                    <th className="px-2 py-2 w-28">HSN Code</th>
                    <th className="px-2 py-2 w-20 text-center">Qty</th>
                    <th className="px-2 py-2 w-32 text-right">Unit Price</th>
                    <th className="px-2 py-2 w-32 text-right">Amount</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(it => (
                    <tr key={it.id} className="border-b border-gray-800/60">
                      <td className="px-4 py-1.5">
                        <input value={it.description} disabled={!canEdit}
                          onChange={e => updateItem(it.id, { description: e.target.value })}
                          placeholder="Description" className="w-full bg-transparent text-xs text-gray-200 focus:outline-none" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={it.model ?? ''} disabled={!canEdit}
                          onChange={e => updateItem(it.id, { model: e.target.value })}
                          placeholder="—" className="w-full bg-transparent text-xs text-gray-300 focus:outline-none" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={it.hsnCode ?? ''} disabled={!canEdit}
                          onChange={e => updateItem(it.id, { hsnCode: e.target.value })}
                          placeholder="—" className="w-full bg-transparent text-xs text-gray-300 focus:outline-none" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min={0} value={it.quantity} disabled={!canEdit}
                          onChange={e => updateItem(it.id, { quantity: Number(e.target.value) || 0 })}
                          className="w-full bg-transparent text-xs text-gray-200 text-center focus:outline-none" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min={0} value={it.unitPrice} disabled={!canEdit}
                          onChange={e => updateItem(it.id, { unitPrice: Number(e.target.value) || 0 })}
                          className="w-full bg-transparent text-xs text-gray-200 text-right focus:outline-none" />
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs text-gray-400 tabular-nums">
                        {(it.quantity * it.unitPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-2 py-1.5">
                        {canEdit && (
                          <button onClick={() => removeItem(it.id)} className="text-gray-600 hover:text-red-400">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.items.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-6 text-center text-xs text-gray-600">No items yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 flex justify-end border-t border-gray-800 mt-2">
              <p className="text-sm font-semibold text-gray-200">
                Total: <span className="tabular-nums">₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </p>
            </div>
          </Card>

          <Card>
            <Textarea label="Notes" rows={2} value={data.notes ?? ''} disabled={!canEdit}
              onChange={e => setData(d => ({ ...d, notes: e.target.value }))}
              placeholder="Payment terms, delivery notes, anything else worth carrying onto the invoice" />
          </Card>

          {canEdit && (
            <div className="flex items-center gap-3">
              <Button onClick={handleGenerate} loading={generating} icon={<FileText className="w-4 h-4" />}>
                {doc_.status === 'generated' || doc_.status === 'saved' ? 'Regenerate preview' : 'Generate Invoice + Packing List'}
              </Button>
              {doc_.status === 'saved' && (
                <span className="flex items-center gap-1.5 text-xs text-green-400">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Saved as {doc_.invoiceNumber}
                </span>
              )}
            </div>
          )}
        </>
      )}

      {/* Previews */}
      {(invoicePreviewUrl || packingPreviewUrl) && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-200">Preview</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {invoicePreviewUrl && (
              <div>
                <p className="text-xs text-gray-500 mb-1.5">Invoice</p>
                <iframe src={invoicePreviewUrl} title="Invoice preview" className="w-full h-[500px] rounded-lg border border-gray-800 bg-white" />
              </div>
            )}
            {packingPreviewUrl && (
              <div>
                <p className="text-xs text-gray-500 mb-1.5">Packing List</p>
                <iframe src={packingPreviewUrl} title="Packing list preview" className="w-full h-[500px] rounded-lg border border-gray-800 bg-white" />
              </div>
            )}
          </div>

          {canEdit && doc_.status !== 'saved' && (
            <div className="flex items-center gap-3">
              <Button onClick={handleSaveConfirm} loading={savingFinal} icon={<CheckCircle2 className="w-4 h-4" />}>
                Save &amp; Confirm
              </Button>
              <p className="text-xs text-gray-600">
                If anything above looks wrong, edit the fields and click Regenerate before saving.
              </p>
            </div>
          )}
        </div>
      )}

      {doc_.status === 'saved' && doc_.invoicePdf && doc_.packingListPdf && (
        <Card className="border-green-800/40 bg-green-900/10">
          <div className="flex items-center gap-6 text-xs">
            <span className="flex items-center gap-1.5 text-green-400"><CheckCircle2 className="w-3.5 h-3.5" /> Final documents saved</span>
            <a href={doc_.invoicePdf.driveViewUrl} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-200 flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> Invoice
            </a>
            <a href={doc_.packingListPdf.driveViewUrl} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-200 flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> Packing List
            </a>
          </div>
        </Card>
      )}
    </div>
  )
}
