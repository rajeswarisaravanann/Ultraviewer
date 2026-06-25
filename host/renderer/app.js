const SIGNALING_SERVER = window.SIGNALING_SERVER || 'https://ultraviewer-server.onrender.com'
if (!window.SIGNALING_SERVER) {
  console.warn('[Host] config.js not loaded or SIGNALING_SERVER missing. Using fallback:', SIGNALING_SERVER)
}
const socket = io(SIGNALING_SERVER, {
  path: '/socket.io',
  transports: ["websocket", "polling"],
  secure: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  timeout: 30000,
})
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
let viewerSocketId = null
let streamInterval = null
let myId = generateId()
let myPassword = generatePassword()
let _registered = false
let hostRegisterRetry = null
let hostRegisterAttempts = 0

const statusEl = document.getElementById('status')
const liveDot = document.getElementById('live-dot')
const stopButton = document.getElementById('stop-button')
const myIdEl = document.getElementById('my-id')
const myPasswordEl = document.getElementById('my-password')

myIdEl.textContent = myId
myPasswordEl.textContent = myPassword
setStatus('Initializing...')

// Check robot availability from main process and show warning if unavailable
if (window.hostStatus && window.hostStatus.onRobotStatus) {
  window.hostStatus.onRobotStatus((status) => {
    if (!status || !status.available) {
      console.warn('[Host UI] RobotJS unavailable:', status && status.error)
      setStatus('Remote mouse and keyboard control unavailable. Native input module failed to load.')
    }
  })

  // Also query current status
  if (window.hostStatus.isRobotAvailable) {
    window.hostStatus.isRobotAvailable().then((available) => {
      if (!available) setStatus('Remote mouse and keyboard control unavailable. Native input module failed to load.')
    }).catch(() => {})
  }
}

stopButton.addEventListener('click', () => {
  window.close()
})

function emitHostRegister() {
  if (!myId || !myPassword) {
    console.error('[Host] cannot emit host-register without id/password')
    return
  }
  if (!socket || !socket.connected) {
    console.warn('[Host] socket not connected yet, delaying host-register')
    return
  }
  hostRegisterAttempts += 1
  console.log('[Host] emitting host-register attempt', hostRegisterAttempts, { id: myId, password: myPassword })
  socket.emit('host-register', { id: myId, password: myPassword })
  if (hostRegisterRetry) clearTimeout(hostRegisterRetry)
  hostRegisterRetry = setTimeout(() => {
    if (!_registered && socket.connected) {
      console.warn('[Host] host-register not acknowledged, retrying')
      emitHostRegister()
    }
  }, 5000)
}

socket.onAny((event, ...args) => {
  console.log('[Host] socket event:', event, args)
})

socket.on('connect', () => {
  console.log('[Host] socket connected:', socket.id, 'SIGNALING_SERVER=', SIGNALING_SERVER)
  setStatus('Connected to signaling server')
  if (!_registered) {
    emitHostRegister()
  } else {
    console.log('[Host] already registered, re-sending host-register for reconnection')
    emitHostRegister()
  }
  setStatus('Connected to signaling server — Starting screen capture...')
  init()
})

socket.on('disconnect', (reason) => {
  console.warn('[Host] socket disconnected:', reason)
  _registered = false
  setStatus('Disconnected from signaling server')
})

socket.on('reconnect_error', (err) => {
  console.error('[Host] reconnect error', err)
  setStatus('Reconnect error')
})

socket.on('connect_timeout', () => {
  console.error('[Host] connect timeout')
  setStatus('Signaling timeout')
})

socket.on('reconnect_attempt', (attempt) => {
  console.log('[Host] reconnect attempt', attempt)
  setStatus('Reconnecting...')
})

socket.on('reconnect', () => {
  console.log('[Host] reconnected')
  setStatus('Reconnected to signaling server')
})

socket.on('connect_error', (err) => {
  console.error('[Host] connect error', err)
  setStatus('Connection Error: ' + (err.message || err))
})

socket.on('connect_failed', (err) => {
  console.error('[Host] connect failed', err)
  setStatus('Connect failed')
})

socket.on('connect_timeout', () => {
  console.error('[Host] connect timeout')
  setStatus('Signaling timeout')
})

socket.on('reconnect_failed', () => {
  console.error('[Host] reconnect failed')
  setStatus('Reconnect failed')
})

socket.on('error', (err) => {
  console.error('[Host] socket error', err)
})

socket.on('host-registered', ({ id }) => {
  console.log('[Host] registered:', id)
  _registered = true
  if (hostRegisterRetry) {
    clearTimeout(hostRegisterRetry)
    hostRegisterRetry = null
  }
  setStatus('Waiting for viewer to connect...')
})

socket.on('viewer-joined', async ({ viewerSocketId: vsid }) => {
  console.log('[Host] viewer joined:', vsid)
  if (!vsid) {
    console.error('[Host] viewer-joined missing socket id')
    return
  }
  viewerSocketId = vsid
  setStatus('Viewer connecting...')
  if (window.hostAPI?.minimizeWindow) {
    window.hostAPI.minimizeWindow()
  }
  await new Promise(r => setTimeout(r, 500))
  await startWebRTC()
})

socket.on('answer', async ({ sdp }) => {
  console.log('[Host] answer received')
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
    } catch (err) {
      console.error('[Host] failed to set remote answer:', err)
    }
  } else {
    console.warn('[Host] answer arrived without peer connection')
  }
})

socket.on('ice', async ({ candidate }) => {
  if (!pc) {
    console.warn('[Host] ICE received before peer connection exists')
    return
  }
  if (candidate) {
    try {
      console.log('[Host] adding ICE candidate')
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (e) {
      console.error('[Host] ICE error:', e)
    }
  }
})

async function init() {
  try {
    const sources = await window.hostAPI.getSources()
    console.log('[Host] sources:', sources.map(s => s.name + ' | ' + s.id))

    const source = sources.find(s =>
      s.id === 'screen:0:0' ||
      s.id.startsWith('screen:')
    ) || sources[0]

    if (!source) {
      throw new Error('No desktop sources available')
    }

    console.log('[Host] using source:', source.name, source.id)

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: source.id,
          maxWidth: 1920,
          maxHeight: 1080,
          maxFrameRate: 15,
        },
      },
    })

    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    video.style.display = 'none'
    document.body.appendChild(video)
    await video.play()
    window._captureVideo = video

    setStatus('Screen capture ready. Host is registered.')
  } catch (err) {
    console.error('[Host] init failed:', err)
    setStatus('Screen capture failed. Check permissions and restart.')
  }
}

function createPeerConnection(remoteId) {
  cleanupPeerConnection()
  pc = new RTCPeerConnection(rtcConfig)
  viewerSocketId = remoteId

  pc.onicecandidate = ({ candidate }) => {
    if (candidate && viewerSocketId) {
      console.log('[Host] sending ICE candidate to viewer')
      socket.emit('ice', { to: viewerSocketId, candidate })
    }
  }

  pc.oniceconnectionstatechange = () => {
    console.log('[Host] ICE state:', pc.iceConnectionState)
    if (pc.iceConnectionState === 'connected') {
      console.log('[Host] WebRTC connected')
    }
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
      console.warn('[Host] WebRTC connection lost')
      setStatus('Viewer disconnected.')
      liveDot.style.display = 'none'
      stopStreaming()
    }
  }

  pc.onconnectionstatechange = () => {
    console.log('[Host] connection state:', pc.connectionState)
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      setStatus('Viewer disconnected.')
      liveDot.style.display = 'none'
      stopStreaming()
    }
  }

  pc.onicegatheringstatechange = () => {
    console.log('[Host] ICE gathering state:', pc.iceGatheringState)
  }

  videoChannel = pc.createDataChannel('video', {
    ordered: false,
    maxRetransmits: 0
  })
  videoChannel.binaryType = 'arraybuffer'
  videoChannel.onopen = () => {
    console.log('[Host] video channel open — starting stream')
    startStreaming()
  }
  videoChannel.onclose = () => {
    console.log('[Host] video channel closed')
    stopStreaming()
  }

  controlChannel = pc.createDataChannel('control', { ordered: true })
  controlChannel.onopen = () => {
    console.log('[Host] control channel open')
    if (window.hostAPI?.minimizeWindow) {
      window.hostAPI.minimizeWindow()
    }
    controlChannel.send(JSON.stringify({
      type: 'screen-size',
      width: Math.round(screen.width * window.devicePixelRatio),
      height: Math.round(screen.height * window.devicePixelRatio)
    }))
    setStatus('✅ Viewer connected — Live')
    liveDot.style.display = 'inline-block'
  }
  controlChannel.onmessage = handleControl
  controlChannel.onclose = () => {
    console.log('[Host] control channel closed')
    setStatus('Viewer disconnected.')
    liveDot.style.display = 'none'
    stopStreaming()
  }
}

async function startWebRTC() {
  if (!viewerSocketId) {
    console.error('[Host] cannot start WebRTC without viewerSocketId')
    return
  }

  createPeerConnection(viewerSocketId)

  try {
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    socket.emit('offer', { to: viewerSocketId, sdp: pc.localDescription })
    console.log('[Host] offer sent')
  } catch (err) {
    console.error('[Host] failed to create/send offer:', err)
    setStatus('Failed to establish connection')
  }
}

function startStreaming() {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const ctx = canvas.getContext('2d')
  const video = window._captureVideo

  if (!video) {
    console.error('[Host] startStreaming failed: no video source available')
    return
  }

  streamInterval = setInterval(() => {
    if (!videoChannel || videoChannel.readyState !== 'open') return
    if (videoChannel.bufferedAmount > 512 * 1024) return
    if (video.readyState < 2) return

    try {
      ctx.drawImage(video, 0, 0, 1280, 720)
      canvas.toBlob((blob) => {
        if (!blob) return
        blob.arrayBuffer().then((buf) => {
          if (videoChannel && videoChannel.readyState === 'open') {
            try {
              videoChannel.send(buf)
            } catch (e) {
              console.error('[Host] send error:', e.message)
            }
          }
        }).catch((err) => console.error('[Host] blob arrayBuffer error:', err))
      }, 'image/jpeg', 0.7)
    } catch (err) {
      console.error('[Host] startStreaming draw error:', err)
    }
  }, 50)
}

function stopStreaming() {
  if (streamInterval) { clearInterval(streamInterval); streamInterval = null }
  if (window.hostAPI?.restoreWindow) {
    window.hostAPI.restoreWindow()
  }
}

function cleanupPeerConnection() {
  if (streamInterval) {
    clearInterval(streamInterval)
    streamInterval = null
  }
  if (pc) {
    try { pc.close() } catch (e) { console.warn('[Host] close peer error', e) }
    pc = null
  }
  videoChannel = null
  controlChannel = null
}

function handleControl(event) {
  try {
    const msg = JSON.parse(event.data)

    if (msg.type === 'mousemove')
      window.hostAPI.mouseMove(msg.x, msg.y)

    if (msg.type === 'mousedown')
      window.hostAPI.mouseClick(msg.button, 'down')

    if (msg.type === 'mouseup')
      window.hostAPI.mouseClick(msg.button, 'up')

    if (msg.type === 'dblclick')
      window.hostAPI.mouseClick('left', 'double')

    if (msg.type === 'scroll')
      window.hostAPI.mouseScroll(msg.dx, msg.dy)

    // IMPORTANT: viewer sends 'keydown'/'keyup' not 'key'
    if (msg.type === 'keydown' || msg.type === 'key') {
      const action = msg.action || (msg.type === 'keydown' ? 'down' : 'up')
      window.hostAPI.keyPress(msg.key, action)
    }

    if (msg.type === 'keyup')
      window.hostAPI.keyPress(msg.key, 'up')

    if (msg.type === 'ping')
      controlChannel.send(JSON.stringify({ type: 'pong', t: msg.t || msg.timestamp }))
  } catch (e) {
    console.error('[Host] handleControl error:', e)
  }
}

function setStatus(msg) {
  statusEl.textContent = msg
  console.log('[Host]', msg)
}

function generateId() {
  return Math.floor(100000000 + Math.random() * 900000000).toString()
}

function generatePassword() {
  return Math.floor(1000 + Math.random() * 9000).toString()
}
