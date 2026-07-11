import { createRoot } from 'react-dom/client'
import App from './App'
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
import './styles/db.css'
import './styles/srs.css'

// Dev console access to the stores, e.g. arete.getState().movePage(...)
if (import.meta.env.DEV) {
  ;(window as unknown as { arete: typeof useStore }).arete = useStore
  import('./store/srs-store').then(m => {
    ;(window as unknown as { areteSrs: typeof m.useSrsStore }).areteSrs = m.useSrsStore
  })
}

createRoot(document.getElementById('root')!).render(<App />)
