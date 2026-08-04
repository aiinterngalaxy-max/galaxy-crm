import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * A back button that actually goes *back*.
 *
 * `navigate('/customers')` pushes a brand-new history entry, so the list is
 * rebuilt from scratch — scroll position gone (see `useScrollRestoration`), and
 * the history stack grows every time you bounce in and out of a record. Popping
 * returns to the exact entry the user came from instead.
 *
 * `location.key` is `'default'` only on the first entry of the session — i.e.
 * the user deep-linked straight to this page and there's nothing to pop back to,
 * so we fall back to the given path.
 */
export function useGoBack(fallback: string) {
  const navigate = useNavigate()
  const { key } = useLocation()

  return useCallback(() => {
    if (key !== 'default') navigate(-1)
    else navigate(fallback, { replace: true })
  }, [navigate, key, fallback])
}
