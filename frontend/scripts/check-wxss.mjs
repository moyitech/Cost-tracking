import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../dist/weapp/', import.meta.url))
const compiler = process.env.WXSS_COMPILER || '/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec/wcsc'
if (!existsSync(compiler)) throw new Error('找不到微信 WXSS 编译器，请通过 WXSS_COMPILER 指定 wcsc 路径')
if (!existsSync(root)) throw new Error('请先运行 npm run build:weapp')
function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? collect(file) : file.endsWith('.wxss') ? [path.relative(root, file)] : []
  })
}
const files = collect(root).sort()
if (!files.length) throw new Error('构建目录没有 WXSS 文件')
// Pass every stylesheet so the native compiler can resolve @import dependencies.
const result = spawnSync(compiler, files, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
if (result.error || result.status !== 0) {
  console.error(result.error?.message || result.stderr || result.stdout)
  process.exit(1)
}
console.log(`微信原生 WXSS 编译通过（${files.length} 个文件）`)
