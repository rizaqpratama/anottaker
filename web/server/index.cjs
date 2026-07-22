const path = require('node:path')
const fs = require('node:fs')
const express = require('express')
const { router, shutdown } = require('./routes.cjs')

const app = express()
const port = Number(process.env.PORT || process.env.NERTATOR_SERVER_PORT || 4001)

app.use(express.json({ limit: '10mb' }))
app.use('/api', router)

const distDir = path.join(__dirname, '../dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

const server = app.listen(port, () => {
  console.info(`NERTator web server listening on http://localhost:${port}`)
})

async function gracefulShutdown() {
  await shutdown()
  server.close(() => process.exit(0))
}

process.on('SIGINT', gracefulShutdown)
process.on('SIGTERM', gracefulShutdown)
