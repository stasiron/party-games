import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { maybeRedirectToApGateway } from './lib/partyRedirect.js'
import { applyLowPowerClass } from './lib/lowPower.js'
import './styles/index.css'
import App from './app/App.jsx'
import { ServerBusyProvider } from './context/ServerBusyContext.jsx'

applyLowPowerClass()

if (!maybeRedirectToApGateway()) {
    createRoot(document.getElementById('root')).render(
        <StrictMode>
            <ServerBusyProvider>
                <App />
            </ServerBusyProvider>
        </StrictMode>,
    )
}
