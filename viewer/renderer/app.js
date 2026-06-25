const SIGNALING_SERVER = window.SIGNALING_SERVER || 'https://ultraviewer-server.onrender.com'
if (!window.SIGNALING_SERVER) {
  console.warn('[Viewer] config.js not loaded or SIGNALING_SERVER missing. Using fallback:', SIGNALING_SERVER)
}
const socket = io(SIGNALING_SERVER, {
  path: '/socket.io',
  transports: ["websocket", "polling"],
  secure: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  timeout: 30000,
})
let viewerConnectPending = null
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    {
      urls: [
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turn:openrelay.metered.ca:3478?transport=udp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
}

let pc = null
let videoChannel = null
let controlChannel = null
let hostSocketId = null
let remoteW = 1920
let remoteH = 1080
let frameCount = 0
let lastFpsTime = Date.now()
let pingInterval = null
let _lastTargetId = null
let _lastPassword = null

const loginScreen = document.getElementById('login-screen')
const viewerScreen = document.getElementById('viewer-screen')
const hostIdInput = document.getElementById('host-id')
const hostPasswordInput = document.getElementById('host-password')
const connectButton = document.getElementById('connect-button')
const disconnectButton = document.getElementById('disconnect-button')
const errorMsg = document.getElementById('error-msg')
const remoteHostId = document.getElementById('remote-host-id')
const connStatus = document.getElementById('conn-status')
const pingEl = document.getElementById('ping')
const fpsEl = document.getElementById('fps')
const remoteImg = document.getElementById('remote-img')
const loadingMsg = document.getElementById('loading-msg')

connectButton.addEventListener('click', connect)
disconnectButton.addEventListener('click', disconnect)
hostPasswordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') connect()
})

socket.onAny((event, ...args) => {
  console.log('[Viewer] socket event:', event, args)
})

socket.on('connect', () => {
  console.log('[Viewer] socket connected:', socket.id, 'SIGNALING_SERVER=', SIGNALING_SERVER)
  connStatus.textContent = 'Connected to signaling server'
  if (viewerConnectPending) {
    console.log('[Viewer] retrying pending viewer-connect', viewerConnectPending)
    socket.emit('viewer-connect', viewerConnectPending)
    viewerConnectPending = null
    connStatus.textContent = 'Reconnecting to host...'
    loadingMsg.style.display = 'block'
  } else if (_lastTargetId && _lastPassword) {
    console.log('[Viewer] re-attempting viewer-connect for', _lastTargetId)
    socket.emit('viewer-connect', { targetId: _lastTargetId, password: _lastPassword })
    connStatus.textContent = 'Reconnecting to host...'
    loadingMsg.style.display = 'block'
  }
})

socket.on('disconnect', (reason) => {
  console.warn('[Viewer] socket disconnected:', reason)
  connStatus.textContent = 'Disconnected from signaling server'
})

socket.on('connect_timeout', () => {
  console.error('[Viewer] connect timeout')
  connStatus.textContent = 'Connection timeout'
  showError('Signaling server timeout')
})

socket.on('reconnect_error', (err) => {
  console.error('[Viewer] reconnect error', err)
  connStatus.textContent = 'Reconnect error'
  showError('Reconnect error: ' + (err.message || err))
})

socket.on('reconnect_attempt', (attempt) => {
  console.log('[Viewer] reconnect attempt', attempt)
  connStatus.textContent = 'Reconnecting...'
})

socket.on('reconnect', () => {
  console.log('[Viewer] reconnected')
  connStatus.textContent = 'Reconnected'
})

socket.on('connect_error', (err) => {
  console.error('[Viewer] connect error', err)
  connStatus.textContent = 'Connection Error'
  showError('Unable to connect to signaling server: ' + (err.message || err))
})

socket.on('connect_failed', (err) => {
  console.error('[Viewer] connect failed', err)
  connStatus.textContent = 'Connect failed'
  showError('Failed to connect to signaling server')
})

socket.on('connect_timeout', () => {
  console.error('[Viewer] connect timeout')
  connStatus.textContent = 'Connection timeout'
  showError('Signaling server connect timeout')
})

socket.on('reconnect_failed', () => {
  console.error('[Viewer] reconnect failed')
  connStatus.textContent = 'Reconnect failed'
  showError('Could not reconnect to signaling server')
})

socket.on('error', (err) => {
  console.error('[Viewer] socket error', err)
  showError('Socket error: ' + (err.message || err))
})

socket.on('error-msg', (msg) => {
  console.warn('[Viewer] error-msg:', msg)
  showError(msg)
  showScreen('login-screen')
})

socket.on('offer', async ({ sdp, from }) => {
  console.log('[Viewer] offer received from host:', from)
  hostSocketId = from
  createPeerConnection(from)

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    socket.emit('answer', { to: from, sdp: pc.localDescription })
    console.log('[Viewer] answer sent')
  } catch (err) {
    console.error('[Viewer] offer handling failed:', err)
    showError('Failed to process host offer')
    cleanupPeerConnection()
  }
})

socket.on('ice', async ({ candidate, from }) => {
  if (!pc) {
    console.warn('[Viewer] ICE received before peer created')
    return
  }
  if (candidate) {
    try {
      console.log('[Viewer] adding ICE candidate from host')
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (e) {
      console.error('[Viewer] ICE error:', e)
    }
  }
})

function connect() {
  const hostId = hostIdInput.value.trim()
  const password = hostPasswordInput.value.trim()

  if (!hostId || hostId.length !== 9) {
    showError('Enter a valid Host ID')
    return
  }
  if (!password || password.length !== 4) {
    showError('Enter the 4-digit password')
    return
  }

  cleanupPeerConnection()
  errorMsg.textContent = ''
  remoteHostId.textContent = hostId
  showScreen('viewer-screen')
  connStatus.textContent = 'Connecting...'
  loadingMsg.style.display = 'block'

  _lastTargetId = hostId
  _lastPassword = password

  console.log('[Viewer] emitting viewer-connect', { targetId: hostId, password })
  if (!socket.connected) {
    connStatus.textContent = 'Connecting to signaling server...'
  }

  viewerConnectPending = { targetId: hostId, password }
  socket.emit('viewer-connect', viewerConnectPending)
}

function createPeerConnection(remoteId) {
  cleanupPeerConnection()
  pc = new RTCPeerConnection(rtcConfig)

  pc.onicecandidate = ({ candidate }) => {
    if (candidate && remoteId) {
      console.log('[Viewer] sending ICE candidate to host')
      socket.emit('ice', { to: remoteId, candidate })
    }
  }

  pc.oniceconnectionstatechange = () => {
    console.log('[Viewer] ICE state:', pc.iceConnectionState)
    if (pc.iceConnectionState === 'connected') {
      connStatus.textContent = 'Connected'
      loadingMsg.style.display = 'none'
    }
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
      showError('Connection lost')
      cleanupPeerConnection()
      showScreen('login-screen')
    }
  }

  pc.onconnectionstatechange = () => {
    console.log('[Viewer] peer connection state:', pc.connectionState)
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
      connStatus.textContent = 'Connection lost'
    }
  }

  pc.onicegatheringstatechange = () => {
    console.log('[Viewer] ICE gathering state:', pc.iceGatheringState)
  }

  pc.ondatachannel = ({ channel }) => {
    if (channel.label === 'video') {
      videoChannel = channel
      videoChannel.binaryType = 'arraybuffer'
      videoChannel.onmessage = (e) => renderFrame(e.data)
      videoChannel.onopen = () => console.log('[Viewer] video channel open')
      videoChannel.onclose = () => console.log('[Viewer] video channel closed')
    }

    if (channel.label === 'control') {
      controlChannel = channel
      controlChannel.onopen = () => {
        console.log('[Viewer] control channel open')
        setupInput()
        startPing()
      }
      controlChannel.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'screen-size') {
            remoteW = msg.width
            remoteH = msg.height
            console.log('[Viewer] remote screen size:', remoteW, remoteH)
          }
          if (msg.type === 'pong') {
            pingEl.textContent = Date.now() - msg.t + ' ms'
          }
        } catch (err) {
          console.error('[Viewer] control parse error:', err)
        }
      }
      controlChannel.onclose = () => {
        console.log('[Viewer] control closed')
        showError('Control channel closed')
        cleanupPeerConnection()
        showScreen('login-screen')
      }
    }
  }

  pc.onicecandidate = ({ candidate }) => {
    if (candidate && remoteId) {
      console.log('[Viewer] sending ICE candidate to host')
      socket.emit('ice', { to: remoteId, candidate })
    }
  }

  pc.oniceconnectionstatechange = () => {
    console.log('[Viewer] ICE state:', pc.iceConnectionState)
    if (pc.iceConnectionState === 'connected') {
      connStatus.textContent = 'Connected'
      loadingMsg.style.display = 'none'
    }
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
      showError('Connection lost')
      cleanupPeerConnection()
      showScreen('login-screen')
    }
  }

  pc.onconnectionstatechange = () => {
    console.log('[Viewer] connection state:', pc.connectionState)
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
      connStatus.textContent = 'Connection lost'
    }
  }

  pc.onicegatheringstatechange = () => {
    console.log('[Viewer] ICE gathering state:', pc.iceGatheringState)
  }
}

function cleanupPeerConnection() {
  if (pingInterval) {
    clearInterval(pingInterval)
    pingInterval = null
  }
  if (pc) {
    try { pc.close() } catch (e) { console.warn('[Viewer] close peer error', e) }
    pc = null
  }
  videoChannel = null
  controlChannel = null
  hostSocketId = null
}

function renderFrame(buf) {
  if (!buf) return
  const blob = new Blob([buf], { type: 'image/jpeg' })
  const url = URL.createObjectURL(blob)
  const oldUrl = remoteImg.src
  remoteImg.src = url
  remoteImg.onload = () => {
    if (oldUrl && oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl)
    document.getElementById('loading-msg').style.display = 'none'
  }
  frameCount++
  const now = Date.now()
  if (now - lastFpsTime >= 1000) {
    document.getElementById('fps').textContent = frameCount + ' FPS'
    frameCount = 0
    lastFpsTime = now
  }
}

function getRemoteCoordinates(e) {
  const r = remoteImg.getBoundingClientRect()
  const naturalWidth = remoteImg.naturalWidth || r.width
  const naturalHeight = remoteImg.naturalHeight || r.height
  let displayedWidth = r.width
  let displayedHeight = r.height
  let offsetX = 0
  let offsetY = 0

  if (naturalWidth && naturalHeight) {
    const scale = Math.min(r.width / naturalWidth, r.height / naturalHeight)
    displayedWidth = naturalWidth * scale
    displayedHeight = naturalHeight * scale
    offsetX = (r.width - displayedWidth) / 2
    offsetY = (r.height - displayedHeight) / 2
  }

  const xPos = e.clientX - r.left - offsetX
  const yPos = e.clientY - r.top - offsetY
  const inside = xPos >= 0 && yPos >= 0 && xPos <= displayedWidth && yPos <= displayedHeight

  return {
    x: Math.round(Math.max(0, Math.min(remoteW, xPos / displayedWidth * remoteW))),
    y: Math.round(Math.max(0, Math.min(remoteH, yPos / displayedHeight * remoteH))),
    inside,
  }
}

function setupInput() {
  console.log('[Viewer] setupInput() called')

  const img = document.getElementById('remote-img')
  if (!img) {
    console.error('[Viewer] remote-img NOT FOUND — retrying in 500ms')
    setTimeout(setupInput, 500)
    return
  }

  console.log('[Viewer] attaching input handlers to img')
  img.style.cursor = 'none'
  img.focus()

  img.addEventListener('mousemove', (e) => {
    const coords = getRemoteCoordinates(e)
    if (!coords.inside) return
    send({ type: 'mousemove', x: coords.x, y: coords.y })
  })

  img.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    img.focus()
    const btn = e.button === 2 ? 'right' : 'left'
    console.log('[Viewer] mousedown:', btn, '→ sending to host')
    send({ type: 'mousedown', button: btn })
  })

  img.addEventListener('mouseup', (e) => {
    e.preventDefault()
    const btn = e.button === 2 ? 'right' : 'left'
    send({ type: 'mouseup', button: btn })
  })

  img.addEventListener('dblclick', (e) => {
    e.preventDefault()
    console.log('[Viewer] dblclick')
    send({ type: 'dblclick', button: 'left' })
  })

  img.addEventListener('wheel', (e) => {
    e.preventDefault()
    send({ type: 'scroll', dx: e.deltaX, dy: e.deltaY })
  }, { passive: false })

  img.addEventListener('contextmenu', (e) => e.preventDefault())

  document.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT') return
    e.preventDefault()
    console.log('[Viewer] keydown:', e.key)
    send({ type: 'keydown', key: e.key })
  })

  document.addEventListener('keyup', (e) => {
    if (document.activeElement.tagName === 'INPUT') return
    send({ type: 'keyup', key: e.key })
  })

  console.log('[Viewer] input handlers attached ✓')
}

function send(obj) {
  if (!controlChannel) {
    console.warn('[Viewer] send() — controlChannel is null')
    return
  }
  if (controlChannel.readyState !== 'open') {
    console.warn('[Viewer] send() — channel not open:', controlChannel.readyState)
    return
  }
  controlChannel.send(JSON.stringify(obj))
}

function startPing() {
  pingInterval = setInterval(() => {
    send({ type: 'ping', t: Date.now() })
  }, 1000)
}

function disconnect() {
  cleanupPeerConnection()
  showScreen('login-screen')
}

function showScreen(screen) {
  loginScreen.style.display = screen === 'login-screen' ? 'flex' : 'none'
  viewerScreen.style.display = screen === 'viewer-screen' ? 'flex' : 'none'
}

function showError(msg) {
  errorMsg.textContent = msg
  console.error('[Viewer]', msg)
}
