const fs = require('node:fs')
const path = require('node:path')
const { appDir, ensureAppDir, readSettings, writeSettings } = require('./settings.cjs')

const projectsDir = path.join(appDir, 'projects')

function ensureProjectsDir() {
  ensureAppDir()
  fs.mkdirSync(projectsDir, { recursive: true, mode: 0o700 })
}

function slugify(name) {
  const slug = (name || 'untitled').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'untitled'
}

// Picks a free file path inside the managed projects folder, suffixing on collision —
// this replaces the native "Save project as" dialog, which previously let the user
// pick any path; here the server owns the location and the name only affects the label.
function freeProjectPath(baseName) {
  ensureProjectsDir()
  const slug = slugify(baseName)
  let candidate = path.join(projectsDir, `${slug}.nerdb`)
  let attempt = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(projectsDir, `${slug}-${attempt}.nerdb`)
    attempt += 1
  }
  return candidate
}

// Saves an uploaded .nerdb file's bytes into the managed folder. This is how "Open
// project" works in the browser: the native <input type="file"> picker uploads the
// file's bytes, since a web page cannot be handed an arbitrary filesystem path.
function saveUploadedProject(buffer, originalName) {
  ensureProjectsDir()
  const base = path.basename(originalName || 'project.nerdb', path.extname(originalName || '')) || 'project'
  const target = freeProjectPath(base)
  fs.writeFileSync(target, buffer)
  return target
}

function rememberProject(projectPath, name) {
  const settings = readSettings()
  const recent = (settings.recentProjects || []).filter((item) => item.path !== projectPath)
  writeSettings({ ...settings, recentProjects: [{ path: projectPath, name, openedAt: new Date().toISOString() }, ...recent].slice(0, 8) })
}

function recentProjects() {
  const settings = readSettings()
  const valid = (settings.recentProjects || []).filter((item) => fs.existsSync(item.path))
  if (valid.length !== (settings.recentProjects || []).length) writeSettings({ ...settings, recentProjects: valid })
  return valid
}

module.exports = { projectsDir, ensureProjectsDir, freeProjectPath, saveUploadedProject, rememberProject, recentProjects }
