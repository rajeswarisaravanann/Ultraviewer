#!/usr/bin/env node
const path = require('path')
const { spawnSync } = require('child_process')

function log(...args) { console.log('[rebuild-native]', ...args) }

async function run() {
  const electronVersion = process.versions && process.versions.electron
  log('Platform:', process.platform)
  log('Node:', process.version)
  log('Electron:', electronVersion || 'undefined')

  if (!electronVersion) {
    console.warn('[rebuild-native] No Electron version detected. Skipping native rebuild.');
    process.exit(0)
  }

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
      onlyModules: modules,
    })
    log('Rebuild completed')
  } catch (err) {
    console.error('[rebuild-native] Rebuild failed:', err && (err.message || err))
    if (process.platform === 'win32') {
      const where = spawnSync('where', ['cl'], { shell: true })
      if (where.status !== 0) {
        console.error('[rebuild-native] Microsoft Visual C++ Build Tools not found.')
        console.error('[rebuild-native] Install build tools: https://visualstudio.microsoft.com/visual-cpp-build-tools/')
      }
    }
    console.error('[rebuild-native] Native module rebuild failed. Remote input features may be unavailable.')
    process.exit(0)
  }
}

run()
