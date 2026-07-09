import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { maybeRedirectToApGateway } from './lib/partyRedirect.js'
import { applyLowPowerClass, subscribeLowPowerUpdates } from './lib/lowPower.js'
import { PWA_ENABLED } from './lib/pwa.js'
import './styles/index.css'
import App from './app/App.jsx'
import { ServerBusyProvider } from './context/ServerBusyContext.jsx'
import { LocaleProvider } from './locales/LocaleContext.jsx'

const CmsApp = lazy(() => import('./cms/CmsApp.jsx'))

if (PWA_ENABLED) {
    import('virtual:pwa-register')
        .then(({ registerSW }) => registerSW({ immediate: true }))
        .catch(() => {})
}

function setAppIcons(href) {
    if (typeof document === 'undefined') return
    for (const rel of ['icon', 'apple-touch-icon']) {
        let link = document.querySelector(`link[rel="${rel}"]`)
        if (!link) {
            link = document.createElement('link')
            link.rel = rel
            document.head.appendChild(link)
        }
        link.type = 'image/svg+xml'
        link.href = href
    }
}

setAppIcons('/pwa-icon.svg')
applyLowPowerClass()
subscribeLowPowerUpdates()

function resolveRootComponent() {
    if (typeof window === 'undefined') return App
    const path = window.location.pathname.replace(/\/+$/, '') || '/'
    return path === '/cms' ? CmsApp : App
}

const RootComponent = resolveRootComponent()

if (!maybeRedirectToApGateway()) {
    createRoot(document.getElementById('root')).render(
        <StrictMode>
            <ServerBusyProvider>
                <LocaleProvider>
                    <Suspense fallback={null}>
                        <RootComponent />
                    </Suspense>
                </LocaleProvider>
            </ServerBusyProvider>
        </StrictMode>,
    )
}
