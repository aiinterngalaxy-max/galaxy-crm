import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Briefcase, Users, Eye, Target,
  Star, AlertCircle, CheckCircle2, MinusCircle, XCircle, Download, Sparkles,
} from 'lucide-react'
import { callClaude } from '../../lib/ai'
import toast from 'react-hot-toast'
import { Button } from '../../components/ui/Button'
import { Card, StatCard } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { ResumeScorer } from './ResumeScorer'
import { downloadJDasPDF } from './downloadJD'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, query, orderBy, onSnapshot, limit } from '../../lib/firebase'
import { formatDate } from '../../lib/utils'
import type { JobDescription, Candidate, HireRecommendation } from '../../types'

const EMP_TYPE_LABELS: Record<string, string> = {
  full_time: 'Full-Time', part_time: 'Part-Time', internship: 'Internship', contract: 'Contract',
}

function formatEmpTypes(raw: string): string[] {
  return raw.split(',').map(t => EMP_TYPE_LABELS[t.trim()] || t.trim())
}
const EXP_LABELS: Record<string, string> = {
  fresher: 'Fresher', junior: 'Junior', mid: 'Mid-level', senior: 'Senior',
}

const REC_CONFIG: Record<HireRecommendation, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  strong_yes: { label: 'Strong Hire', color: 'text-green-400',   bg: 'bg-green-900/30',   icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  yes:        { label: 'Hire',        color: 'text-emerald-400', bg: 'bg-emerald-900/30', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  maybe:      { label: 'Maybe',       color: 'text-yellow-400',  bg: 'bg-yellow-900/30',  icon: <MinusCircle className="w-3.5 h-3.5" /> },
  no:         { label: 'Do Not Hire', color: 'text-red-400',     bg: 'bg-red-900/30',     icon: <XCircle className="w-3.5 h-3.5" /> },
}

function scoreColor(s: number) {
  if (s >= 75) return 'text-green-400'
  if (s >= 50) return 'text-yellow-400'
  if (s >= 30) return 'text-orange-400'
  return 'text-red-400'
}

export function HRPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [tab, setTab] = useState<'jds' | 'candidates'>('jds')
  const [jds, setJDs] = useState<JobDescription[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loadingJDs, setLoadingJDs] = useState(true)
  const [loadingCandidates, setLoadingCandidates] = useState(true)
  const [viewingJD, setViewingJD] = useState<JobDescription | null>(null)
  const [scoringJD, setScoringJD] = useState<JobDescription | null>(null)
  const [viewingCandidate, setViewingCandidate] = useState<Candidate | null>(null)
  const [jdFilter, setJdFilter] = useState<string>('all')
  const [explaining, setExplaining] = useState(false)
  const [liveReasoning, setLiveReasoning] = useState<{ skills: string; experience: string; education: string } | null>(null)

  // Auto-generate reasoning when opening a candidate that doesn't have it stored
  useEffect(() => {
    if (viewingCandidate && !viewingCandidate.breakdownReasoning) {
      generateReasoning(viewingCandidate)
    } else {
      setLiveReasoning(null)
    }
  }, [viewingCandidate?.id])

  const generateReasoning = async (c: Candidate) => {
    setExplaining(true)
    setLiveReasoning(null)
    try {
      const prompt = `A candidate named ${c.name} was scored for the role "${c.jobTitle}".
Scores: Skills ${c.breakdown.skills}/100, Experience ${c.breakdown.experience}/100, Education ${c.breakdown.education}/100.
Summary: ${c.summary}
Strengths: ${c.strengths.join(', ')}
Gaps: ${c.gaps.join(', ')}

Write exactly 3 one-sentence explanations (one per dimension) for why each score was given.
Respond ONLY with valid JSON — no markdown, no code fences:
{"skills":"...","experience":"...","education":"..."}`

      const raw = await callClaude(prompt, 'You are an expert recruiter. Return ONLY a JSON object, no surrounding text.', 512)
      const cleaned = raw.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(cleaned)
      setLiveReasoning(parsed)
    } catch {
      toast.error('Could not generate explanation')
    } finally {
      setExplaining(false)
    }
  }

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'jobDescriptions'), orderBy('createdAt', 'desc'), limit(50)),
      snap => {
        setJDs(snap.docs.map(d => ({ id: d.id, ...d.data() }) as JobDescription))
        setLoadingJDs(false)
      },
      () => setLoadingJDs(false)
    )
    return unsub
  }, [])

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'candidates'), orderBy('createdAt', 'desc'), limit(100)),
      snap => {
        setCandidates(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Candidate))
        setLoadingCandidates(false)
      },
      () => setLoadingCandidates(false)
    )
    return unsub
  }, [])

  const totalHires = candidates.filter(c => c.recommendation === 'strong_yes' || c.recommendation === 'yes').length
  const avgScore = candidates.length ? Math.round(candidates.reduce((s, c) => s + c.score, 0) / candidates.length) : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">HR Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">{jds.length} job descriptions · {candidates.length} candidates scored</p>
        </div>
        <Button data-tour="new-jd-btn" onClick={() => navigate('/hr/new')} icon={<Plus className="w-4 h-4" />}>
          New Job Description
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Open JDs" value={jds.length} icon={<Briefcase className="w-5 h-5 text-gold-400" />} iconBg="bg-gold-400/10" />
        <StatCard label="Candidates Scored" value={candidates.length} icon={<Users className="w-5 h-5 text-blue-400" />} iconBg="bg-blue-500/20" />
        <StatCard label="Recommended Hires" value={totalHires} icon={<CheckCircle2 className="w-5 h-5 text-green-400" />} iconBg="bg-green-500/20" />
        <StatCard label="Avg. Resume Score" value={candidates.length ? `${avgScore}/100` : '—'} icon={<Star className="w-5 h-5 text-yellow-400" />} iconBg="bg-yellow-500/20" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900/60 rounded-lg p-1 w-fit">
        {[
          { key: 'jds', label: 'Job Descriptions', count: jds.length },
          { key: 'candidates', label: 'Candidates', count: candidates.length },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as 'jds' | 'candidates')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
              tab === t.key ? 'bg-gray-800 text-gray-100 shadow-sm' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`text-xs rounded-full px-1.5 py-0.5 font-bold ${tab === t.key ? 'bg-gold-400/20 text-gold-400' : 'bg-gray-800 text-gray-500'}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Job Descriptions tab */}
      {tab === 'jds' && (
        <div>
          {loadingJDs && <div className="text-center text-sm text-gray-600 py-10">Loading…</div>}
          {!loadingJDs && jds.length === 0 && (
            <EmptyState
              icon={<Briefcase className="w-6 h-6" />}
              title="No job descriptions yet"
              description="Create your first JD — AI will help you write it in minutes"
              action={{ label: 'New Job Description', onClick: () => navigate('/hr/new'), icon: <Plus className="w-4 h-4" /> }}
            />
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {jds.map(jd => {
              const jdCandidates = candidates.filter(c => c.jobDescriptionId === jd.id)
              const topScore = jdCandidates.length ? Math.max(...jdCandidates.map(c => c.score)) : null
              return (
                <div key={jd.id} className="glass-card p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-100 truncate">{jd.title}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">{jd.department}</p>
                    </div>
                    <div className="flex gap-1.5 shrink-0 flex-wrap">
                      {formatEmpTypes(jd.employmentType).map(t => (
                        <Badge key={t} color="text-blue-400" bg="bg-blue-900/30">{t}</Badge>
                      ))}
                      <Badge color="text-violet-400" bg="bg-violet-900/30">{EXP_LABELS[jd.experienceLevel] || jd.experienceLevel}</Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-center border-t border-gray-800 pt-3">
                    <div>
                      <p className="text-lg font-bold text-gray-100">{jdCandidates.length}</p>
                      <p className="text-xs text-gray-500">Scored</p>
                    </div>
                    <div>
                      <p className={`text-lg font-bold ${topScore !== null ? scoreColor(topScore) : 'text-gray-600'}`}>
                        {topScore !== null ? topScore : '—'}
                      </p>
                      <p className="text-xs text-gray-500">Top Score</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mt-1">{formatDate(jd.createdAt)}</p>
                      <p className="text-xs text-gray-600">Created</p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setViewingJD(jd)} icon={<Eye className="w-3.5 h-3.5" />} className="flex-1 justify-center">
                      View JD
                    </Button>
                    <Button size="sm" onClick={() => setScoringJD(jd)} icon={<Target className="w-3.5 h-3.5" />} className="flex-1 justify-center">
                      Score Resume
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Candidates tab */}
      {tab === 'candidates' && (
        <Card padding="none">
          {/* JD Filter */}
          {!loadingCandidates && candidates.length > 0 && (
            <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-800">
              <span className="text-xs text-gray-500 shrink-0">Filter by JD:</span>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setJdFilter('all')}
                  className={`text-xs px-3 py-1 rounded-full transition-all ${jdFilter === 'all' ? 'bg-gold-400/20 text-gold-400 font-semibold' : 'text-gray-500 hover:text-gray-300 bg-gray-800/50'}`}
                >
                  All ({candidates.length})
                </button>
                {jds.filter(jd => candidates.some(c => c.jobDescriptionId === jd.id)).map(jd => {
                  const count = candidates.filter(c => c.jobDescriptionId === jd.id).length
                  return (
                    <button
                      key={jd.id}
                      onClick={() => setJdFilter(jd.id)}
                      className={`text-xs px-3 py-1 rounded-full transition-all ${jdFilter === jd.id ? 'bg-gold-400/20 text-gold-400 font-semibold' : 'text-gray-500 hover:text-gray-300 bg-gray-800/50'}`}
                    >
                      {jd.title} ({count})
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {loadingCandidates && <div className="text-center text-sm text-gray-600 py-10">Loading…</div>}
          {!loadingCandidates && candidates.length === 0 && (
            <EmptyState
              icon={<Users className="w-6 h-6" />}
              title="No candidates scored yet"
              description="Open a Job Description and click 'Score Resume' to evaluate candidates"
            />
          )}
          {!loadingCandidates && candidates.length > 0 && (() => {
            const filtered = jdFilter === 'all' ? candidates : candidates.filter(c => c.jobDescriptionId === jdFilter)
            return (
            <div className="divide-y divide-gray-800">
              {filtered.length === 0 && (
                <div className="text-center text-sm text-gray-600 py-10">No candidates for this JD yet</div>
              )}
              {filtered.map(c => {
                const rec = REC_CONFIG[c.recommendation]
                return (
                  <div key={c.id} onClick={() => setViewingCandidate(c)} className="flex items-center gap-4 px-5 py-4 hover:bg-gray-800/30 transition-colors cursor-pointer">
                    <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center shrink-0 text-sm font-bold text-gray-300">
                      {c.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-200">{c.name}</p>
                      <p className="text-xs text-gray-500">{c.jobTitle}{c.email ? ` · ${c.email}` : ''}</p>
                    </div>
                    <div className="text-center shrink-0">
                      <p className={`text-lg font-bold ${scoreColor(c.score)}`}>{c.score}</p>
                      <p className="text-xs text-gray-600">score</p>
                    </div>
                    <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium shrink-0 ${rec.color} ${rec.bg}`}>
                      {rec.icon}
                      {rec.label}
                    </div>
                    <p className="text-xs text-gray-600 shrink-0 hidden md:block">{formatDate(c.createdAt)}</p>
                  </div>
                )
              })}
            </div>
            )
          })()}
        </Card>
      )}

      {/* View JD modal */}
      <Modal open={!!viewingJD} onClose={() => setViewingJD(null)} title={viewingJD?.title || ''} size="lg">
        {viewingJD && (
          <div className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              {formatEmpTypes(viewingJD.employmentType).map(t => (
                <Badge key={t} color="text-blue-400" bg="bg-blue-900/30">{t}</Badge>
              ))}
              <Badge color="text-violet-400" bg="bg-violet-900/30">{EXP_LABELS[viewingJD.experienceLevel]}</Badge>
              <Badge color="text-gray-400" bg="bg-gray-800">{viewingJD.department}</Badge>
            </div>
            <div className="prose-sm prose-invert max-w-none bg-gray-900/50 rounded-xl p-5 max-h-[60vh] overflow-y-auto">
              <pre className="whitespace-pre-wrap text-sm text-gray-300 font-sans leading-relaxed">{viewingJD.rawJD}</pre>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setViewingJD(null)}>Close</Button>
              <Button variant="secondary" onClick={() => downloadJDasPDF(viewingJD)} icon={<Download className="w-4 h-4" />}>
                Download PDF
              </Button>
              <Button onClick={() => { setViewingJD(null); setScoringJD(viewingJD) }} icon={<Target className="w-4 h-4" />}>
                Score a Resume
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Candidate detail modal */}
      {viewingCandidate && (() => {
        const c = viewingCandidate
        const rec = REC_CONFIG[c.recommendation]
        return (
          <Modal open={!!viewingCandidate} onClose={() => { setViewingCandidate(null); setLiveReasoning(null) }} title={c.name} size="lg">
            <div className="space-y-5">
              {/* Meta */}
              <div className="flex flex-wrap gap-2 text-xs text-gray-400">
                {c.email && <span>{c.email}</span>}
                {c.phone && <span>· {c.phone}</span>}
                <span className="text-gray-600">· Applied for: <span className="text-gray-400">{c.jobTitle}</span></span>
                <span className="text-gray-600">· Scored on: <span className="text-gray-400">{formatDate(c.createdAt)}</span></span>
              </div>

              {/* Score + recommendation */}
              <div className="flex flex-col sm:flex-row items-center gap-6 bg-gray-900/50 rounded-xl p-5">
                {/* Circle */}
                {(() => {
                  const radius = 44
                  const circumference = 2 * Math.PI * radius
                  const offset = circumference - (c.score / 100) * circumference
                  const color = c.score >= 75 ? '#4ade80' : c.score >= 50 ? '#facc15' : c.score >= 30 ? '#fb923c' : '#f87171'
                  return (
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      <svg width="110" height="110" viewBox="0 0 110 110">
                        <circle cx="55" cy="55" r={radius} fill="none" stroke="#1f2937" strokeWidth="8" />
                        <circle cx="55" cy="55" r={radius} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
                          strokeDasharray={circumference} strokeDashoffset={offset} transform="rotate(-90 55 55)"
                          style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
                        <text x="55" y="58" textAnchor="middle" fill={color} fontSize="22" fontWeight="bold">{c.score}</text>
                        <text x="55" y="72" textAnchor="middle" fill="#6b7280" fontSize="10">/100</text>
                      </svg>
                      <p className="text-xs text-gray-500 font-medium">Overall Score</p>
                    </div>
                  )
                })()}
                <div className="flex-1 space-y-3 w-full">
                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-semibold ${rec.color} ${rec.bg}`}>
                    {rec.icon}{rec.label}
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed">{c.summary}</p>
                  {/* Breakdown bars with reasoning */}
                  {(() => {
                    const reasoning = liveReasoning ?? c.breakdownReasoning ?? null
                    const hasReasoning = !!reasoning
                    const dims = [
                      { label: 'Skills Match', value: c.breakdown.skills, key: 'skills' as const },
                      { label: 'Experience Match', value: c.breakdown.experience, key: 'experience' as const },
                      { label: 'Education Match', value: c.breakdown.education, key: 'education' as const },
                    ]
                    return (
                      <div className="space-y-3">
                        {dims.map(({ label, value, key }) => {
                          const barColor = value >= 75 ? 'bg-green-500' : value >= 50 ? 'bg-yellow-500' : value >= 30 ? 'bg-orange-500' : 'bg-red-500'
                          return (
                            <div key={label}>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-gray-400">{label}</span>
                                <span className="text-gray-300 font-medium">{value}/100</span>
                              </div>
                              <div className="h-2 bg-gray-800 rounded-full overflow-hidden mb-1">
                                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${value}%` }} />
                              </div>
                              {hasReasoning && reasoning[key] && (
                                <p className="text-xs text-gray-500 italic leading-relaxed">{reasoning[key]}</p>
                              )}
                            </div>
                          )
                        })}
                        {!hasReasoning && explaining && (
                          <p className="flex items-center gap-1.5 text-xs text-gray-500 italic mt-1">
                            <Sparkles className="w-3 h-3 text-gold-400 animate-pulse" />
                            Generating score explanations…
                          </p>
                        )}
                      </div>
                    )
                  })()}
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
                    {c.strengths.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                        <span className="text-green-500 mt-0.5 shrink-0">•</span>{s}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl bg-red-900/20 border border-red-800/30 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertCircle className="w-4 h-4 text-red-400" />
                    <p className="text-xs font-semibold text-red-400">Gaps</p>
                  </div>
                  {c.gaps.length === 0
                    ? <p className="text-xs text-gray-500 italic">No significant gaps found</p>
                    : <ul className="space-y-1.5">
                        {c.gaps.map((g, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                            <span className="text-red-500 mt-0.5 shrink-0">•</span>{g}
                          </li>
                        ))}
                      </ul>
                  }
                </div>
              </div>

              {/* Resume text */}
              {c.resumeText && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 mb-2">Resume</p>
                  <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 max-h-64 overflow-y-auto">
                    <pre className="text-xs text-gray-400 whitespace-pre-wrap font-sans leading-relaxed">{c.resumeText}</pre>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button onClick={() => setViewingCandidate(null)} className="text-sm text-gray-400 hover:text-gray-200 transition-colors">Close</button>
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* Resume scorer modal */}
      {scoringJD && (
        <ResumeScorer
          open={!!scoringJD}
          onClose={() => setScoringJD(null)}
          jd={scoringJD}
        />
      )}
    </div>
  )
}
