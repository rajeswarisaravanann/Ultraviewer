#!/usr/bin/env node
const path = require('path')
const { spawnSync } = require('child_process')

function log(...args) { console.log('[rebuild-native]', ...args) }

async function run() {
  log('Platform:', process.platform)
  log('Node:', process.version)
  log('Electron:', process.versions && process.versions.electron)

  let rebuild
  try {
    rebuild = require('@electron/rebuild')
  } catch (e) {
    console.error('[rebuild-native] @electron/rebuild not installed:', e.message)
    process.exit(0)
  }

  const modules = ['@jitsi/robotjs', 'robotjs']
  try {
    await rebuild.rebuild({
      buildPath: path.resolve(__dirname, '..'),
      electronVersion: process.versions.electron,
      force: true,
      // ensure both possible modules are rebuilt if present
      onlyModules: modules,
    })
    log('Rebuild completed')
  } catch (err) {
    console.error('[rebuild-native] Rebuild failed:', err && (err.message || err))
    if (process.platform === 'win32') {
      // check for MSVC/cl.exe
      const where = spawnSync('where', ['cl'], { shell: true })
      if (where.status !== 0) {
        console.error('[rebuild-native] Microsoft Visual C++ Build Tools not found.')
        console.error('[rebuild-native] Install build tools: https://visualstudio.microsoft.com/visual-cpp-build-tools/')
      }
    }
    console.error('[rebuild-native] Native module rebuild failed. Remote input features may be unavailable.')
    // Do not fail the install but surface the error
    process.exit(0)
  }
}

run()
