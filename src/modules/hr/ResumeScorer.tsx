import { useState, useRef } from 'react'
import { X, Upload, Sparkles, User, Mail, Phone, CheckCircle2, AlertCircle, MinusCircle, XCircle } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, addDoc, serverTimestamp } from '../../lib/firebase'
import { callClaude } from '../../lib/ai'
import type { JobDescription, HireRecommendation, ScoreBreakdown } from '../../types'
import toast from 'react-hot-toast'

interface ScoreResult {
  score: number
  breakdown: ScoreBreakdown
  strengths: string[]
  gaps: string[]
  summary: string
  recommendation: HireRecommendation
}

interface ResumeScorerProps {
  open: boolean
  onClose: () => void
  jd: JobDescription
}

const RECOMMENDATION_CONFIG: Record<HireRecommendation, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  strong_yes: { label: 'Strong Hire',   color: 'text-green-400',   bg: 'bg-green-900/30 border-green-800/50',   icon: <CheckCircle2 className="w-4 h-4" /> },
  yes:        { label: 'Hire',          color: 'text-emerald-400', bg: 'bg-emerald-900/30 border-emerald-800/50', icon: <CheckCircle2 className="w-4 h-4" /> },
  maybe:      { label: 'Maybe',         color: 'text-yellow-400',  bg: 'bg-yellow-900/30 border-yellow-800/50',  icon: <MinusCircle className="w-4 h-4" /> },
  no:         { label: 'Do Not Hire',   color: 'text-red-400',     bg: 'bg-red-900/30 border-red-800/50',        icon: <XCircle className="w-4 h-4" /> },
}

function ScoreCircle({ score }: { score: number }) {
  const radius = 44
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const color = score >= 75 ? '#4ade80' : score >= 50 ? '#facc15' : score >= 30 ? '#fb923c' : '#f87171'

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="110" height="110" viewBox="0 0 110 110">
        <circle cx="55" cy="55" r={radius} fill="none" stroke="#1f2937" strokeWidth="8" />
        <circle
          cx="55" cy="55" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 55 55)"
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
        <text x="55" y="58" textAnchor="middle" fill={color} fontSize="22" fontWeight="bold">{score}</text>
        <text x="55" y="72" textAnchor="middle" fill="#6b7280" fontSize="10">/100</text>
      </svg>
      <p className="text-xs text-gray-500 font-medium">Overall Score</p>
    </div>
  )
}

function BreakdownBar({ label, value }: { label: string; value: number }) {
  const color = value >= 75 ? 'bg-green-500' : value >= 50 ? 'bg-yellow-500' : value >= 30 ? 'bg-orange-500' : 'bg-red-500'
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 font-medium">{value}/100</span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

export function ResumeScorer({ open, onClose, jd }: ResumeScorerProps) {
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [candidateName, setCandidateName] = useState('')
  const [candidateEmail, setCandidateEmail] = useState('')
  const [candidatePhone, setCandidatePhone] = useState('')
  const [resumeText, setResumeText] = useState('')
  const [scoring, setScoring] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<ScoreResult | null>(null)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== 'text/plain') { toast.error('Only .txt files are supported'); return }
    const reader = new FileReader()
    reader.onload = ev => setResumeText(ev.target?.result as string)
    reader.readAsText(file)
  }

  const scoreResume = async () => {
    if (!candidateName.trim()) { toast.error('Enter candidate name'); return }
    if (!resumeText.trim()) { toast.error('Paste or upload a resume'); return }
    setScoring(true)
    setResult(null)
    try {
      const jdText = jd.rawJD || [
        `Title: ${jd.title}`,
        `Department: ${jd.department}`,
        `\nResponsibilities:\n${jd.responsibilities.map(r => `- ${r}`).join('\n')}`,
        `\nRequirements:\n${jd.prerequisites.map(r => `- ${r}`).join('\n')}`,
      ].join('\n')

      const prompt = `Score this resume against the following job description. Respond ONLY with a valid JSON object — no markdown, no explanation, no code fences.

JOB DESCRIPTION:
${jdText}

RESUME:
${resumeText}

Return this exact JSON:
{"score":0,"breakdown":{"skills":0,"experience":0,"education":0},"strengths":[],"gaps":[],"summary":"","recommendation":"no"}

Where:
- score: 0-100 overall fit score
- breakdown.skills: 0-100 how well skills match
- breakdown.experience: 0-100 how well experience matches
- breakdown.education: 0-100 how well education matches
- strengths: array of 2-4 specific strengths from the resume
- gaps: array of 1-3 specific gaps or missing requirements
- summary: 1-2 sentence evaluation
- recommendation: "strong_yes" | "yes" | "maybe" | "no"`

      const raw = await callClaude(prompt, 'You are an expert technical recruiter. Evaluate resumes objectively. Return ONLY a JSON object with no surrounding text or markdown.', 1024)
      const cleaned = raw.replace(/```json|```/g, '').trim()
      const parsed: ScoreResult = JSON.parse(cleaned)
      setResult(parsed)
    } catch (err) {
      if (err instanceof SyntaxError) {
        toast.error('Failed to parse AI response — please try again')
      } else {
        toast.error(err instanceof Error ? err.message : 'Scoring failed')
      }
    } finally {
      setScoring(false)
    }
  }

  const handleSave = async () => {
    if (!result) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'candidates'), {
        name: candidateName.trim(),
        email: candidateEmail.trim() || null,
        phone: candidatePhone.trim() || null,
        jobDescriptionId: jd.id,
        jobTitle: jd.title,
        resumeText,
        score: result.score,
        breakdown: result.breakdown,
        summary: result.summary,
        strengths: result.strengths,
        gaps: result.gaps,
        recommendation: result.recommendation,
        createdBy: user?.id,
        createdByName: user?.name,
        createdAt: serverTimestamp(),
      })
      toast.success('Candidate saved!')
      onClose()
      setCandidateName(''); setCandidateEmail(''); setCandidatePhone(''); setResumeText(''); setResult(null)
    } catch {
      toast.error('Failed to save candidate')
    } finally {
      setSaving(false)
    }
  }

  const recfg = result ? RECOMMENDATION_CONFIG[result.recommendation] : null

  return (
    <Modal open={open} onClose={onClose} title={`Score Resume — ${jd.title}`} size="lg">
      <div className="space-y-5">
        {/* Candidate info */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input label="Candidate Name *" placeholder="Full name" value={candidateName} onChange={e => setCandidateName(e.target.value)} />
          <Input label="Email" placeholder="Optional" value={candidateEmail} onChange={e => setCandidateEmail(e.target.value)} />
          <Input label="Phone" placeholder="Optional" value={candidatePhone} onChange={e => setCandidatePhone(e.target.value)} />
        </div>

        {/* Resume input */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-gray-400">Resume Text *</label>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 text-xs text-gold-400 hover:text-gold-300 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload .txt
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".txt" className="hidden" onChange={handleFileUpload} />
          <textarea
            className="w-full h-48 bg-gray-900/80 border border-gray-700 rounded-xl p-3 text-sm text-gray-200 resize-y focus:outline-none focus:border-gold-400/50 focus:ring-1 focus:ring-gold-400/20 transition-colors placeholder:text-gray-600"
            placeholder="Paste the candidate's resume text here, or upload a .txt file above…"
            value={resumeText}
            onChange={e => setResumeText(e.target.value)}
          />
        </div>

        <Button
          onClick={scoreResume}
          loading={scoring}
          icon={<Sparkles className="w-4 h-4" />}
          disabled={!candidateName.trim() || !resumeText.trim()}
          className="w-full justify-center"
        >
          {scoring ? 'Analysing resume…' : 'Score Resume with AI'}
        </Button>

        {/* Results */}
        {result && (
          <div className="space-y-4 pt-1">
            <div className="h-px bg-gray-800" />

            {/* Score + recommendation */}
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <ScoreCircle score={result.score} />
              <div className="flex-1 space-y-3">
                {/* Recommendation badge */}
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-semibold ${recfg?.color} ${recfg?.bg}`}>
                  {recfg?.icon}
                  {recfg?.label}
                </div>
                <p className="text-sm text-gray-300 leading-relaxed">{result.summary}</p>
                {/* Breakdown bars */}
                <div className="space-y-2">
                  <BreakdownBar label="Skills Match" value={result.breakdown.skills} />
                  <BreakdownBar label="Experience Match" value={result.breakdown.experience} />
                  <BreakdownBar label="Education Match" value={result.breakdown.education} />
                </div>
              </div>
            </div>

            {/* Strengths & gaps */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl bg-green-900/20 border border-green-800/30 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  <p className="text-xs font-semibold text-green-400">Strengths</p>
                </div>
                <ul className="space-y-1.5">
                  {result.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                      <span className="text-green-500 mt-0.5 shrink-0">•</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl bg-red-900/20 border border-red-800/30 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertCircle className="w-4 h-4 text-red-400" />
                  <p className="text-xs font-semibold text-red-400">Gaps</p>
                </div>
                {result.gaps.length === 0 ? (
                  <p className="text-xs text-gray-500 italic">No significant gaps found</p>
                ) : (
                  <ul className="space-y-1.5">
                    {result.gaps.map((g, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                        <span className="text-red-500 mt-0.5 shrink-0">•</span>
                        {g}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={onClose} icon={<X className="w-4 h-4" />}>Discard</Button>
              <Button onClick={handleSave} loading={saving} icon={<User className="w-4 h-4" />}>Save Candidate</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
