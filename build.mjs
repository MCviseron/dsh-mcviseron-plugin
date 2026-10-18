import { build } from 'esbuild'
import { mkdir, rm, writeFile } from 'node:fs/promises'

const sharedExternal = [
  '@deepseek-ai/*',
  '@deepseek-ai/schemastery',
  'react',
  'react/*',
  'react-dom',
  'react-dom/*',
]

await mkdir('lib', { recursive: true })
// Remove outputs left behind by older layouts (pre-0.3 aggregate, pre-0.4 name).
await rm('lib/index.js', { force: true })
await rm('lib/auto-review.js', { force: true })

// Host entries: one bundle per component, so the DSH plugin inventory lists
// each component as its own loader entry (name: "dsh-mcviseron-plugin/<id>").
const hostEntries = [
  ['src/appearance/index.ts', 'lib/appearance.js'],
  ['src/auto-review-fix/index.ts', 'lib/auto-review-fix.js'],
  ['src/task-guard/index.ts', 'lib/task-guard.js'],
  ['src/restart/index.ts', 'lib/restart.js'],
]
for (const [entry, outfile] of hostEntries) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    external: sharedExternal,
    sourcemap: false,
    logLevel: 'info',
  })
}

// Browser half: bundle as CommonJS, then wrap it in the DSH module-loader
// format the Web shell executes. External runtime modules are provided by the
// shell's require(), exactly like the official dsh-* client bundles.
const client = await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: [
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-locale/client',
    '@deepseek-ai/dsh-client-ui-settings/client',
    '@deepseek-ai/dsh-client-ui-renderer/client',
    '@deepseek-ai/dsh-client-connection/client',
  ],
  sourcemap: false,
  write: false,
  logLevel: 'info',
})

let code = client.outputFiles[0]?.text ?? ''
const useStrict = code.startsWith('"use strict";\n') ? '"use strict";\n' : code.startsWith("'use strict';\n") ? "'use strict';\n" : ''
if (useStrict !== '') code = code.slice(useStrict.length)
const wrapped = [
  'window.__ModuleLoader__.load({',
  '  id: "dsh-mcviseron-plugin",',
  '  factory: (require) => {',
  useStrict,
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
  '    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  code,
  '    return module.exports;',
  '  }',
  '});',
  '',
].filter(line => line !== '').join('\n')

await writeFile('lib/client.js', wrapped, 'utf8')
console.log('built lib/appearance.js, lib/auto-review-fix.js, lib/task-guard.js, lib/restart.js and lib/client.js')
