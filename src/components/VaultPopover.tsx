import { useState } from 'react'
import { Download, FolderOpen, HardDrive, RefreshCw, Unplug } from 'lucide-react'
import {
  createVaultFromWorkspace,
  disconnectVault,
  importNotionExport,
  openVault,
  reconnectVault,
  useVault,
} from '../lib/vault'
import { fmtRelative } from '../lib/util'
import { cx } from '../lib/util'
import { Popover } from './Popover'

export function VaultButton() {
  const vault = useVault()
  const [at, setAt] = useState<DOMRect | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [armedOpen, setArmedOpen] = useState(false)
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
      setArmedOpen(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="icon-btn vault-btn"
        title={vault.connected ? `Vault: ${vault.name}` : 'Vault — keep pages as local markdown'}
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
              Folder vaults need Chrome, Edge, or the Arete desktop app — this browser has no way
              to open folders.
            </div>
          ) : vault.connected ? (
            <>
              <div className="vault-name">
                <FolderOpen size={14} strokeWidth={1.8} />
                {vault.name}
              </div>
              <div className="vault-note">
                Pages live in this folder as markdown; cards, reviews, and history in{' '}
                <code>.arete/</code>. Edits made outside Arete are read on the next launch.
              </div>
              <div className="vault-actions">
                <button type="button" className="btn" disabled={busy} onClick={() => run(importNotionAction)}>
                  <Download size={13} strokeWidth={1.9} /> Import from Notion…
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => run(disconnectVault)}>
                  <Unplug size={13} strokeWidth={1.9} /> Disconnect
                </button>
              </div>
            </>
          ) : vault.state === 'permission' ? (
            <>
              <div className="vault-note">
                “{vault.name}” is remembered but the browser needs a fresh permission grant.
              </div>
              <div className="vault-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => ((await reconnectVault()) ? null : 'Permission was not granted.'))
                  }
                >
                  <RefreshCw size={13} strokeWidth={1.9} /> Reconnect vault
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => run(disconnectVault)}>
                  Forget
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="vault-note">
                Keep everything as plain files in a folder you choose — pages as markdown,
                cards and history in a hidden <code>.arete/</code> subfolder. Data never leaves
                this machine.
              </div>
              <div className="vault-actions vault-actions-col">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => run(createVaultFromWorkspace)}
                >
                  <FolderOpen size={13} strokeWidth={1.9} /> Create vault from this workspace…
                </button>
                <button
                  type="button"
                  className={cx('btn', armedOpen && 'btn-danger')}
                  disabled={busy}
                  onClick={() => {
                    if (!armedOpen) {
                      setArmedOpen(true)
                      setMsg('Opening a vault replaces the current workspace — click again to continue.')
                      return
                    }
                    void run(openVault)
                  }}
                >
                  <FolderOpen size={13} strokeWidth={1.9} />
                  {armedOpen ? 'Yes, open and replace' : 'Open existing vault…'}
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => run(importNotionAction)}>
                  <Download size={13} strokeWidth={1.9} /> Import from Notion…
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

async function importNotionAction(): Promise<string | null> {
  const result = await importNotionExport()
  if (result === null) return null // picker cancelled
  if ('error' in result) return result.error
  return `Imported ${result.pages} page${result.pages === 1 ? '' : 's'} — see “Notion import” in the sidebar.`
}
