const socket = io('http://localhost:3000')
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
}

let pc = null
let videoChannel = null
let controlChannel = null
let viewerSocketId = null
let streamInterval = null
let myId = generateId()
let myPassword = generatePassword()

const statusEl = document.getElementById('status')
const liveDot = document.getElementById('live-dot')
const stopButton = document.getElementById('stop-button')
const myIdEl = document.getElementById('my-id')
const myPasswordEl = document.getElementById('my-password')

myIdEl.textContent = myId
myPasswordEl.textContent = myPassword
setStatus('Initializing...')

stopButton.addEventListener('click', () => {
  window.close()
})

socket.on('connect', () => {
  console.log('[Host] socket connected:', socket.id)
  setStatus('Starting screen capture...')
  init()
})

socket.on('host-registered', ({ id }) => {
  console.log('[Host] registered:', id)
  setStatus('Waiting for viewer to connect...')
})

socket.on('viewer-joined', async ({ viewerSocketId: vsid }) => {
  console.log('[Host] viewer joined:', vsid)
  viewerSocketId = vsid
  setStatus('Viewer connecting...')
  window.hostAPI.minimizeWindow()
  await new Promise(r => setTimeout(r, 500))
  await startWebRTC()
})

socket.on('answer', async ({ sdp }) => {
  console.log('[Host] answer received')
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp))
  }
})

socket.on('ice', async ({ candidate }) => {
  if (pc && candidate) {
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) }
    catch (e) { console.error('[Host] ICE error:', e) }
  }
})

async function init() {
  const sources = await window.hostAPI.getSources()
  console.log('[Host] sources:', sources.map(s => s.name + ' | ' + s.id))

  const source = sources.find(s =>
    s.id === 'screen:0:0' ||
    s.id.startsWith('screen:')
  ) || sources[0]

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

  setStatus('Screen capture ready. Registering...')
  socket.emit('host-register', { id: myId, password: myPassword })
}

async function startWebRTC() {
  pc = new RTCPeerConnection(rtcConfig)

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
    // Hide the window only when a viewer is actually connected
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
    setStatus('Viewer disconnected.')
    liveDot.style.display = 'none'
    stopStreaming()
  }

  pc.onicecandidate = ({ candidate }) => {
    if (candidate && viewerSocketId) {
      socket.emit('ice', { to: viewerSocketId, candidate })
    }
  }

  pc.oniceconnectionstatechange = () => {
    console.log('[Host] ICE:', pc.iceConnectionState)
  }

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  socket.emit('offer', { to: viewerSocketId, sdp: pc.localDescription })
  console.log('[Host] offer sent')
}

function startStreaming() {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const ctx = canvas.getContext('2d')
  const video = window._captureVideo

  streamInterval = setInterval(() => {
    if (!videoChannel || videoChannel.readyState !== 'open') return
    if (videoChannel.bufferedAmount > 512 * 1024) return

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
      })
    }, 'image/jpeg', 0.7)
  }, 50)
}

function stopStreaming() {
  if (streamInterval) { clearInterval(streamInterval); streamInterval = null }
  // Restore window when streaming stops
  if (window.hostAPI?.restoreWindow) {
    window.hostAPI.restoreWindow()
  }
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
