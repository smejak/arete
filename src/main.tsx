import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useStore } from './store/store'

import '@fontsource/schibsted-grotesk/400.css'
import '@fontsource/schibsted-grotesk/500.css'
import '@fontsource/schibsted-grotesk/600.css'
import '@fontsource/schibsted-grotesk/700.css'
import '@fontsource/literata/400.css'
import '@fontsource/literata/500.css'
import '@fontsource/literata/600.css'
import '@fontsource/literata/700.css'
import '@fontsource/literata/400-italic.css'
import '@fontsource/literata/500-italic.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import 'katex/dist/katex.min.css'

import './styles/base.css'
import './styles/sidebar.css'
import './styles/page.css'
import './styles/editor.css'
import './styles/menus.css'
import './styles/progress.css'
import './styles/audio.css'
import './styles/db.css'
import './styles/srs.css'

// Dev console access to the stores, e.g. arete.getState().movePage(...)
if (import.meta.env.DEV) {
  ;(window as unknown as { arete: typeof useStore }).arete = useStore
  import('./store/srs-store').then(m => {
    ;(window as unknown as { areteSrs: typeof m.useSrsStore }).areteSrs = m.useSrsStore
  })
  // The vault singletons too — bare dynamic imports from the console get a
  // second module instance once Vite has invalidated the graph, so this is
  // the only reliable way to drive the REAL vault from tests.
  import('./lib/vault').then(m => {
    ;(window as unknown as { areteVault: typeof m }).areteVault = m
  })
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
)
