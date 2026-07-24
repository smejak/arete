import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/**
 * Catches render/commit-time crashes — a localStorage quota write failing
 * mid-commit was blanking the ENTIRE app to a dark screen that only an app
 * restart could clear. The vault folder is the durable copy, so instead of
 * unmounting the tree React shows a recoverable message and a reload re-reads
 * the folder cleanly.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Arete crashed:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const quota = error.name === 'QuotaExceededError' || /quota/i.test(error.message)
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
          background: 'var(--bg, #16181a)',
          color: 'var(--text, #e7e7e7)',
          font: '15px/1.55 var(--font-sans, system-ui, sans-serif)',
          zIndex: 9999,
        }}
      >
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 600, margin: '0 0 .6rem' }}>
            Something went wrong
          </h1>
          <p style={{ margin: '0 0 1.25rem', color: 'var(--text-dim, #9aa0a6)' }}>
            {quota
              ? 'Local storage is full, so Arete could not save its cache. Your notes are safe in the vault folder on disk — reload to continue.'
              : 'Arete hit an unexpected error. Your notes are safe in the vault folder on disk — reload to continue.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '.5rem 1.1rem',
              borderRadius: 8,
              border: '1px solid var(--border, #333)',
              background: 'var(--accent, #4f8cff)',
              color: '#fff',
              fontSize: '.9rem',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          <pre
            style={{
              marginTop: '1.5rem',
              padding: '.6rem .8rem',
              maxHeight: 160,
              overflow: 'auto',
              textAlign: 'left',
              fontSize: '12px',
              color: 'var(--text-dim, #8b9096)',
              background: 'var(--bg-soft, rgba(255,255,255,.04))',
              borderRadius: 6,
              whiteSpace: 'pre-wrap',
            }}
          >
            {error.message}
          </pre>
        </div>
      </div>
    )
  }
}
