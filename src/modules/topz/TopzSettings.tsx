import { Monitor, Sun } from 'lucide-react'

const TOPZ_THEME_KEY = 'topz-ui-theme'

export function getTopzTheme(): 'dark' | 'light' {
  return (localStorage.getItem(TOPZ_THEME_KEY) as 'dark' | 'light') ?? 'dark'
}

export function setTopzTheme(t: 'dark' | 'light') {
  localStorage.setItem(TOPZ_THEME_KEY, t)
  window.dispatchEvent(new Event('topz-theme-change'))
}

const OPTIONS = [
  {
    key: 'dark' as const,
    label: 'Dark Pro',
    desc: 'Dark glass interface — elegant and easy on the eyes at night.',
    icon: <Monitor className="w-6 h-6" />,
    preview: { bg: '#0d0d1a', sidebar: '#13131f', accent: '#f0c040' },
  },
  {
    key: 'light' as const,
    label: 'Light Clean',
    desc: 'Bright white interface — crisp and professional for daytime use.',
    icon: <Sun className="w-6 h-6" />,
    preview: { bg: '#f5f5f7', sidebar: '#ffffff', accent: '#c8960a' },
  },
]

export function TopzSettings() {
  const current = getTopzTheme()

  function handleSelect(key: 'dark' | 'light') {
    setTopzTheme(key)
    // force re-render without full reload
    window.location.reload()
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-base)' }}>Settings</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Topz Cab dashboard preferences</p>
      </div>

      <div>
        <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text-base)' }}>UI Theme</p>
        <div className="grid grid-cols-2 gap-4">
          {OPTIONS.map(opt => {
            const isActive = current === opt.key
            return (
              <button
                key={opt.key}
                onClick={() => handleSelect(opt.key)}
                className="rounded-2xl p-5 text-left transition-all hover:scale-[1.02]"
                style={{
                  background: isActive ? 'rgba(240,192,64,0.10)' : 'var(--glass-bg)',
                  border: `1.5px solid ${isActive ? 'rgba(240,192,64,0.5)' : 'var(--glass-border)'}`,
                }}
              >
                {/* Mini preview */}
                <div className="rounded-xl overflow-hidden mb-4 flex h-16" style={{ background: opt.preview.bg, border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="w-10 h-full shrink-0" style={{ background: opt.preview.sidebar }} />
                  <div className="flex-1 p-2 flex flex-col justify-end gap-1">
                    <div className="h-1.5 rounded-full w-3/4" style={{ background: opt.preview.accent, opacity: 0.8 }} />
                    <div className="h-1 rounded-full w-1/2" style={{ background: 'rgba(255,255,255,0.15)' }} />
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-1">
                  <span style={{ color: isActive ? '#f0c040' : 'var(--text-muted)' }}>{opt.icon}</span>
                  <span className="font-bold text-sm" style={{ color: 'var(--text-base)' }}>{opt.label}</span>
                  {isActive && (
                    <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(240,192,64,0.15)', color: '#f0c040' }}>Active</span>
                  )}
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{opt.desc}</p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
