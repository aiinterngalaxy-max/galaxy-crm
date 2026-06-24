import { useState, useEffect } from 'react'
import { Bell, CheckCheck, Trash2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, query, where, orderBy, getDocs, updateDoc, doc, deleteDoc } from '../../lib/firebase'
import { formatRelative } from '../../lib/utils'
import type { AppNotification, NotificationType } from '../../types'
import toast from 'react-hot-toast'

const TYPE_CONFIG: Record<NotificationType, { label: string; color: string; bg: string }> = {
  follow_up_due:      { label: 'Follow-up Due',      color: 'text-yellow-400',  bg: 'bg-yellow-900/30' },
  milestone_overdue:  { label: 'Milestone Overdue',  color: 'text-red-400',     bg: 'bg-red-900/30' },
  quotation_approval: { label: 'Approval Needed',    color: 'text-violet-400',  bg: 'bg-violet-900/30' },
  project_created:    { label: 'New Project',        color: 'text-indigo-400',  bg: 'bg-indigo-900/30' },
  payment_received:   { label: 'Payment',            color: 'text-green-400',   bg: 'bg-green-900/30' },
  invoice_overdue:    { label: 'Invoice Overdue',    color: 'text-red-400',     bg: 'bg-red-900/30' },
  site_issue:         { label: 'Site Issue',         color: 'text-orange-400',  bg: 'bg-orange-900/30' },
  lead_assigned:      { label: 'Lead Assigned',      color: 'text-blue-400',    bg: 'bg-blue-900/30' },
  report_reminder:    { label: 'Report Reminder',    color: 'text-gray-400',    bg: 'bg-gray-800' },
  digest_ready:       { label: 'AI Digest',          color: 'text-cyan-400',    bg: 'bg-cyan-900/30' },
  general:            { label: 'General',            color: 'text-gray-400',    bg: 'bg-gray-800' },
}

export function NotificationsPage() {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    getDocs(
      query(
        collection(db, 'notifications'),
        where('recipientId', '==', user.id),
        orderBy('createdAt', 'desc')
      )
    )
      .then(snap => setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() }) as AppNotification)))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [user])

  const markRead = async (notifId: string) => {
    try {
      await updateDoc(doc(db, 'notifications', notifId), { isRead: true })
      setNotifications(prev => prev.map(n => n.id === notifId ? { ...n, isRead: true } : n))
    } catch { /* silent */ }
  }

  const markAllRead = async () => {
    const unread = notifications.filter(n => !n.isRead)
    await Promise.all(unread.map(n => updateDoc(doc(db, 'notifications', n.id), { isRead: true })))
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
    toast.success('All marked as read')
  }

  const deleteNotif = async (notifId: string) => {
    await deleteDoc(doc(db, 'notifications', notifId))
    setNotifications(prev => prev.filter(n => n.id !== notifId))
  }

  const unreadCount = notifications.filter(n => !n.isRead).length

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Bell className="w-6 h-6" />
            Notifications
            {unreadCount > 0 && (
              <span className="text-sm bg-red-500 text-white px-2 py-0.5 rounded-full font-medium">
                {unreadCount} new
              </span>
            )}
          </h1>
        </div>
        {unreadCount > 0 && (
          <Button variant="secondary" size="sm" onClick={markAllRead} icon={<CheckCheck className="w-3.5 h-3.5" />}>
            Mark all read
          </Button>
        )}
      </div>

      <Card padding="none">
        {loading && <div className="p-8 text-center text-sm text-gray-600">Loading…</div>}
        {!loading && notifications.length === 0 && (
          <div className="py-12 text-center">
            <Bell className="w-8 h-8 text-gray-800 mx-auto mb-2" />
            <p className="text-sm text-gray-600">No notifications yet</p>
          </div>
        )}
        <div className="divide-y divide-gray-800">
          {notifications.map(notif => {
            const cfg = TYPE_CONFIG[notif.type] ?? TYPE_CONFIG.general
            return (
              <div
                key={notif.id}
                className={`flex items-start gap-3 px-5 py-4 transition-colors hover:bg-gray-800/30 ${!notif.isRead ? 'bg-indigo-950/20' : ''}`}
                onClick={() => !notif.isRead && markRead(notif.id)}
              >
                {!notif.isRead && (
                  <span className="w-2 h-2 bg-indigo-500 rounded-full shrink-0 mt-1.5" />
                )}
                {notif.isRead && <span className="w-2 h-2 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <Badge color={cfg.color} bg={cfg.bg}>{cfg.label}</Badge>
                    <span className="text-xs text-gray-600">{formatRelative(notif.createdAt)}</span>
                  </div>
                  <p className="text-sm font-medium text-gray-200">{notif.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{notif.body}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteNotif(notif.id) }}
                  className="text-gray-700 hover:text-red-400 transition-colors shrink-0 mt-0.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
