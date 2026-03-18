import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ShellLayout } from './ui/components/shell/ShellLayout'
import { Toolbar } from './ui/components/shell/Toolbar'
import { TopBar } from './ui/components/shell/TopBar'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShellLayout>
      <TopBar />
      <Toolbar />
      <App />
    </ShellLayout>
  </StrictMode>,
)
