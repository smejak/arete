import { isTauriEnv } from './fs-adapter'

/** Open a URL outside the app: system browser on desktop, new tab on web. */
export function openExternal(url: string): void {
  const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url
  if (isTauriEnv()) {
    void import('@tauri-apps/plugin-opener')
      .then(m => m.openUrl(href))
      .catch(() => window.open(href, '_blank', 'noopener'))
    return
  }
  window.open(href, '_blank', 'noopener')
}
