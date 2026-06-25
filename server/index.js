const path = require('path')
const express = require('express')
const { createServer } = require('http')
const { Server } = require('socket.io')

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: '*'
  }
})

const sessions = {}
const publicPath = path.join(__dirname, 'public')

app.use(express.static(publicPath))
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'))
})

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    sessions: Object.keys(sessions).length,
    time: new Date().toISOString()
  })
})

app.use((req, res) => {
  res.status(404).redirect('/')
})

io.on('connection', (socket) => {
  console.log('[Server] connect:', socket.id)

  socket.on('host-register', ({ id, password }) => {
    sessions[id] = { socketId: socket.id, password }
    socket.emit('host-registered', { id })
    console.log('[Server] host registered:', id, '| sessions:', Object.keys(sessions).length)
  })

  socket.on('viewer-connect', ({ targetId, password }) => {
    console.log('[Server] viewer-connect to:', targetId)
    const session = sessions[targetId]
    if (!session) {
      socket.emit('error-msg', 'Host ID not found')
      return
    }
    if (session.password !== password) {
      socket.emit('error-msg', 'Wrong password')
      return
    }
    console.log('[Server] auth OK, notifying host:', session.socketId)
    io.to(session.socketId).emit('viewer-joined', { viewerSocketId: socket.id })
  })

  socket.on('offer', ({ to, sdp }) => {
    console.log('[Server] offer:', socket.id, '->', to)
    io.to(to).emit('offer', { sdp, from: socket.id })
  })

  socket.on('answer', ({ to, sdp }) => {
    console.log('[Server] answer:', socket.id, '->', to)
    io.to(to).emit('answer', { sdp, from: socket.id })
  })

  socket.on('ice', ({ to, candidate }) => {
    if (!candidate) return
    io.to(to).emit('ice', { candidate, from: socket.id })
  })

  socket.on('leave-session', () => {
    for (const [id, s] of Object.entries(sessions)) {
      if (s.socketId === socket.id) {
        delete sessions[id]
        console.log('[Server] session removed:', id)
      }
    }
  })

  socket.on('disconnect', () => {
    for (const [id, s] of Object.entries(sessions)) {
      if (s.socketId === socket.id) {
        delete sessions[id]
        console.log('[Server] session removed:', id)
      }
    }
  })
})

process.on('uncaughtException', (error) => {
  console.error('[Server] uncaughtException:', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('[Server] unhandledRejection:', reason)
})

const port = process.env.PORT || 3000

console.log('[Server] NODE_ENV=', process.env.NODE_ENV || 'development')
console.log('[Server] process.versions=', process.versions)

try {
  httpServer.listen(port, '0.0.0.0', () => console.log(`[Server] running on :${port} (bound 0.0.0.0)`))
} catch (err) {
  console.error('[Server] failed to start:', err)
  process.exit(1)
}

process.on('exit', (code) => {
  console.log('[Server] exiting with code', code)
})
