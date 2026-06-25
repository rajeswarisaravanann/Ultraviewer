// -- Socket ----------------------------------------------
const socket = io(window.SIGNALING_SERVER, {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  timeout: 20000,
});
let peerConnection = null;
let videoChannel = null;
let controlChannel = null;
let myId = null;
let myPassword = null;
let controllerSocketId = null;
let targetSocketId = null;
let currentRole = null;
let remoteScreenWidth = 1920;
let remoteScreenHeight = 1080;
let remoteDPR = 1;
let inputListenersBound = false;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
};

function log(...args) {
  console.log('[UV]', ...args);
}

function showSection(id) {
  const home = document.getElementById('home-screen');
  const controlled = document.getElementById('controlled-screen');
  const controller = document.getElementById('controller-screen');

  if (home) home.style.display = id === 'home-screen' ? 'flex' : 'none';
  if (controlled) controlled.style.display = id === 'controlled-screen' ? 'block' : 'none';
  if (controller) controller.style.display = id === 'controller-screen' ? 'block' : 'none';
}

function updateStatus(msg) {
  document.querySelectorAll('.status-text').forEach((el) => {
    el.textContent = msg;
  });
}

function showError(msg) {
  alert('[UltraViewer] ' + msg);
  console.error('[UV] Error:', msg);
  updateStatus(msg);
}

function generateId() {
  return Math.floor(100000000 + Math.random() * 900000000).toString();
}

function generatePassword() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function sendControl(obj) {
  const channel = controlChannel;
  if (channel && channel.readyState === 'open') {
    channel.send(JSON.stringify(obj));
  }
}

function updateControlledStatus(state) {
  const el = document.getElementById('controlled-status');
  if (!el) return;
  if (state === 'controller-connected') {
    el.textContent = 'Controller is viewing your screen.';
    el.style.color = '#4ade80';
  } else if (state === 'disconnected') {
    el.textContent = 'Controller disconnected.';
    el.style.color = '#f87171';
  } else {
    el.textContent = 'Waiting for controller to connect...';
    el.style.color = '#a4d5a4';
  }
}

socket.on('connect', () => {
  log('Socket connected:', socket.id);
  updateStatus('Connected to signaling server.');
  if (currentRole === 'controlled' && myId && myPassword) {
    log('Re-registering session after reconnect:', myId);
    socket.emit('register', { id: myId, password: myPassword });
  }
});

socket.on('reconnect_attempt', (attempt) => {
  log('Socket reconnect attempt:', attempt);
  updateStatus('Reconnecting...');
});

socket.on('reconnect', (attempt) => {
  log('Socket reconnected after attempt:', attempt);
  updateStatus('Reconnected to signaling server.');
});

socket.on('connect_error', (err) => {
  log('Socket connection error:', err);
  updateStatus('Connection error');
});

socket.on('disconnect', (reason) => {
  log('Socket disconnected:', reason);
  updateStatus('Disconnected. Trying to reconnect...');
});

socket.on('session-not-found', () => {
  showError('Session ID not found.');
});

socket.on('session-pending', ({ targetId }) => {
  updateStatus(`Session ${targetId} not found yet. Waiting for registration...`);
});

socket.on('wrong-password', () => {
  showError('Wrong password.');
});

socket.on('incoming-request', async ({ controllerSocketId: csId }) => {
  log('incoming-request from', csId);
  controllerSocketId = csId;
  if (!peerConnection) {
    peerConnection = new RTCPeerConnection(rtcConfig);
    setupControlledPeerHandlers();
  }
  await startWebRTCAsControlled();
});

socket.on('offer', async ({ sdp, from }) => {
  log('offer received from', from);
  await handleOffer(sdp, from);
});

socket.on('answer', async ({ sdp, from }) => {
  log('answer received from', from);
  if (peerConnection) {
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      updateStatus('Connection complete.');
    } catch (e) {
      showError('Failed to set remote description: ' + e.message);
    }
  }
});

socket.on('ice-candidate', async ({ candidate, from }) => {
  if (candidate && peerConnection) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.error('[UV] ICE error', e);
    }
  }
});

async function startSharing() {
  currentRole = 'controlled';
  updateStatus('Getting screen sources...');

  if (window.electronAPI?.hideControllerWindow) {
    window.electronAPI.hideControllerWindow();
  }

  let sources;
  try {
    sources = await window.electronAPI.getSources();
  } catch (e) {
    showError('Failed to get screen sources: ' + e.message);
    return;
  }

  if (!sources || sources.length === 0) {
    showError('No screen sources found.');
    return;
  }

  const source = sources.find((s) => {
    const name = String(s.name || '').toLowerCase();
    return (
      name.includes('entire screen') ||
      name.includes('screen 1') ||
      (name.includes('screen') && !name.includes('ultraviewer'))
    );
  }) || sources.find((s) => String(s.id || '').startsWith('screen:')) || sources[0];

  log('[UV] All sources:', sources.map((s) => s.name));
  log('[UV] Selected source:', source.name, source.id);

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: source.id,
          maxWidth: 1280,
          maxHeight: 720,
          maxFrameRate: 10,
        },
      },
    });
  } catch (e) {
    showError('getUserMedia failed: ' + e.message);
    return;
  }

  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.style.display = 'none';
  document.body.appendChild(video);
  window._hiddenVideo = video;

  try {
    await video.play();
  } catch (e) {
    console.error('[UV] video.play failed:', e);
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');

  window._screenStream = stream;

  peerConnection = new RTCPeerConnection(rtcConfig);
  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate && controllerSocketId) {
      socket.emit('ice-candidate', { targetId: controllerSocketId, candidate });
    }
  };
  peerConnection.oniceconnectionstatechange = () => {
    log('ICE state (controlled):', peerConnection.iceConnectionState);
    if (peerConnection.iceConnectionState === 'failed') {
      showError('Connection failed. Check network.');
    }
  };

  videoChannel = peerConnection.createDataChannel('video', {
    ordered: false,
    maxRetransmits: 0,
  });
  videoChannel.binaryType = 'arraybuffer';
  videoChannel.onopen = () => log('[UV] video channel open');
  videoChannel.onclose = () => log('[UV] video channel closed');

  controlChannel = peerConnection.createDataChannel('control', {
    ordered: true,
  });
  controlChannel.onopen = () => {
    log('[UV] control channel open');
    controlChannel.send(JSON.stringify({
      type: 'screen-size',
      width: screen.width,
      height: screen.height,
      physicalWidth: screen.width * window.devicePixelRatio,
      physicalHeight: screen.height * window.devicePixelRatio,
      dpr: window.devicePixelRatio,
    }));
  };
  controlChannel.onmessage = handleRemoteInput;
  controlChannel.onclose = () => updateControlledStatus('disconnected');

  window._streamInterval = setInterval(() => {
    if (!videoChannel || videoChannel.readyState !== 'open') return;
    if (videoChannel.bufferedAmount > 1024 * 1024) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      blob.arrayBuffer().then((buffer) => {
        try {
          videoChannel.send(buffer);
        } catch (e) {
          console.error('[UV] send error:', e.message);
        }
      });
    }, 'image/jpeg', 0.5);
  }, 100);

  myId = generateId();
  myPassword = generatePassword();
  document.getElementById('display-id').textContent = myId;
  document.getElementById('display-password').textContent = myPassword;
  showSection('controlled-screen');
  log('Registering session:', myId);
  socket.emit('register', { id: myId, password: myPassword });
  socket.once('registered', ({ id }) => {
    log('Server confirmed registration', id);
    updateStatus('Waiting for controller to connect...');
  });
}

function setupControlledPeerHandlers() {
  if (!peerConnection) return;
  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate && controllerSocketId) {
      socket.emit('ice-candidate', { targetId: controllerSocketId, candidate });
    }
  };
  peerConnection.oniceconnectionstatechange = () => {
    log('ICE state (controlled):', peerConnection.iceConnectionState);
    if (peerConnection.iceConnectionState === 'failed') {
      showError('Connection failed. Check network.');
    }
  };
}

async function startWebRTCAsControlled() {
  updateStatus('Controller connecting � creating offer...');
  if (!peerConnection) {
    showError('Peer connection missing');
    return;
  }

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', { targetId: controllerSocketId, sdp: peerConnection.localDescription });
    updateStatus('Offer sent. Waiting for answer...');
  } catch (e) {
    console.error('[UV] Failed to create/send offer', e);
    showError('Offer failed: ' + e.message);
  }
}

function connectToRemote() {
  const idInput = document.getElementById('remote-id');
  const passInput = document.getElementById('remote-password');
  const errorDiv = document.getElementById('connect-error');

  const targetId = idInput ? idInput.value.trim() : '';
  const password = passInput ? passInput.value.trim() : '';

  if (!targetId || targetId.length < 6) {
    if (errorDiv) {
      errorDiv.textContent = 'Please enter a valid Remote ID';
      errorDiv.style.display = 'block';
    }
    return;
  }

  if (!password || password.length < 4) {
    if (errorDiv) {
      errorDiv.textContent = 'Please enter the 4-digit password';
      errorDiv.style.display = 'block';
    }
    return;
  }

  if (errorDiv) {
    errorDiv.textContent = '';
    errorDiv.style.display = 'none';
  }

  currentRole = 'controller';
  document.getElementById('remote-display-id').textContent = targetId;
  const loader = document.getElementById('stream-loading');
  if (loader) loader.style.display = 'block';
  showSection('controller-screen');
  updateStatus('Connecting...');
  socket.emit('connect-request', { targetId, password });
}

async function handleOffer(sdp, from) {
  targetSocketId = from;
  peerConnection = new RTCPeerConnection(rtcConfig);

  peerConnection.ondatachannel = (event) => {
    const channel = event.channel;
    if (channel.label === 'video') {
      videoChannel = channel;
      videoChannel.binaryType = 'arraybuffer';
      videoChannel.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
          renderFrame(e.data);
        }
      };
      videoChannel.onopen = () => {
        log('[UV] video channel open (controller)');
      };
      videoChannel.onclose = () => {
        log('[UV] video channel closed (controller)');
      };
      return;
    }

    if (channel.label === 'control') {
      controlChannel = channel;
      controlChannel.onopen = () => {
        log('[UV] control channel open');
        setupInputCapture();
      };
      controlChannel.onmessage = handleDataMessage;
      controlChannel.onclose = () => log('[UV] control channel closed (controller)');
    }
  };

  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate && from) {
      socket.emit('ice-candidate', { targetId: from, candidate });
    }
  };
  peerConnection.oniceconnectionstatechange = () => {
    log('ICE state (controller):', peerConnection.iceConnectionState);
  };

  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { targetId: from, sdp: peerConnection.localDescription });
  } catch (e) {
    console.error('[UV] Handshake error', e);
    showError('Handshake failed: ' + e.message);
  }
}

function handleDataMessage(event) {
  try {
    const msg = JSON.parse(event.data);
    if (msg.type === 'screen-size') {
      remoteScreenWidth = msg.physicalWidth || msg.width;
      remoteScreenHeight = msg.physicalHeight || msg.height;
      remoteDPR = msg.dpr || 1;
      return;
    }
    if (msg.type === 'pong') {
      const el = document.getElementById('ping-display');
      if (el) el.textContent = 'Ping: ' + (Date.now() - msg.timestamp) + ' ms';
      return;
    }
  } catch (e) {
    console.error('[UV] DataChannel message parse error:', e);
  }
}

function renderFrame(arrayBuffer) {
  const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  const img = document.getElementById('remote-video-img');
  if (!img) return;
  const oldUrl = img.src;
  img.src = url;
  img.onload = () => {
    if (oldUrl) URL.revokeObjectURL(oldUrl);
  };
  const loader = document.getElementById('stream-loading');
  if (loader) loader.style.display = 'none';
}

function setupInputCapture() {
  if (inputListenersBound) return;
  inputListenersBound = true;

  const img = document.getElementById('remote-video-img');
  if (!img) return;

  img.addEventListener('mousemove', (e) => {
    if (!remoteScreenWidth || !remoteScreenHeight) return;
    const rect = img.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * (remoteScreenWidth / rect.width));
    const y = Math.round((e.clientY - rect.top) * (remoteScreenHeight / rect.height));
    sendControl({ type: 'mousemove', x, y });
  });

  img.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const button = e.button === 2 ? 'right' : 'left';
    sendControl({ type: 'mousedown', button });
  });

  img.addEventListener('mouseup', (e) => {
    e.preventDefault();
    const button = e.button === 2 ? 'right' : 'left';
    sendControl({ type: 'mouseup', button });
  });

  img.addEventListener('dblclick', (e) => {
    e.preventDefault();
    sendControl({ type: 'dblclick', button: 'left' });
  });

  img.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  document.addEventListener('keydown', (e) => {
    if (!e.repeat) {
      sendControl({ type: 'key', key: e.key, action: 'down' });
    }
  });

  document.addEventListener('keyup', (e) => {
    sendControl({ type: 'key', key: e.key, action: 'up' });
  });

  setInterval(() => {
    sendControl({ type: 'ping', timestamp: Date.now() });
  }, 2000);
}

function handleRemoteInput(event) {
  try {
    const msg = JSON.parse(event.data);
    if (msg.type === 'mousemove') {
      window.electronAPI.injectMouseMove(msg.x, msg.y);
      return;
    }
    if (msg.type === 'mousedown') {
      window.electronAPI.injectMouseClick(msg.button, 'down');
      return;
    }
    if (msg.type === 'mouseup') {
      window.electronAPI.injectMouseClick(msg.button, 'up');
      return;
    }
    if (msg.type === 'dblclick') {
      window.electronAPI.injectMouseClick(msg.button, 'double');
      return;
    }
    if (msg.type === 'key') {
      window.electronAPI.injectKey(msg.key, msg.action);
      return;
    }
    if (msg.type === 'ping' && controlChannel && controlChannel.readyState === 'open') {
      controlChannel.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
    }
  } catch (e) {
    console.error('[UV] Input parse error:', e);
  }
}

function disconnect() {
  if (window._streamInterval) {
    clearInterval(window._streamInterval);
    window._streamInterval = null;
  }
  if (window._screenStream) {
    window._screenStream.getTracks().forEach((track) => track.stop());
    window._screenStream = null;
  }
  if (window._hiddenVideo) {
    window._hiddenVideo.pause();
    window._hiddenVideo.srcObject = null;
    window._hiddenVideo.remove();
    window._hiddenVideo = null;
  }
  if (videoChannel) {
    videoChannel.close();
    videoChannel = null;
  }
  if (controlChannel) {
    controlChannel.close();
    controlChannel = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  controllerSocketId = null;
  targetSocketId = null;
  currentRole = null;
  updateControlledStatus('disconnected');
  const loader = document.getElementById('stream-loading');
  if (loader) loader.style.display = 'none';
  const overlay = document.getElementById('remote-overlay');
  if (overlay) overlay.style.display = 'grid';
  socket.emit('leave-session');
  resetHomeSession();
  showSection('home-screen');
  updateStatus('Disconnected.');
}

function resetHomeSession() {
  myId = generateId();
  myPassword = generatePassword();
  const homeId = document.getElementById('home-id');
  const homePassword = document.getElementById('home-password');
  if (homeId) homeId.textContent = myId;
  if (homePassword) homePassword.textContent = myPassword;
}

window.addEventListener('DOMContentLoaded', () => {
  resetHomeSession();
  showSection('home-screen');

  const startShareButton = document.getElementById('start-share-button');
  const connectButton = document.getElementById('connect-button');
  const stopShareButton = document.getElementById('stop-share-button');
  const disconnectButton = document.getElementById('disconnect-button');
  const remotePasswordInput = document.getElementById('remote-password');

  if (startShareButton) {
    startShareButton.addEventListener('click', startSharing);
  }
  if (connectButton) {
    connectButton.addEventListener('click', connectToRemote);
  }
  if (remotePasswordInput) {
    remotePasswordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') connectToRemote();
    });
  }
  if (stopShareButton) {
    stopShareButton.addEventListener('click', disconnect);
  }
  if (disconnectButton) {
    disconnectButton.addEventListener('click', disconnect);
  }
});
