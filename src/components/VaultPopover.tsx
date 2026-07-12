import { useState } from 'react'
import { FolderOpen, HardDrive, RefreshCw } from 'lucide-react'
import { reconnectVault, switchVault, useVault } from '../lib/vault'
import { fmtRelative } from '../lib/util'
import { cx } from '../lib/util'
import { Popover } from './Popover'

const prettyPath = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

export function VaultButton() {
  const vault = useVault()
  const [at, setAt] = useState<DOMRect | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<string | null | void>) => {
    setBusy(true)
    setMsg(null)
    try {
      const result = await fn()
      if (typeof result === 'string') setMsg(result)
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') {
        setMsg(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setBusy(false)
    }
  }

  // Seamless: a successful switch just lands in the new workspace.
  const doSwitch = () =>
    run(async () => {
      if (await switchVault()) setAt(null)
    })

  return (
    <>
      <button
        type="button"
        className="icon-btn vault-btn"
        title={vault.connected ? `Vault: ${vault.name}` : 'Vault'}
        onClick={e => setAt(e.currentTarget.getBoundingClientRect())}
      >
        <HardDrive size={15} strokeWidth={1.7} />
        {(vault.connected || vault.state === 'permission') && (
          <span className={cx('vault-dot', vault.state === 'permission' && 'is-warn')} />
        )}
      </button>

      {at && (
        <Popover anchor={at} onClose={() => setAt(null)} className="vault-pop">
          <div className="pop-head">
            <span className="pop-title">Vault</span>
            {vault.connected && (
              <span className="vault-status">
                {vault.state === 'syncing'
                  ? 'syncing…'
                  : vault.state === 'error'
                    ? 'sync error'
                    : vault.lastSync
                      ? 'synced ' + fmtRelative(vault.lastSync)
                      : 'connected'}
              </span>
            )}
          </div>

          {!vault.supported ? (
            <div className="vault-note">
              This browser can’t open folders — use Chrome, Edge, or the Arete desktop app.
            </div>
          ) : vault.connected ? (
            <>
              <div className="vault-name">
                <FolderOpen size={14} strokeWidth={1.8} />
                {vault.name}
              </div>
              {vault.path && <div className="vault-path">{prettyPath(vault.path)}</div>}
              <div className="vault-note">
                Pages as markdown in this folder; cards &amp; history in <code>.arete/</code>.
              </div>
              <div className="vault-actions">
                <button type="button" className="btn" disabled={busy} onClick={doSwitch}>
                  <FolderOpen size={13} strokeWidth={1.9} /> Switch folder…
                </button>
              </div>
            </>
          ) : vault.state === 'permission' ? (
            <>
              <div className="vault-name">
                <FolderOpen size={14} strokeWidth={1.8} />
                {vault.name}
              </div>
              <div className="vault-note">The browser needs a fresh grant to reopen this folder.</div>
              <div className="vault-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => ((await reconnectVault()) ? null : 'Permission was not granted.'))
                  }
                >
                  <RefreshCw size={13} strokeWidth={1.9} /> Reconnect
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="vault-note">
                Pick the folder this workspace lives in — pages as markdown, cards &amp; history in{' '}
                <code>.arete/</code>.
              </div>
              <div className="vault-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={doSwitch}
                >
                  <FolderOpen size={13} strokeWidth={1.9} /> Choose folder…
                </button>
              </div>
            </>
          )}

          {msg && <div className="vault-msg">{msg}</div>}
          {vault.state === 'error' && vault.error && <div className="vault-msg">{vault.error}</div>}
        </Popover>
      )}
    </>
  )
}
