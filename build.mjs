import { build } from 'esbuild'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// nodemailer is CommonJS and calls require('events') from inside an ESM
// bundle. Give every host bundle a real CommonJS require so esbuild's
// __require shim can resolve Node builtins at import time.
const cjsBanner = [
  "import { createRequire } from 'node:module';",
  'const require = createRequire(import.meta.url);',
].join('\n')

const sharedExternal = [
  '@deepseek-ai/*',
  '@deepseek-ai/schemastery',
  'react',
  'react/*',
  'react-dom',
  'react-dom/*',
]

await mkdir('lib', { recursive: true })
// Remove the only legacy output left behind by older layouts.
await rm('lib/auto-review.js', { force: true })

// Host entries: one bundle per component, so the DSH plugin inventory lists
// each component as its own loader entry (name: "dsh-mcviseron-plugin/<id>").
const hostEntries = [
  ['src/index.ts', 'lib/index.js'],
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
    banner: { js: cjsBanner },
    sourcemap: false,
    logLevel: 'info',
  })
}

// Catch the class of regression that dropped the plugin after v0.6.3:
// importing the built host bundle at build time proves the bundled CJS
// dependencies (nodemailer) can resolve their builtins under ESM.
await import(pathToFileURL(resolve('lib/index.js')).href + '?t=' + Date.now())
console.log('host bundle imports cleanly')

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
    '@deepseek-ai/dsh-client-ui-primitives',
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
console.log('built lib/index.js, the component entries, and lib/client.js')
