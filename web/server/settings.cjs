const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const appDir = path.join(os.homedir(), '.nertator')
const settingsPath = () => path.join(appDir, 'settings.json')
const secretKeyPath = () => path.join(appDir, 'secret.key')

function ensureAppDir() {
  fs.mkdirSync(appDir, { recursive: true, mode: 0o700 })
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) } catch { return {} }
}

function writeSettings(settings) {
  ensureAppDir()
  fs.writeFileSync(settingsPath(), JSON.stringify(settings), { mode: 0o600 })
}

// Electron's safeStorage encrypts secrets with an OS-level, per-user key. There is
// no browser/server equivalent, so we generate our own local-machine-only AES-256-GCM
// key once and keep it out of settings.json and out of any HTTP response.
function loadOrCreateSecretKey() {
  ensureAppDir()
  try {
    return fs.readFileSync(secretKeyPath())
  } catch {
    const key = crypto.randomBytes(32)
    fs.writeFileSync(secretKeyPath(), key, { mode: 0o600 })
    return key
  }
}

function encryptSecret(plainText) {
  const key = loadOrCreateSecretKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

function decryptSecret(payload) {
  const key = loadOrCreateSecretKey()
  const raw = Buffer.from(payload, 'base64')
  const iv = raw.subarray(0, 12)
  const authTag = raw.subarray(12, 28)
  const encrypted = raw.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

module.exports = { appDir, ensureAppDir, readSettings, writeSettings, encryptSecret, decryptSecret }
