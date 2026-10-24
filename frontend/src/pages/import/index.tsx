import { useMemo, useRef } from 'react'
import { createDemoImports, demoInputBody } from '../../import-demo'
import { mockEnabled } from '../../services'
import { useLedger } from '../../store'
import RemoteImport from './remote'

const demoUpload = async (path: string) => path
function DemoImport() {
  const store = useLedger(); const current = useRef(store); current.current = store
  const client = useMemo(() => createDemoImports(() => current.current.data, command => current.current.execute(command)), [])
  return <RemoteImport client={client} upload={demoUpload} prepare={demoInputBody} demo />
}
export default function ImportPage() { return mockEnabled ? <DemoImport /> : <RemoteImport /> }
