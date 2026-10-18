#!/usr/bin/env node
/**
 * Repair a DSH profile after a raw `pnpm install`.
 *
 * On Windows pnpm resolves a cross-drive `link:D:/...` dependency into a
 * broken relative symlink such as
 * `<profile>\node_modules\<name> -> <profile>\D:\...`.
 * The loader then reports every such plugin as "package unavailable" and the
 * plugin manager may also drop those entries from `dsh.profile.bundles`.
 *
 * This script:
 *   1. recreates every `link:` dependency as an absolute junction;
 *   2. re-adds every linked package to `dsh.profile.bundles`;
 *   3. reports missing targets instead of silently skipping them.
 *
 * Usage:
 *   node scripts/repair-profile.mjs [profileDir]
 * Default profile: %USERPROFILE%/.dsh/profiles/desktop
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const profile = process.argv[2] ?? path.join(os.homedir(), '.dsh', 'profiles', 'desktop')
const packagePath = path.join(profile, 'package.json')
if (!fs.existsSync(packagePath)) {
  console.error('repair-profile: package.json not found at ' + packagePath)
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
const links = Object.entries(manifest.dependencies ?? {})
  .filter(([, spec]) => typeof spec === 'string' && spec.startsWith('link:'))
  .map(([name, spec]) => ({ name, target: spec.slice('link:'.length).replaceAll('/', path.sep) }))

let failures = 0
let repairs = 0
const bundles = manifest.dsh?.profile?.bundles ?? []
const added = []

for (const { name, target } of links) {
  if (!fs.existsSync(path.join(target, 'package.json'))) {
    console.error('MISSING target for ' + name + ': ' + target)
    failures += 1
    continue
  }
  const link = path.join(profile, 'node_modules', name)
  let current = ''
  try { current = fs.realpathSync(link) } catch { current = '' }
  const expected = fs.realpathSync(target)
  if (current !== expected) {
    try { fs.unlinkSync(link) } catch { try { fs.rmdirSync(link) } catch { /* absent */ } }
    fs.mkdirSync(path.dirname(link), { recursive: true })
    fs.symlinkSync(target, link, 'junction')
    repairs += 1
    console.log('repaired ' + name + ' -> ' + target)
  } else {
    console.log('ok       ' + name + ' -> ' + current)
  }
  if (!bundles.includes(name)) {
    bundles.push(name)
    added.push(name)
  }
}

if (added.length > 0) {
  manifest.dsh = manifest.dsh ?? {}
  manifest.dsh.profile = manifest.dsh.profile ?? {}
  manifest.dsh.profile.bundles = bundles
  fs.writeFileSync(packagePath, JSON.stringify(manifest, null, 2) + '\n')
}

console.log('')
console.log('profile: ' + profile)
console.log('links checked: ' + links.length + ' | repaired: ' + repairs + ' | bundles restored: ' + (added.join(', ') || '(none)'))
process.exit(failures > 0 ? 1 : 0)
