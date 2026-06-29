import React from 'react'

interface State { hasError: boolean; error: Error | null }

const CHUNK_ERROR_RE = /failed to fetch dynamically imported module|loading chunk .* failed|chunkloaderror/i
const RELOAD_FLAG = 'chunk-reload-attempted'

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)

    // A stale build chunk (deployed since this tab loaded) 404s — reload once to pick up the new build
    // instead of showing the error screen. Guarded by sessionStorage so a real, persistent error doesn't loop.
    if (CHUNK_ERROR_RE.test(error.message) && !sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, '1')
      window.location.reload()
    }
  }

  clearFlagTimer: ReturnType<typeof setTimeout> | undefined

  componentDidMount() {
    // Only clear the flag after the app has stayed up without erroring for a while — if reloading
    // didn't actually fix the error, this lets the loop break instead of reloading forever.
    this.clearFlagTimer = setTimeout(() => sessionStorage.removeItem(RELOAD_FLAG), 10000)
  }

  componentWillUnmount() {
    clearTimeout(this.clearFlagTimer)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-950">
          <div className="text-center space-y-4 p-8 max-w-md">
            <div className="w-16 h-16 rounded-full bg-red-900/30 flex items-center justify-center mx-auto text-2xl">⚠</div>
            <h1 className="text-xl font-bold text-gray-200">Something went wrong</h1>
            <p className="text-sm text-gray-500 font-mono bg-gray-900 rounded-lg p-3 text-left break-all">
              {this.state.error?.message || 'Unknown error'}
            </p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = '/' }}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
