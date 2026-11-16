import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './App.css'
import App from './App.jsx'
import { NavigationProvider } from './context/ImprovedNavigationProvider'
import { TenantProvider } from './context/TenantContext'
import { restoreStandaloneScope } from './utils/tenantNavigation'
import { track } from './services/analytics'

// data-track="event_name" wale element (ya parent) par click hone par event bhejo
document.addEventListener('click', (e) => {
  const el = e.target instanceof Element ? e.target.closest('[data-track]') : null
  const name = el?.getAttribute('data-track')
  if (name) track(name, { screen_name: window.location.pathname })
}, true) // capture: stopPropagation wale handlers ke baad bhi chale

const redirectingToScope = restoreStandaloneScope()

if (!redirectingToScope) createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <TenantProvider>
        <NavigationProvider>
          <App />
        </NavigationProvider>
      </TenantProvider>
    </BrowserRouter>
  </StrictMode>,
)
