import { PropsWithChildren } from 'react'
import { LedgerProvider } from './store'
import { LayoutProvider } from './layout'
import './app.scss'

export default function App({ children }: PropsWithChildren) {
  return <LayoutProvider><LedgerProvider>{children}</LedgerProvider></LayoutProvider>
}
