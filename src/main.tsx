import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './styles.css'
import App from './App.tsx'
import * as lab from './lab/run'

// Lets the AI checks be driven from the console as well as from the Lab page.
Object.assign(window, { __lab: lab })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
