import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Sparkles, Save, Check, Download } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'

import { Textarea } from '../../components/ui/Textarea'
import { Card } from '../../components/ui/Card'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, addDoc, serverTimestamp } from '../../lib/firebase'
import { callClaude } from '../../lib/ai'
import { downloadJDasPDF } from './downloadJD'
import toast from 'react-hot-toast'

interface Step1Data { title: string; department: string; employmentTypes: string[]; experienceLevel: string; vacancies: string }
interface Step2Data { dayToDay: string; outcomes: string; reportingTo: string }
interface Step3Data { mustHave: string; niceToHave: string; education: string; tools: string }
interface Step4Data { compensationType: 'salary' | 'stipend'; minAmount: string; maxAmount: string; perks: string }

const STEPS = ['Role Setup', 'Responsibilities', 'Requirements', 'Compensation', 'Generate JD']

export function JDWizard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [step, setStep] = useState(0)
  const [s1, setS1] = useState<Step1Data>({ title: '', department: '', employmentTypes: [], experienceLevel: 'junior', vacancies: '1' })
  const [s2, setS2] = useState<Step2Data>({ dayToDay: '', outcomes: '', reportingTo: '' })
  const [s3, setS3] = useState<Step3Data>({ mustHave: '', niceToHave: '', education: 'bachelors', tools: '' })
  const [s4, setS4] = useState<Step4Data>({ compensationType: 'salary', minAmount: '', maxAmount: '', perks: '' })
  const [generatedJD, setGeneratedJD] = useState('')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)

  const toggleEmpType = (type: string) => {
    setS1(p => ({
      ...p,
      employmentTypes: p.employmentTypes.includes(type)
        ? p.employmentTypes.filter(t => t !== type)
        : [...p.employmentTypes, type],
    }))
  }

  const canProceed = () => {
    if (step === 0) return s1.title.trim() !== '' && s1.department.trim() !== '' && s1.employmentTypes.length > 0
    if (step === 1) return s2.dayToDay.trim() !== ''
    if (step === 2) return s3.mustHave.trim() !== ''
    if (step === 3) return s4.minAmount !== '' || s4.maxAmount !== ''
    return true
  }

  /**
   * Fills Responsibilities, Requirements and Compensation from the role details
   * alone, so the only thing that has to be typed is step 1.
   *
   * The answers land in the same state the manual steps use, so they stay
   * reviewable and editable — this drafts the wizard, it does not bypass it.
   *
   * Returns the drafted values as well as setting them: setState is async, so the
   * caller cannot read them back off state in the same tick and would otherwise
   * write the JD from the empty fields.
   * Returns null if nothing usable came back, leaving the fields untouched.
   */
  const autoFillFromRole = async (): Promise<{ d2: Step2Data; d3: Step3Data; d4: Step4Data } | null> => {
    const empLabel: Record<string, string> = { full_time: 'Full-Time', part_time: 'Part-Time', internship: 'Internship', contract: 'Contract / Freelance' }
    const expLabel: Record<string, string> = { fresher: 'Fresher (0–1 year)', junior: 'Junior (1–3 years)', mid: 'Mid-level (3–5 years)', senior: 'Senior (5+ years)' }

    const prompt = `You are drafting a Job Description for Galaxy Home Automation, a premium smart home automation company in India (smart lighting, curtains, security, home theatre; sells to homeowners, architects and builders).

Role: ${s1.title}
Department / Team: ${s1.department}
Employment Type: ${s1.employmentTypes.map(t => empLabel[t] || t).join(' / ') || 'Full-Time'}
Experience Level: ${expLabel[s1.experienceLevel] || s1.experienceLevel}
Number of vacancies: ${s1.vacancies || '1'}

Return this exact JSON and nothing else:
{"dayToDay":"","outcomes":"","reportingTo":"","mustHave":"","niceToHave":"","education":"bachelors","tools":"","compensationType":"salary","minAmount":"","maxAmount":"","perks":""}

Where:
- dayToDay: 4-6 day-to-day tasks, one per line, each starting with a verb. Specific to this role at a home automation company.
- outcomes: 3-4 measurable outcomes expected in the first 3-6 months, one per line.
- reportingTo: who this role reports to and works with, one short line.
- mustHave: 4-6 essential skills, one per line.
- niceToHave: 2-4 bonus skills, one per line.
- education: exactly one of "no_pref" | "diploma" | "bachelors" | "masters" | "phd"
- tools: comma-separated tools or software realistic for this role.
- compensationType: "stipend" if the employment type is an internship, otherwise "salary"
- minAmount / maxAmount: realistic Indian market numbers as plain digits, no symbols or commas. For salary these are LPA (e.g. "4" to "7"). For a stipend these are rupees per month (e.g. "10000" to "15000").
- perks: one short line of realistic perks.`

    const raw = await callClaude(
      prompt,
      'You are an expert Indian technical recruiter. Return ONLY a JSON object with no surrounding text or markdown.',
      1400,
    )
    const cleaned = raw.replace(/```json|```/g, '').trim()
    const d = JSON.parse(cleaned) as Partial<Step2Data & Step3Data & Step4Data>

    if (!d.dayToDay?.trim() || !d.mustHave?.trim()) return null

    const EDU = ['no_pref', 'diploma', 'bachelors', 'masters', 'phd']
    // Digits only — the model sometimes returns "4 LPA" or "₹10,000" despite the
    // instruction, and a non-numeric amount would be saved as NaN.
    const num = (v: unknown) => String(v ?? '').replace(/[^\d.]/g, '')

    const d2: Step2Data = {
      dayToDay: d.dayToDay.trim(),
      outcomes: d.outcomes?.trim() ?? '',
      reportingTo: d.reportingTo?.trim() ?? '',
    }
    const d3: Step3Data = {
      mustHave: d.mustHave.trim(),
      niceToHave: d.niceToHave?.trim() ?? '',
      education: EDU.includes(String(d.education)) ? String(d.education) : 'bachelors',
      tools: d.tools?.trim() ?? '',
    }
    const d4: Step4Data = {
      compensationType: d.compensationType === 'stipend' ? 'stipend' : 'salary',
      minAmount: num(d.minAmount),
      maxAmount: num(d.maxAmount),
      perks: d.perks?.trim() ?? '',
    }

    setS2(d2); setS3(d3); setS4(d4)
    return { d2, d3, d4 }
  }

  /** Step 1 -> finished JD in one go: drafts steps 2-4, then writes the JD. */
  const generateEverything = async () => {
    setGenerating(true)
    try {
      const drafted = await autoFillFromRole()
      if (!drafted) {
        toast.error("Couldn't draft the details — fill the steps in yourself or try again")
        return
      }
      // Pass the drafted values straight through; state has not committed yet.
      await runGenerateJD(drafted.d2, drafted.d3, drafted.d4)
      setStep(STEPS.length - 1)
      toast.success('Drafted every step — review and edit anything')
    } catch (err) {
      if (err instanceof SyntaxError) toast.error('The AI reply was malformed — please try again')
      else toast.error(err instanceof Error ? err.message : 'Failed to draft the job description')
    } finally {
      setGenerating(false)
    }
  }

  const generateJD = async () => {
    setGenerating(true)
    try {
      await runGenerateJD()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate JD')
    } finally {
      setGenerating(false)
    }
  }

  /** Defaults to whatever is in state; callers that just drafted pass values in. */
  const runGenerateJD = async (g2: Step2Data = s2, g3: Step3Data = s3, g4: Step4Data = s4) => {
    {
      const empLabel: Record<string, string> = { full_time: 'Full-Time', part_time: 'Part-Time', internship: 'Internship', contract: 'Contract / Freelance' }
      const empTypes = s1.employmentTypes.map(t => empLabel[t] || t).join(' / ')
      const expLabel: Record<string, string> = { fresher: 'Fresher (0–1 year)', junior: 'Junior (1–3 years)', mid: 'Mid-level (3–5 years)', senior: 'Senior (5+ years)' }
      const eduLabel: Record<string, string> = { no_pref: 'No preference', diploma: 'Diploma', bachelors: "Bachelor's degree", masters: "Master's degree", phd: 'PhD' }
      const compText = g4.compensationType === 'stipend'
        ? `Monthly Stipend: ₹${g4.minAmount || '?'} – ₹${g4.maxAmount || '?'}`
        : `Annual Salary: ₹${g4.minAmount || '?'} – ₹${g4.maxAmount || '?'} LPA`

      const prompt = `Generate a professional Job Description for Galaxy Home Automation, a premium smart home automation company in India.

**Role:** ${s1.title}
**Department:** ${s1.department}
**Employment Type:** ${empTypes}
**Experience Level:** ${expLabel[s1.experienceLevel] || s1.experienceLevel}

**Day-to-day tasks:**
${g2.dayToDay}

**Key outcomes expected (3–6 months):**
${g2.outcomes || 'Not specified'}

**Reports to / works with:**
${g2.reportingTo || 'Not specified'}

**Must-have skills:**
${g3.mustHave}

**Nice-to-have:**
${g3.niceToHave || 'None'}

**Education requirement:**
${eduLabel[g3.education] || g3.education}

**Tools / software:**
${g3.tools || 'Not specified'}

**Compensation:**
${compText}${g4.perks ? `\nPerks: ${g4.perks}` : ''}

Write a complete, polished JD with exactly these sections using ## headings:
## About the Role
## Key Responsibilities
## Requirements
## What We're Looking For
## Compensation & Benefits

Be specific, warm in tone, and avoid generic filler. Mention Galaxy Home Automation where it adds context.`

      const jd = await callClaude(prompt, 'You are an expert HR writer. Generate job descriptions that are professional, specific, and compelling. Use ## markdown headings for sections. Respond with only the job description text.')
      setGeneratedJD(jd)
    }
  }

  const handleSave = async () => {
    if (!generatedJD.trim()) { toast.error('Generate the JD first'); return }
    setSaving(true)
    try {
      // Extract bullet points from the generated markdown
      const lines = generatedJD.split('\n').map(l => l.trim()).filter(Boolean)
      const responsibilities: string[] = []
      const prerequisites: string[] = []
      let inResp = false
      let inReq = false
      for (const line of lines) {
        const lower = line.toLowerCase()
        if (lower.startsWith('## key responsibilities')) { inResp = true; inReq = false; continue }
        if (lower.startsWith('## requirements')) { inReq = true; inResp = false; continue }
        if (lower.startsWith('##')) { inResp = false; inReq = false; continue }
        const isBullet = line.startsWith('-') || line.startsWith('•') || line.startsWith('*') || /^\d+\./.test(line)
        if (isBullet) {
          const text = line.replace(/^[-•*\d.]\s*/, '').trim()
          if (inResp) responsibilities.push(text)
          if (inReq) prerequisites.push(text)
        }
      }

      await addDoc(collection(db, 'jobDescriptions'), {
        title: s1.title,
        department: s1.department,
        employmentType: s1.employmentTypes.join(','),
        experienceLevel: s1.experienceLevel,
        vacancies: Math.max(1, parseInt(s1.vacancies) || 1),
        prerequisites: prerequisites.length ? prerequisites : s3.mustHave.split('\n').filter(Boolean),
        responsibilities: responsibilities.length ? responsibilities : s2.dayToDay.split('\n').filter(Boolean),
        compensation: {
          type: s4.compensationType,
          ...(s4.minAmount ? { min: parseFloat(s4.minAmount) } : {}),
          ...(s4.maxAmount ? { max: parseFloat(s4.maxAmount) } : {}),
          ...(s4.perks ? { note: s4.perks } : {}),
        },
        rawJD: generatedJD,
        createdBy: user?.id,
        createdByName: user?.name,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      toast.success('Job Description saved!')
      navigate('/hr')
    } catch {
      toast.error('Failed to save job description')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/hr')} className="text-gray-400 hover:text-gray-200 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="page-title">New Job Description</h1>
          <p className="text-sm text-gray-500 mt-0.5">Answer a few questions — AI will write the JD for you</p>
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STEPS.map((label, i) => (
          <div key={i} className="flex items-center gap-1 shrink-0">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              i === step ? 'bg-gold-400/10 text-gold-400 border border-gold-400/30' :
              i < step  ? 'text-gray-400 bg-gray-800/50' :
                          'text-gray-600'
            }`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold border ${
                i < step  ? 'border-gray-500 bg-gray-700' :
                i === step ? 'border-gold-400' :
                             'border-gray-700'
              }`}>
                {i < step ? <Check className="w-3 h-3" /> : i + 1}
              </span>
              {label}
            </div>
            {i < STEPS.length - 1 && <span className="text-gray-700 text-xs">›</span>}
          </div>
        ))}
      </div>

      {/* Step content */}
      <Card>
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-200 mb-0.5">Tell us about this role</h2>
              <p className="text-xs text-gray-500">Basic details to frame the job description</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Job Title *" placeholder="e.g. Business Development Executive" value={s1.title} onChange={e => setS1(p => ({ ...p, title: e.target.value }))} />
              <Input label="Department / Team *" placeholder="e.g. Sales, Operations, Tech" value={s1.department} onChange={e => setS1(p => ({ ...p, department: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Number of Vacancies *"
                type="number"
                min={1}
                placeholder="1"
                value={s1.vacancies}
                onChange={e => setS1(p => ({ ...p, vacancies: e.target.value }))}
              />
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-gray-400 mb-2">Employment Type * <span className="text-gray-600 font-normal">(select all that apply)</span></p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'full_time', label: 'Full-Time' },
                    { value: 'part_time', label: 'Part-Time' },
                    { value: 'internship', label: 'Internship' },
                    { value: 'contract', label: 'Contract / Freelance' },
                  ].map(opt => {
                    const checked = s1.employmentTypes.includes(opt.value)
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggleEmpType(opt.value)}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm transition-all text-left ${
                          checked
                            ? 'border-gold-400/60 bg-gold-400/10 text-gold-300'
                            : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                        }`}
                      >
                        <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all ${
                          checked ? 'bg-gold-400 border-gold-400' : 'border-gray-600'
                        }`}>
                          {checked && <Check className="w-2.5 h-2.5 text-gray-950" />}
                        </span>
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
                {s1.employmentTypes.length === 0 && (
                  <p className="text-xs text-gray-600 mt-1.5">Select at least one type to continue</p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-gray-400 mb-2">Experience Level *</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'fresher', label: 'Fresher', sub: '0–1 year' },
                    { value: 'junior',  label: 'Junior',  sub: '1–3 years' },
                    { value: 'mid',     label: 'Mid-level', sub: '3–5 years' },
                    { value: 'senior',  label: 'Senior',  sub: '5+ years' },
                  ].map(opt => {
                    const checked = s1.experienceLevel === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setS1(p => ({ ...p, experienceLevel: opt.value }))}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm transition-all text-left ${
                          checked
                            ? 'border-gold-400/60 bg-gold-400/10 text-gold-300'
                            : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                        }`}
                      >
                        <span className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                          checked ? 'bg-gold-400 border-gold-400' : 'border-gray-600'
                        }`}>
                          {checked && <span className="w-2 h-2 rounded-full bg-gray-950" />}
                        </span>
                        <span>
                          <span className="font-medium">{opt.label}</span>
                          <span className="text-xs text-gray-500 ml-1.5">{opt.sub}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Everything below this step can be written from the role alone. */}
            <div className="rounded-lg border border-gold-400/30 bg-gold-400/[0.06] p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-gold-300">Let AI write the rest</p>
                  <p className="text-xs text-gray-400 mt-0.5 max-w-md">
                    Drafts the responsibilities, requirements, compensation and the full job
                    description from the details above. You can edit any step afterwards.
                  </p>
                </div>
                <Button
                  onClick={generateEverything}
                  loading={generating}
                  disabled={!canProceed()}
                  icon={<Sparkles className="w-4 h-4" />}
                >
                  Generate everything
                </Button>
              </div>
              {!canProceed() && (
                <p className="text-xs text-gray-600 mt-2">Fill in the title, department and employment type first.</p>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-200 mb-0.5">What will this person do?</h2>
              <p className="text-xs text-gray-500">The more specific you are, the better the AI output</p>
            </div>
            <Textarea
              label="Day-to-day tasks *"
              placeholder="Describe what this person does on a typical day. e.g. Generate and qualify leads via cold calling and LinkedIn, conduct site visits with potential customers, coordinate with the PM team for project handovers..."
              rows={5}
              value={s2.dayToDay}
              onChange={e => setS2(p => ({ ...p, dayToDay: e.target.value }))}
            />
            <Textarea
              label="Key outcomes expected in the first 3–6 months"
              placeholder="e.g. Close at least 5 projects, Build a pipeline of 50+ qualified leads, Onboard 10 B2B partners..."
              rows={3}
              value={s2.outcomes}
              onChange={e => setS2(p => ({ ...p, outcomes: e.target.value }))}
            />
            <Input
              label="Reports to / works with"
              placeholder="e.g. Reports to Sales Head, closely works with PM team"
              value={s2.reportingTo}
              onChange={e => setS2(p => ({ ...p, reportingTo: e.target.value }))}
            />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-200 mb-0.5">What does the ideal candidate look like?</h2>
              <p className="text-xs text-gray-500">List skills, qualifications, and tools they need</p>
            </div>
            <Textarea
              label="Must-have skills & qualifications *"
              placeholder="Non-negotiable requirements. e.g. Strong spoken English, Experience in B2B/B2C sales, Proficient in Excel, Own vehicle for site visits..."
              rows={4}
              value={s3.mustHave}
              onChange={e => setS3(p => ({ ...p, mustHave: e.target.value }))}
            />
            <Textarea
              label="Nice-to-have (bonus skills)"
              placeholder="Good to have but not essential. e.g. Knowledge of home automation, Prior experience in real estate or interior design industry..."
              rows={3}
              value={s3.niceToHave}
              onChange={e => setS3(p => ({ ...p, niceToHave: e.target.value }))}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="Minimum Education"
                value={s3.education}
                onChange={e => setS3(p => ({ ...p, education: e.target.value }))}
                options={[
                  { value: 'no_pref', label: 'No Preference' },
                  { value: 'diploma', label: 'Diploma' },
                  { value: 'bachelors', label: "Bachelor's Degree" },
                  { value: 'masters', label: "Master's Degree" },
                  { value: 'phd', label: 'PhD' },
                ]}
              />
              <Input
                label="Key tools / software"
                placeholder="e.g. Excel, Google Workspace, AutoCAD"
                value={s3.tools}
                onChange={e => setS3(p => ({ ...p, tools: e.target.value }))}
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-200 mb-0.5">Compensation details</h2>
              <p className="text-xs text-gray-500">This will appear in the Benefits section of the JD</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-2 font-medium">Compensation type</p>
              <div className="flex gap-3">
                {(['salary', 'stipend'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => setS4(p => ({ ...p, compensationType: type }))}
                    className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                      s4.compensationType === type
                        ? 'border-gold-400/60 text-gold-400 bg-gold-400/10'
                        : 'border-gray-700 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    {type === 'salary' ? 'Salary (Annual LPA)' : 'Stipend (Monthly)'}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label={s4.compensationType === 'salary' ? 'Min (₹ LPA)' : 'Min (₹ / month)'}
                type="number"
                placeholder={s4.compensationType === 'salary' ? 'e.g. 3' : 'e.g. 8000'}
                value={s4.minAmount}
                onChange={e => setS4(p => ({ ...p, minAmount: e.target.value }))}
              />
              <Input
                label={s4.compensationType === 'salary' ? 'Max (₹ LPA)' : 'Max (₹ / month)'}
                type="number"
                placeholder={s4.compensationType === 'salary' ? 'e.g. 5' : 'e.g. 15000'}
                value={s4.maxAmount}
                onChange={e => setS4(p => ({ ...p, maxAmount: e.target.value }))}
              />
            </div>
            <Textarea
              label="Perks & benefits (optional)"
              placeholder="e.g. Health insurance, flexible timings, annual bonus, team outings, professional development budget..."
              rows={3}
              value={s4.perks}
              onChange={e => setS4(p => ({ ...p, perks: e.target.value }))}
            />
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-200 mb-0.5">AI-Generated Job Description</h2>
                <p className="text-xs text-gray-500">Review and edit before saving</p>
              </div>
              <div className="flex gap-2">
                {generatedJD && (
                  <Button variant="secondary" size="sm" onClick={generateJD} loading={generating} icon={<Sparkles className="w-3.5 h-3.5" />}>
                    Regenerate
                  </Button>
                )}
                {!generatedJD && (
                  <Button onClick={generateJD} loading={generating} icon={<Sparkles className="w-4 h-4" />}>
                    Generate with AI
                  </Button>
                )}
              </div>
            </div>

            {!generatedJD && !generating && (
              <div className="rounded-xl border border-dashed border-gray-700 p-16 text-center">
                <Sparkles className="w-10 h-10 mx-auto mb-3 text-gray-700" />
                <p className="text-sm text-gray-500 mb-1">Ready to generate</p>
                <p className="text-xs text-gray-600">Click "Generate with AI" to create your JD based on your answers</p>
              </div>
            )}

            {generating && (
              <div className="rounded-xl border border-gray-800 p-16 text-center">
                <div className="w-8 h-8 border-2 border-gold-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-gray-400">Writing your job description…</p>
              </div>
            )}

            {generatedJD && !generating && (
              <div className="space-y-2">
                <textarea
                  className="w-full min-h-[420px] bg-gray-900/80 border border-gray-700 rounded-xl p-4 text-sm text-gray-200 font-mono resize-y focus:outline-none focus:border-gold-400/50 focus:ring-1 focus:ring-gold-400/20 transition-colors"
                  value={generatedJD}
                  onChange={e => setGeneratedJD(e.target.value)}
                  spellCheck={false}
                />
                <p className="text-xs text-gray-600">You can freely edit the text above — it's yours once saved.</p>
              </div>
            )}
          </div>
        )}

        {/* Navigation footer */}
        <div className="flex items-center justify-between mt-6 pt-5 border-t border-gray-800">
          <Button
            variant="secondary"
            onClick={() => step === 0 ? navigate('/hr') : setStep(s => s - 1)}
            icon={<ArrowLeft className="w-4 h-4" />}
          >
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          <div className="flex gap-3">
            {step < 4 && (
              <Button
                onClick={() => setStep(s => s + 1)}
                disabled={!canProceed()}
                iconRight={<ArrowRight className="w-4 h-4" />}
              >
                Next
              </Button>
            )}
            {step === 4 && generatedJD && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => downloadJDasPDF({
                    id: '', title: s1.title, department: s1.department,
                    employmentType: s1.employmentTypes.join(',') as import('../../types').EmploymentType,
                    experienceLevel: s1.experienceLevel as import('../../types').ExperienceLevel,
                    prerequisites: [], responsibilities: [],
                    compensation: { type: s4.compensationType, min: s4.minAmount ? parseFloat(s4.minAmount) : undefined, max: s4.maxAmount ? parseFloat(s4.maxAmount) : undefined },
                    rawJD: generatedJD,
                    createdBy: '', createdAt: null as never, updatedAt: null as never,
                  })}
                  icon={<Download className="w-4 h-4" />}
                >
                  Download PDF
                </Button>
                <Button onClick={handleSave} loading={saving} icon={<Save className="w-4 h-4" />}>
                  Save Job Description
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
