// --- CONFIGURATION ---
const WORKER_URL = "https://parsing-live-backend.YOUR_SUBDOMAIN.workers.dev";
const PAYSTACK_PUBLIC_KEY = "pk_test_327c7c43a2772631b3dc0da408f9a004f0432c0d";
const FREE_TIER_LIMIT_SECONDS = 3600;

const currentPage = window.location.pathname.split('/').pop();
const urlParams = new URLSearchParams(window.location.search);

// Global State
let currentUser = {
    name: "You",
    email: null,
    id: null,
    isPremium: false
};
let isHandRaised = false;
let isScreenSharing = false;
let localStream = null;
let screenStream = null;
let peerConnections = {};
let roomName = null;
let participantId = null;

// --- WHITEBOARD STATE ---
let whiteboardState = {
    isDrawing: false,
    color: '#F05090',
    size: 3,
    tool: 'pen', // 'pen', 'line', 'rectangle', 'circle'
    startX: 0,
    startY: 0,
    history: [],
    historyIndex: -1
};

if (currentPage === 'index.html' || currentPage === '' || currentPage === '/') {
    initLandingPage();
} else if (currentPage === 'live.html') {
    initLiveRoom();
}

// ==========================================
// 1. LANDING PAGE LOGIC
// ==========================================
function initLandingPage() {
    const startBtn = document.getElementById('start-room-btn');
    const roomInput = document.getElementById('room-name-input');
    const emailInput = document.getElementById('user-email-input');
    const nameInput = document.getElementById('user-name-input');
    const premiumBtn = document.getElementById('show-paystack-btn');
    const premiumModal = document.getElementById('premium-modal');
    const closePremiumModal = document.getElementById('close-premium-modal');
    const premiumForm = document.getElementById('premium-details-form');

    if(startBtn) {
        startBtn.addEventListener('click', async () => {
            const userEmail = emailInput.value.trim();
            const userName = nameInput.value.trim() || userEmail.split('@')[0];
            
            if(!userEmail) {
                alert("Please enter your email address.");
                return;
            }
            
            let roomName = roomInput.value.trim() || 'parsing-' + Math.random().toString(36).substring(2, 8);
            roomName = roomName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

            try {
                // Create room
                const createResponse = await fetch(`${WORKER_URL}/create-room`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ roomName, hostEmail: userEmail, hostName: userName })
                });
                const createData = await createResponse.json();
                
                if (!createData.success) {
                    alert(createData.message || "Failed to create room. It may already exist.");
                    return;
                }

                // Join room
                const joinResponse = await fetch(`${WORKER_URL}/join-room`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ roomName, userEmail, userName })
                });
                const joinData = await joinResponse.json();
                
                if (!joinData.success) {
                    if (joinData.requiresPremium) {
                        alert("Room is at capacity. Upgrade to Premium to join.");
                        return;
                    }
                    alert(joinData.message || "Failed to join room.");
                    return;
                }

                window.location.href = `live.html?room=${roomName}&email=${encodeURIComponent(userEmail)}&name=${encodeURIComponent(userName)}&pid=${joinData.participantId}`;
            } catch (error) {
                console.error('Error creating room:', error);
                alert("Failed to create room. Please try again.");
            }
        });
    }

    if(premiumBtn) premiumBtn.addEventListener('click', () => {
        document.getElementById('premium-email').value = emailInput.value.trim();
        premiumModal.classList.remove('hidden');
    });
    if(closePremiumModal) closePremiumModal.addEventListener('click', () => premiumModal.classList.add('hidden'));

    if(premiumForm) {
        premiumForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('premium-name').value.trim();
            const email = document.getElementById('premium-email').value.trim();
            premiumModal.classList.add('hidden');
            triggerPaystack(email, name);
        });
    }
}

// ==========================================
// 2. LIVE ROOM LOGIC
// ==========================================
function initLiveRoom() {
    roomName = urlParams.get('room');
    const userEmail = urlParams.get('email');
    const userName = urlParams.get('name') || userEmail.split('@')[0];
    const isBlocked = urlParams.get('blocked');
    participantId = urlParams.get('pid');

    currentUser.email = userEmail;
    currentUser.name = userName;

    // Update UI with user name
    document.querySelector('#local-video-tile .participant-name').textContent = userName;

    // Share Button
    const shareBtn = document.getElementById('share-room-btn');
    if(shareBtn) {
        shareBtn.addEventListener('click', () => {
            const shareUrl = `${window.location.origin}/live.html?room=${roomName}`;
            navigator.clipboard.writeText(shareUrl).then(() => showToast('Link copied to clipboard!'));
        });
    }

    // Paywalls
    if (isBlocked === 'true') {
        document.getElementById('capacity-modal').classList.remove('hidden');
        document.getElementById('upgrade-from-capacity-btn').addEventListener('click', () => {
            document.getElementById('capacity-modal').classList.add('hidden');
            if(userEmail) triggerPaystack(userEmail, userName);
        });
    }
    document.getElementById('upgrade-from-timeout-btn').addEventListener('click', () => {
        if(userEmail) triggerPaystack(userEmail, userName);
    });

    // --- JOIN FLOW ---
    if (!userEmail) {
        document.getElementById('join-prompt-modal').classList.remove('hidden');
        document.getElementById('join-room-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('join-name').value.trim();
            const email = document.getElementById('join-email').value.trim();
            currentUser.name = name;
            currentUser.email = email;
            document.querySelector('#local-video-tile .participant-name').textContent = name;

            const response = await fetch(`${WORKER_URL}/join-room`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ roomName, userEmail: email, userName: name })
            });
            const data = await response.json();
            if (!data.success) {
                document.getElementById('join-prompt-modal').classList.add('hidden');
                if (data.requiresPremium) {
                    document.getElementById('capacity-modal').classList.remove('hidden');
                }
                return;
            }
            participantId = data.participantId;
            document.getElementById('join-prompt-modal').classList.add('hidden');
            startRoomSession(roomName, email);
        });
    } else {
        startRoomSession(roomName, userEmail);
    }

    // Whiteboard controls
    initWhiteboard();
    
    // Screen sharing controls
    document.getElementById('btn-screen-share').addEventListener('click', toggleScreenShare);
}

function startRoomSession(roomName, userEmail) {
    startCountdownTimer();
    initWebRTC();
    setupControls();
    setupChat();
    pollRoomState();
}

// ==========================================
// 3. WEBRTC
// ==========================================
async function initWebRTC() {
    const localVideo = document.getElementById('local-video');
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            }, 
            audio: true 
        });
        localVideo.srcObject = localStream;
        
        // Create peer connections for existing participants
        const roomState = await getRoomState();
        roomState.participants.forEach(p => {
            if (p.id !== participantId) {
                createPeerConnection(p.id);
            }
        });
    } catch (error) {
        console.error('Camera/Mic access denied:', error);
        alert("Camera/Mic access is required for video conferencing.");
    }
}

function createPeerConnection(remoteId) {
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });
    
    peerConnections[remoteId] = pc;
    
    // Add local stream
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }
    
    // Handle remote stream
    pc.ontrack = (event) => {
        const remoteVideo = document.createElement('video');
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        remoteVideo.id = `remote-video-${remoteId}`;
        remoteVideo.srcObject = event.streams[0];
        
        // Create or update video tile
        let tile = document.getElementById(`tile-${remoteId}`);
        if (!tile) {
            tile = createVideoTile(remoteId);
            document.getElementById('remote-videos-container').appendChild(tile);
        }
        tile.querySelector('video').srcObject = event.streams[0];
    };
    
    // Create offer
    pc.createOffer().then(offer => {
        return pc.setLocalDescription(offer);
    }).then(() => {
        // Send offer to signaling server
        sendSignaling(remoteId, {
            type: 'offer',
            sdp: pc.localDescription
        });
    });
    
    return pc;
}

function sendSignaling(remoteId, data) {
    // In production, send via WebSocket or Durable Object
    // For now, use HTTP polling
    fetch(`${WORKER_URL}/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            roomName,
            participantId,
            remoteId,
            signal: data
        })
    }).catch(console.error);
}

// ==========================================
// 4. CONTROLS
// ==========================================
function setupControls() {
    const btnMic = document.getElementById('btn-mic');
    const btnCam = document.getElementById('btn-cam');
    const btnHand = document.getElementById('btn-hand');
    const btnChatToggle = document.getElementById('btn-chat-toggle');
    const btnLeave = document.getElementById('btn-leave');
    const localTile = document.getElementById('local-video-tile');

    // Mic Toggle
    if(btnMic) btnMic.addEventListener('click', () => {
        if(localStream) {
            const track = localStream.getAudioTracks()[0];
            track.enabled = !track.enabled;
            btnMic.classList.toggle('active');
            
            // Update participant state
            updateParticipantState({ audioEnabled: track.enabled });
            
            // Show mute indicator
            const micStatus = localTile.querySelector('.status-badge.mic-status');
            if (micStatus) {
                micStatus.textContent = track.enabled ? '🎤' : '🔇';
                micStatus.className = `status-badge mic-status${track.enabled ? '' : ' muted'}`;
            }
        }
    });

    // Camera Toggle
    if(btnCam) btnCam.addEventListener('click', () => {
        if(localStream) {
            const track = localStream.getVideoTracks()[0];
            track.enabled = !track.enabled;
            btnCam.classList.toggle('active');
            
            // Update participant state
            updateParticipantState({ videoEnabled: track.enabled });
            
            // Toggle Camera Off Overlay
            const camOffIndicator = localTile.querySelector('.camera-off-indicator');
            if (!track.enabled) {
                camOffIndicator.classList.remove('hidden');
            } else {
                camOffIndicator.classList.add('hidden');
            }
        }
    });

    // Hand Raise Toggle
    if(btnHand) btnHand.addEventListener('click', () => {
        isHandRaised = !isHandRaised;
        btnHand.classList.toggle('active');
        const handIndicator = localTile.querySelector('.hand-raised-indicator');
        if (isHandRaised) {
            handIndicator.classList.remove('hidden');
            addChatMessage("system", `${currentUser.name} raised their hand ✋`);
        } else {
            handIndicator.classList.add('hidden');
            addChatMessage("system", `${currentUser.name} lowered their hand`);
        }
        updateParticipantState({ handRaised: isHandRaised });
    });

    // Chat Toggle
    if(btnChatToggle) btnChatToggle.addEventListener('click', () => {
        document.getElementById('chat-panel').classList.toggle('hidden');
        btnChatToggle.classList.toggle('active');
    });

    // Close Chat Button
    document.getElementById('close-chat-btn').addEventListener('click', () => {
        document.getElementById('chat-panel').classList.add('hidden');
        btnChatToggle.classList.remove('active');
    });

    // Leave
    if(btnLeave) btnLeave.addEventListener('click', leaveRoom);
}

function leaveRoom() {
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (screenStream) screenStream.getTracks().forEach(track => track.stop());
    
    // Notify server
    fetch(`${WORKER_URL}/leave-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, participantId })
    }).catch(console.error);
    
    window.location.href = 'index.html';
}

// ==========================================
// 5. CHAT
// ==========================================
function setupChat() {
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-chat-btn');

    const sendMessage = () => {
        const text = chatInput.value.trim();
        if (!text) return;
        
        const timestamp = new Date().toLocaleTimeString();
        addChatMessage("sent", text, timestamp);
        chatInput.value = '';
        
        // Broadcast chat message via signaling
        broadcastChatMessage(text);
    };

    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
}

function addChatMessage(type, text, timestamp) {
    const messagesContainer = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    
    const timeStr = timestamp || new Date().toLocaleTimeString();
    
    if (type === 'system') {
        msgDiv.className = 'chat-message system-msg';
        msgDiv.textContent = text;
    } else if (type === 'sent') {
        msgDiv.className = 'chat-message sent';
        msgDiv.innerHTML = `${text} <span class="msg-time">${timeStr}</span>`;
    } else {
        msgDiv.className = 'chat-message received';
        msgDiv.innerHTML = `<strong>${type}</strong>: ${text} <span class="msg-time">${timeStr}</span>`;
    }
    
    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function broadcastChatMessage(text) {
    // In production, send via WebSocket/DataChannel
    // For now, store in room state
    fetch(`${WORKER_URL}/send-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            roomName,
            participantId,
            message: text,
            sender: currentUser.name
        })
    }).catch(console.error);
}

// ==========================================
// 6. SCREEN SHARING
// ==========================================
async function toggleScreenShare() {
    const btn = document.getElementById('btn-screen-share');
    
    if (!isScreenSharing) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'always' },
                audio: true
            });
            
            isScreenSharing = true;
            btn.classList.add('active');
            
            // Add screen track to all peer connections
            const screenTrack = screenStream.getVideoTracks()[0];
            Object.values(peerConnections).forEach(pc => {
                pc.addTrack(screenTrack, screenStream);
            });
            
            // Show screen share indicator
            const localTile = document.getElementById('local-video-tile');
            const statusBadge = document.createElement('div');
            statusBadge.className = 'status-badge screen-sharing';
            statusBadge.textContent = '🖥️';
            statusBadge.title = 'Sharing screen';
            localTile.querySelector('.participant-status').appendChild(statusBadge);
            
            // Update server
            await fetch(`${WORKER_URL}/share-screen`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomName, participantId, streamId: 'screen' })
            });
            
            // Show screen share for others
            const screenContainer = document.getElementById('shared-screen-container');
            screenContainer.classList.add('active');
            const screenVideo = document.getElementById('shared-screen-video');
            screenVideo.srcObject = screenStream;
            
            screenTrack.onended = () => {
                stopScreenShare();
            };
            
        } catch (error) {
            console.error('Screen sharing failed:', error);
            alert('Screen sharing failed. Please try again.');
        }
    } else {
        stopScreenShare();
    }
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    isScreenSharing = false;
    const btn = document.getElementById('btn-screen-share');
    btn.classList.remove('active');
    
    // Remove screen share indicator
    const localTile = document.getElementById('local-video-tile');
    const statusBadge = localTile.querySelector('.status-badge.screen-sharing');
    if (statusBadge) statusBadge.remove();
    
    // Hide screen share container
    document.getElementById('shared-screen-container').classList.remove('active');
    
    // Update server
    fetch(`${WORKER_URL}/stop-screen-share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, participantId })
    }).catch(console.error);
}

// ==========================================
// 7. WHITEBOARD
// ==========================================
function initWhiteboard() {
    const container = document.getElementById('whiteboard-container');
    const canvas = document.getElementById('whiteboard-canvas');
    const ctx = canvas.getContext('2d');
    const toolbar = document.querySelector('.whiteboard-toolbar');
    
    // Setup canvas size
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    function resizeCanvas() {
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width - 20;
        canvas.height = rect.height - 20;
        restoreWhiteboard();
    }
    
    // Toolbar buttons
    document.getElementById('wb-pen').addEventListener('click', () => {
        whiteboardState.tool = 'pen';
        toolbar.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        document.getElementById('wb-pen').classList.add('active');
    });
    
    document.getElementById('wb-line').addEventListener('click', () => {
        whiteboardState.tool = 'line';
        toolbar.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        document.getElementById('wb-line').classList.add('active');
    });
    
    document.getElementById('wb-rectangle').addEventListener('click', () => {
        whiteboardState.tool = 'rectangle';
        toolbar.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        document.getElementById('wb-rectangle').classList.add('active');
    });
    
    document.getElementById('wb-circle').addEventListener('click', () => {
        whiteboardState.tool = 'circle';
        toolbar.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        document.getElementById('wb-circle').classList.add('active');
    });
    
    document.getElementById('wb-color').addEventListener('change', (e) => {
        whiteboardState.color = e.target.value;
    });
    
    document.getElementById('wb-size').addEventListener('input', (e) => {
        whiteboardState.size = parseInt(e.target.value);
    });
    
    document.getElementById('wb-clear').addEventListener('click', () => {
        if (confirm('Clear the whiteboard?')) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            whiteboardState.history = [];
            whiteboardState.historyIndex = -1;
            saveWhiteboard();
        }
    });
    
    document.getElementById('wb-undo').addEventListener('click', undoWhiteboard);
    document.getElementById('wb-redo').addEventListener('click', redoWhiteboard);
    document.getElementById('wb-close').addEventListener('click', () => {
        container.classList.remove('active');
    });
    
    // Drawing events
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    
    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        whiteboardState.startX = (e.clientX - rect.left) * (canvas.width / rect.width);
        whiteboardState.startY = (e.clientY - rect.top) * (canvas.height / rect.height);
        lastX = whiteboardState.startX;
        lastY = whiteboardState.startY;
        isDrawing = true;
        
        if (whiteboardState.tool === 'pen') {
            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
        }
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (!isDrawing) return;
        
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (canvas.height / rect.height);
        
        ctx.strokeStyle = whiteboardState.color;
        ctx.lineWidth = whiteboardState.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        if (whiteboardState.tool === 'pen') {
            ctx.lineTo(x, y);
            ctx.stroke();
        } else {
            // For shapes, redraw from start
            const startX = whiteboardState.startX;
            const startY = whiteboardState.startY;
            
            // Clear and redraw current shape
            restoreWhiteboard();
            ctx.strokeStyle = whiteboardState.color;
            ctx.lineWidth = whiteboardState.size;
            
            ctx.beginPath();
            if (whiteboardState.tool === 'line') {
                ctx.moveTo(startX, startY);
                ctx.lineTo(x, y);
            } else if (whiteboardState.tool === 'rectangle') {
                ctx.rect(startX, startY, x - startX, y - startY);
            } else if (whiteboardState.tool === 'circle') {
                const radius = Math.sqrt(Math.pow(x - startX, 2) + Math.pow(y - startY, 2));
                ctx.arc(startX, startY, radius, 0, Math.PI * 2);
            }
            ctx.stroke();
        }
        
        lastX = x;
        lastY = y;
    });
    
    canvas.addEventListener('mouseup', () => {
        if (isDrawing) {
            isDrawing = false;
            // Save to history
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            whiteboardState.history = whiteboardState.history.slice(0, whiteboardState.historyIndex + 1);
            whiteboardState.history.push(imageData);
            whiteboardState.historyIndex++;
            saveWhiteboard();
        }
    });
    
    canvas.addEventListener('mouseleave', () => {
        if (isDrawing) {
            isDrawing = false;
            restoreWhiteboard();
        }
    });
    
    // Toggle whiteboard
    document.getElementById('btn-whiteboard').addEventListener('click', () => {
        container.classList.toggle('active');
        if (container.classList.contains('active')) {
            resizeCanvas();
            loadWhiteboard();
        }
    });
}

function saveWhiteboard() {
    const canvas = document.getElementById('whiteboard-canvas');
    const data = canvas.toDataURL();
    
    fetch(`${WORKER_URL}/save-whiteboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, data })
    }).catch(console.error);
}

function loadWhiteboard() {
    fetch(`${WORKER_URL}/get-whiteboard?room=${roomName}`)
        .then(res => res.json())
        .then(data => {
            if (data && data.data) {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.getElementById('whiteboard-canvas');
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                };
                img.src = data.data;
            }
        })
        .catch(console.error);
}

function restoreWhiteboard() {
    const canvas = document.getElementById('whiteboard-canvas');
    const ctx = canvas.getContext('2d');
    if (whiteboardState.historyIndex >= 0 && whiteboardState.history[whiteboardState.historyIndex]) {
        ctx.putImageData(whiteboardState.history[whiteboardState.historyIndex], 0, 0);
    }
}

function undoWhiteboard() {
    if (whiteboardState.historyIndex > 0) {
        whiteboardState.historyIndex--;
        restoreWhiteboard();
        saveWhiteboard();
    }
}

function redoWhiteboard() {
    if (whiteboardState.historyIndex < whiteboardState.history.length - 1) {
        whiteboardState.historyIndex++;
        restoreWhiteboard();
        saveWhiteboard();
    }
}

// ==========================================
// 8. ROOM STATE POLLING
// ==========================================
function pollRoomState() {
    setInterval(async () => {
        try {
            const state = await getRoomState();
            updateParticipants(state.participants);
        } catch (error) {
            console.error('Polling error:', error);
        }
    }, 3000);
}

async function getRoomState() {
    const response = await fetch(`${WORKER_URL}/get-room-state?room=${roomName}`);
    return response.json();
}

function updateParticipants(participants) {
    const container = document.getElementById('remote-videos-container');
    const currentTiles = container.children;
    const currentIds = Array.from(currentTiles).map(tile => tile.dataset.participantId);
    
    const remoteIds = participants
        .filter(p => p.id !== participantId)
        .map(p => p.id);
    
    // Remove disconnected participants
    currentIds.forEach(id => {
        if (!remoteIds.includes(id)) {
            const tile = document.getElementById(`tile-${id}`);
            if (tile) tile.remove();
            if (peerConnections[id]) {
                peerConnections[id].close();
                delete peerConnections[id];
            }
        }
    });
    
    // Add new participants
    participants.forEach(p => {
        if (p.id !== participantId && !document.getElementById(`tile-${id}`)) {
            createVideoTile(p.id);
            // Establish peer connection
            createPeerConnection(p.id);
        }
    });
}

function createVideoTile(participantId) {
    const container = document.getElementById('remote-videos-container');
    const tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = `tile-${participantId}`;
    tile.dataset.participantId = participantId;
    
    tile.innerHTML = `
        <video id="remote-video-${participantId}" autoplay playsinline></video>
        <div class="camera-off-indicator hidden">
            <span class="icon-large">📷</span>
            <span class="icon-slash"></span>
            <span class="off-text">Camera Off</span>
        </div>
        <div class="hand-raised-indicator hidden">✋</div>
        <span class="participant-name">Participant</span>
        <div class="participant-status">
            <span class="status-badge mic-status">🎤</span>
        </div>
    `;
    
    container.appendChild(tile);
    return tile;
}

function updateParticipantState(updates) {
    fetch(`${WORKER_URL}/update-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, participantId, updates })
    }).catch(console.error);
}

// ==========================================
// 9. TIMER
// ==========================================
function startCountdownTimer() {
    let timeLeft = FREE_TIER_LIMIT_SECONDS;
    const timerDisplay = document.getElementById('countdown-timer');
    const timerInterval = setInterval(() => {
        timeLeft--;
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        if (timeLeft <= 300) timerDisplay.style.color = '#F05090';
        if (timeLeft <= 0) { 
            clearInterval(timerInterval); 
            cutOffCall(); 
        }
    }, 1000);
}

function cutOffCall() {
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (screenStream) screenStream.getTracks().forEach(track => track.stop());
    document.getElementById('timeout-modal').classList.remove('hidden');
    document.querySelectorAll('.control-btn').forEach(btn => btn.disabled = true);
}

// ==========================================
// 10. PAYSTACK
// ==========================================
function triggerPaystack(userEmail, userName) {
    const handler = PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: userEmail,
        amount: 29900,
        currency: 'ZAR',
        ref: 'PARSING_' + Date.now(),
        callback: function(response) { 
            verifyPremium(response.reference, userEmail, userName); 
        },
        onClose: function() {}
    });
    handler.openIframe();
}

async function verifyPremium(reference, email, name) {
    try {
        const res = await fetch(`${WORKER_URL}/verify-premium`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reference, userEmail: email, userName: name })
        });
        const data = await res.json();
        if(data.success) { 
            alert("🎉 Welcome to Parsing™ Live Premium!"); 
            window.location.reload();
        } else {
            alert("Payment verification failed. Please contact support.");
        }
    } catch (error) { 
        alert("Could not verify payment. Please contact support."); 
    }
}

// ==========================================
// 11. UTILITIES
// ==========================================
function showToast(message) {
    const toast = document.getElementById('toast-notification');
    toast.textContent = message || 'Link copied to clipboard!';
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ==========================================
// 12. KEYBOARD SHORTCUTS
// ==========================================
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'm') {
        document.getElementById('btn-mic').click();
        e.preventDefault();
    }
    if (e.ctrlKey && e.key === 'v') {
        document.getElementById('btn-cam').click();
        e.preventDefault();
    }
    if (e.ctrlKey && e.key === 'h') {
        document.getElementById('btn-hand').click();
        e.preventDefault();
    }
    if (e.ctrlKey && e.key === 'c') {
        document.getElementById('btn-chat-toggle').click();
        e.preventDefault();
    }
    if (e.ctrlKey && e.key === 's') {
        document.getElementById('btn-screen-share').click();
        e.preventDefault();
    }
    if (e.ctrlKey && e.key === 'w') {
        document.getElementById('btn-whiteboard').click();
        e.preventDefault();
    }
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            if (!modal.classList.contains('hidden')) {
                modal.classList.add('hidden');
            }
        });
        document.getElementById('whiteboard-container').classList.remove('active');
        document.getElementById('shared-screen-container').classList.remove('active');
    }
});

console.log('🎥 Parsing™ Live loaded successfully!');
console.log('📋 Shortcuts: Ctrl+M (Mic), Ctrl+V (Cam), Ctrl+H (Hand), Ctrl+C (Chat), Ctrl+S (Screen), Ctrl+W (Whiteboard), ESC (Close modals)');
