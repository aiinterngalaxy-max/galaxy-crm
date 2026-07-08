import { createContext, useContext, useState, useEffect } from 'react'

export type AppTheme = 'dark-classic' | 'dark-cosmos' | 'light-glass'

interface ThemeContextValue {
  theme: AppTheme
  setTheme: (t: AppTheme) => void
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'dark-cosmos', setTheme: () => {} })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(() =>
    (localStorage.getItem('galaxy-theme') as AppTheme) || 'dark-cosmos'
  )

  const setTheme = (t: AppTheme) => {
    setThemeState(t)
    localStorage.setItem('galaxy-theme', t)
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Apply on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
