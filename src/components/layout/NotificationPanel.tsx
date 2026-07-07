import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Clock, AlertCircle, ChevronRight, CheckCheck } from 'lucide-react'
import { db, collection, query, where, orderBy, getDocs, onSnapshot, updateDoc, doc } from '../../lib/firebase'
import { useAuth } from '../../contexts/AuthContext'
import type { Lead } from '../../types'
import type { AppNotification } from '../../types'

function toMs(ts: any): number {
  const d: Date = ts?.toDate ? ts.toDate() : new Date(ts)
  return d.getTime()
}

function formatTime(ts: any): string {
  const d: Date = ts?.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function formatDate(ts: any): string {
  const d: Date = ts?.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function NotificationPanel() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [overdue, setOverdue] = useState<Lead[]>([])
  const [todayFollowUps, setTodayFollowUps] = useState<Lead[]>([])
  const [appNotifs, setAppNotifs] = useState<AppNotification[]>([])
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Fetch follow-ups
  useEffect(() => {
    if (!user) return
    getDocs(query(collection(db, 'leads'), where('nextFollowUp', '!=', null), orderBy('nextFollowUp')))
      .then(snap => {
        const now = new Date()
        const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999)
        const leads = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead)
          .filter(l => !['won', 'lost'].includes(l.status))

        setOverdue(leads.filter(l => toMs(l.nextFollowUp) < now.getTime()))
        setTodayFollowUps(leads.filter(l => {
          const ms = toMs(l.nextFollowUp)
          return ms >= now.getTime() && ms <= todayEnd.getTime()
        }))
      })
      .catch(() => {})
  }, [user, open]) // refetch when panel opens

  // App notifications from Firestore
  useEffect(() => {
    if (!user) return
    const unsub = onSnapshot(
      query(collection(db, 'notifications'), where('recipientId', '==', user.id), orderBy('createdAt', 'desc')),
      snap => setAppNotifs(snap.docs.slice(0, 10).map(d => ({ id: d.id, ...d.data() }) as AppNotification)),
      () => {}
    )
    return unsub
  }, [user])

  const unreadAppNotifs = appNotifs.filter(n => !n.isRead)
  const totalCount = overdue.length + unreadAppNotifs.length

  async function markAllRead() {
    await Promise.all(
      unreadAppNotifs.map(n => updateDoc(doc(db, 'notifications', n.id), { isRead: true }))
    )
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(o => !o)}
        data-tour="notif-bell"
        className="relative text-gray-500 hover:text-gray-300 transition-colors p-1"
      >
        <Bell className="w-4 h-4" />
        {totalCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold leading-none">
            {totalCount > 9 ? '9+' : totalCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-8 w-80 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <span className="text-sm font-semibold text-gray-100">Notifications</span>
            {unreadAppNotifs.length > 0 && (
              <button onClick={markAllRead} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
                <CheckCheck className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto divide-y divide-gray-800">
            {/* Overdue follow-ups */}
            {overdue.length > 0 && (
              <div>
                <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-red-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Overdue Follow-ups ({overdue.length})
                </p>
                {overdue.map(lead => (
                  <button
                    key={lead.id}
                    onClick={() => { navigate(`/leads/${lead.id}`); setOpen(false) }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] text-left transition-colors"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-200 truncate font-medium">{lead.name}</p>
                      <p className="text-xs text-red-400">{formatDate(lead.nextFollowUp)} · {formatTime(lead.nextFollowUp)}</p>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                  </button>
                ))}
              </div>
            )}

            {/* Today's follow-ups */}
            {todayFollowUps.length > 0 && (
              <div>
                <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-yellow-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Today's Follow-ups ({todayFollowUps.length})
                </p>
                {todayFollowUps.map(lead => (
                  <button
                    key={lead.id}
                    onClick={() => { navigate(`/leads/${lead.id}`); setOpen(false) }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] text-left transition-colors"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-200 truncate font-medium">{lead.name}</p>
                      <p className="text-xs text-yellow-500">{formatTime(lead.nextFollowUp)}</p>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                  </button>
                ))}
              </div>
            )}

            {/* App notifications */}
            {appNotifs.length > 0 && (
              <div>
                <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  Other Notifications
                </p>
                {appNotifs.map(n => (
                  <div
                    key={n.id}
                    className={`px-4 py-2.5 text-sm ${!n.isRead ? 'bg-indigo-950/30' : ''}`}
                  >
                    <p className="text-gray-300 truncate">{n.title}</p>
                    {n.body && <p className="text-xs text-gray-500 truncate">{n.body}</p>}
                    <p className="text-xs text-gray-600 mt-0.5">
                      {n.createdAt ? new Date((n.createdAt as any)?.toDate?.() ?? n.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {overdue.length === 0 && todayFollowUps.length === 0 && appNotifs.length === 0 && (
              <div className="px-4 py-8 text-center">
                <Bell className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No notifications</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-800 px-4 py-2.5">
            <button
              onClick={() => { navigate('/follow-ups'); setOpen(false) }}
              className="text-xs text-indigo-400 hover:text-indigo-300 w-full text-center"
            >
              View all follow-ups →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
