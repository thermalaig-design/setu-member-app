import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './App.css'
import App from './App.jsx'
import { NavigationProvider } from './context/ImprovedNavigationProvider'
import { TenantProvider } from './context/TenantContext'
import { restoreStandaloneScope } from './utils/tenantNavigation'

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
