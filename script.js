// --- CONFIGURATION ---
const WORKER_URL = "https://parsing-live-backend.YOUR_SUBDOMAIN.workers.dev";
const PAYSTACK_PUBLIC_KEY = "pk_test_327c7c43a2772631b3dc0da408f9a004f0432c0d";
const FREE_TIER_LIMIT_SECONDS = 3600;

const currentPage = window.location.pathname.split('/').pop();
const urlParams = new URLSearchParams(window.location.search);

// Global State
let currentUser = { name: "You", email: null, id: null, isPremium: false };
let isHandRaised = false;
let isScreenSharing = false;
let localStream = null;
let screenStream = null;
let peerConnections = {};
let roomName = null;
let participantId = null;

// Whiteboard State
let whiteboardState = {
    isDrawing: false,
    color: '#F05090',
    size: 3,
    tool: 'pen',
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

    if (startBtn) {
        startBtn.addEventListener('click', async () => {
            const userEmail = emailInput.value.trim();
            const userName = nameInput.value.trim() || userEmail.split('@')[0];
            if (!userEmail) {
                alert("Please enter your email address.");
                return;
            }
            let room = roomInput.value.trim() || 'parsing-' + Math.random().toString(36).substring(2, 8);
            room = room.toLowerCase().replace(/[^a-z0-9-]/g, '-');

            try {
                const joinResponse = await fetch(`${WORKER_URL}/join-room`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ roomName: room, userEmail, userName })
                });
                const joinData = await joinResponse.json();

                if (!joinData.allowed) {
                    if (joinData.requiresPremium) {
                        alert("Room is at capacity. Upgrade to Premium to join.");
                        return;
                    }
                    alert(joinData.message || "Failed to join room.");
                    return;
                }
                window.location.href = `live.html?room=${room}&email=${encodeURIComponent(userEmail)}&name=${encodeURIComponent(userName)}&pid=${joinData.participantId || 'self'}`;
            } catch (error) {
                console.error('Error:', error);
                alert("Failed to create room. Please try again.");
            }
        });
    }

    if (premiumBtn) premiumBtn.addEventListener('click', () => {
        document.getElementById('premium-email').value = emailInput.value.trim();
        premiumModal.classList.remove('hidden');
    });
    if (closePremiumModal) closePremiumModal.addEventListener('click', () => premiumModal.classList.add('hidden'));
    if (premiumForm) {
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
    const userName = urlParams.get('name') || (userEmail ? userEmail.split('@')[0] : 'Guest');
    const isBlocked = urlParams.get('blocked');
    participantId = urlParams.get('pid');

    currentUser.email = userEmail;
    currentUser.name = userName;

    const nameEl = document.querySelector('#local-video-tile .participant-name');
    if (nameEl) nameEl.textContent = userName;

    // Share button
    const shareBtn = document.getElementById('share-room-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', () => {
            const shareUrl = `${window.location.origin}/live.html?room=${roomName}`;
            navigator.clipboard.writeText(shareUrl).then(() => showToast('Link copied to clipboard!'));
        });
    }

    // Paywalls
    if (isBlocked === 'true') {
        const capModal = document.getElementById('capacity-modal');
        if (capModal) {
            capModal.classList.remove('hidden');
            const upgradeBtn = document.getElementById('upgrade-from-capacity-btn');
            if (upgradeBtn) upgradeBtn.addEventListener('click', () => {
                capModal.classList.add('hidden');
                if (userEmail) triggerPaystack(userEmail, userName);
            });
        }
    }
    const timeoutUpgrade = document.getElementById('upgrade-from-timeout-btn');
    if (timeoutUpgrade) {
        timeoutUpgrade.addEventListener('click', () => {
            if (userEmail) triggerPaystack(userEmail, userName);
        });
    }

    // Join flow for shared links
    if (!userEmail) {
        const joinModal = document.getElementById('join-prompt-modal');
        if (joinModal) {
            joinModal.classList.remove('hidden');
            const joinForm = document.getElementById('join-room-form');
            if (joinForm) {
                joinForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const name = document.getElementById('join-name').value.trim();
                    const email = document.getElementById('join-email').value.trim();
                    currentUser.name = name;
                    currentUser.email = email;
                    const nameEl = document.querySelector('#local-video-tile .participant-name');
                    if (nameEl) nameEl.textContent = name;

                    try {
                        const response = await fetch(`${WORKER_URL}/join-room`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ roomName, userEmail: email, userName: name })
                        });
                        const data = await response.json();
                        if (!data.allowed) {
                            joinModal.classList.add('hidden');
                            if (data.requiresPremium) {
                                const capModal = document.getElementById('capacity-modal');
                                if (capModal) capModal.classList.remove('hidden');
                            }
                            return;
                        }
                        participantId = data.participantId;
                        joinModal.classList.add('hidden');
                        startRoomSession(roomName, email);
                    } catch (err) {
                        alert("Could not join room.");
                    }
                });
            }
        }
    } else {
        startRoomSession(roomName, userEmail);
    }

    // Initialize features
    initWhiteboard();
    const screenBtn = document.getElementById('btn-screen-share');
    if (screenBtn) screenBtn.addEventListener('click', toggleScreenShare);
}

function startRoomSession(room, email) {
    startCountdownTimer();
    initWebRTC();
    setupControls();
    setupChat();
}

// ==========================================
// 3. WEBRTC
// ==========================================
async function initWebRTC() {
    const localVideo = document.getElementById('local-video');
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
            audio: true
        });
        localVideo.srcObject = localStream;
    } catch (error) {
        console.error('Camera/Mic access denied:', error);
        alert("Camera/Mic access is required for video conferencing.");
    }
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

    if (btnMic) btnMic.addEventListener('click', () => {
        if (localStream) {
            const track = localStream.getAudioTracks()[0];
            track.enabled = !track.enabled;
            btnMic.classList.toggle('active');
            const micStatus = localTile.querySelector('.status-badge.mic-status');
            if (micStatus) {
                micStatus.textContent = track.enabled ? '🎤' : '🔇';
                micStatus.className = `status-badge mic-status${track.enabled ? '' : ' muted'}`;
            }
        }
    });

    if (btnCam) btnCam.addEventListener('click', () => {
        if (localStream) {
            const track = localStream.getVideoTracks()[0];
            track.enabled = !track.enabled;
            btnCam.classList.toggle('active');
            const camOffIndicator = localTile.querySelector('.camera-off-indicator');
            if (camOffIndicator) {
                if (!track.enabled) camOffIndicator.classList.remove('hidden');
                else camOffIndicator.classList.add('hidden');
            }
        }
    });

    if (btnHand) btnHand.addEventListener('click', () => {
        isHandRaised = !isHandRaised;
        btnHand.classList.toggle('active');
        const handIndicator = localTile.querySelector('.hand-raised-indicator');
        if (handIndicator) {
            if (isHandRaised) {
                handIndicator.classList.remove('hidden');
                addChatMessage("system", `${currentUser.name} raised their hand ✋`);
            } else {
                handIndicator.classList.add('hidden');
                addChatMessage("system", `${currentUser.name} lowered their hand`);
            }
        }
    });

    if (btnChatToggle) btnChatToggle.addEventListener('click', () => {
        const panel = document.getElementById('chat-panel');
        if (panel) panel.classList.toggle('hidden');
        btnChatToggle.classList.toggle('active');
    });

    const closeChatBtn = document.getElementById('close-chat-btn');
    if (closeChatBtn) closeChatBtn.addEventListener('click', () => {
        const panel = document.getElementById('chat-panel');
        if (panel) panel.classList.add('hidden');
        if (btnChatToggle) btnChatToggle.classList.remove('active');
    });

    if (btnLeave) btnLeave.addEventListener('click', leaveRoom);
}

function leaveRoom() {
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (screenStream) screenStream.getTracks().forEach(track => track.stop());
    window.location.href = 'index.html';
}

// ==========================================
// 5. CHAT
// ==========================================
function setupChat() {
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-chat-btn');
    if (!chatInput || !sendBtn) return;

    const sendMessage = () => {
        const text = chatInput.value.trim();
        if (!text) return;
        const timestamp = new Date().toLocaleTimeString();
        addChatMessage("sent", text, timestamp);
        chatInput.value = '';
    };
    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
}

function addChatMessage(type, text, timestamp) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;
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

            const screenContainer = document.getElementById('shared-screen-container');
            const screenVideo = document.getElementById('shared-screen-video');
            if (screenContainer && screenVideo) {
                screenContainer.classList.add('active');
                screenVideo.srcObject = screenStream;
            }

            screenStream.getVideoTracks()[0].onended = () => stopScreenShare();
        } catch (error) {
            console.error('Screen sharing failed:', error);
            alert('Screen sharing failed.');
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
    if (btn) btn.classList.remove('active');
    const screenContainer = document.getElementById('shared-screen-container');
    if (screenContainer) screenContainer.classList.remove('active');
}

// ==========================================
// 7. WHITEBOARD
// ==========================================
function initWhiteboard() {
    const container = document.getElementById('whiteboard-container');
    const canvas = document.getElementById('whiteboard-canvas');
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d');
    const toolbar = container.querySelector('.whiteboard-toolbar');

    function resizeCanvas() {
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width - 20;
        canvas.height = rect.height - 80;
        restoreWhiteboard();
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const toolBtns = ['wb-pen', 'wb-line', 'wb-rectangle', 'wb-circle'];
    toolBtns.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', () => {
            whiteboardState.tool = id.replace('wb-', '');
            toolbar.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    const colorPicker = document.getElementById('wb-color');
    if (colorPicker) colorPicker.addEventListener('change', (e) => { whiteboardState.color = e.target.value; });

    const sizeSlider = document.getElementById('wb-size');
    if (sizeSlider) sizeSlider.addEventListener('input', (e) => { whiteboardState.size = parseInt(e.target.value); });

    const clearBtn = document.getElementById('wb-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
        if (confirm('Clear the whiteboard?')) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            whiteboardState.history = [];
            whiteboardState.historyIndex = -1;
        }
    });

    const undoBtn = document.getElementById('wb-undo');
    if (undoBtn) undoBtn.addEventListener('click', undoWhiteboard);
    const redoBtn = document.getElementById('wb-redo');
    if (redoBtn) redoBtn.addEventListener('click', redoWhiteboard);

    const closeBtn = document.getElementById('wb-close');
    if (closeBtn) closeBtn.addEventListener('click', () => container.classList.remove('active'));

    let isDrawing = false;
    let lastX = 0, lastY = 0;

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
            restoreWhiteboard();
            ctx.beginPath();
            if (whiteboardState.tool === 'line') {
                ctx.moveTo(whiteboardState.startX, whiteboardState.startY);
                ctx.lineTo(x, y);
            } else if (whiteboardState.tool === 'rectangle') {
                ctx.rect(whiteboardState.startX, whiteboardState.startY, x - whiteboardState.startX, y - whiteboardState.startY);
            } else if (whiteboardState.tool === 'circle') {
                const radius = Math.sqrt(Math.pow(x - whiteboardState.startX, 2) + Math.pow(y - whiteboardState.startY, 2));
                ctx.arc(whiteboardState.startX, whiteboardState.startY, radius, 0, Math.PI * 2);
            }
            ctx.stroke();
        }
        lastX = x;
        lastY = y;
    });

    canvas.addEventListener('mouseup', () => {
        if (isDrawing) {
            isDrawing = false;
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            whiteboardState.history = whiteboardState.history.slice(0, whiteboardState.historyIndex + 1);
            whiteboardState.history.push(imageData);
            whiteboardState.historyIndex++;
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (isDrawing) { isDrawing = false; restoreWhiteboard(); }
    });

    const wbToggle = document.getElementById('btn-whiteboard');
    if (wbToggle) wbToggle.addEventListener('click', () => {
        container.classList.toggle('active');
        if (container.classList.contains('active')) resizeCanvas();
    });
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
    }
}
function redoWhiteboard() {
    if (whiteboardState.historyIndex < whiteboardState.history.length - 1) {
        whiteboardState.historyIndex++;
        restoreWhiteboard();
    }
}

// ==========================================
// 8. TIMER
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
    const modal = document.getElementById('timeout-modal');
    if (modal) modal.classList.remove('hidden');
    document.querySelectorAll('.control-btn').forEach(btn => btn.disabled = true);
}

// ==========================================
// 9. PAYSTACK
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
        if (data.success) {
            alert("🎉 Welcome to Parsing™ Live Premium!");
            window.location.reload();
        } else {
            alert("Payment verification failed.");
        }
    } catch (error) {
        alert("Could not verify payment.");
    }
}

// ==========================================
// 10. UTILITIES
// ==========================================
function showToast(message) {
    const toast = document.getElementById('toast-notification');
    if (!toast) return;
    toast.textContent = message || 'Link copied!';
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ==========================================
// 11. KEYBOARD SHORTCUTS (FIXED)
// ==========================================
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'm') {
        const btn = document.getElementById('btn-mic');
        if (btn) btn.click();
        e.preventDefault();
    }
    if (e.ctrlKey && e.key === 'v') {
        const btn = document.getElementById('btn-cam');
        if (btn) btn.click();
        e.preventDefault();
    }
    if (e.ctrlKey && e.key === 'h') {
        const btn = document.getElementById('btn-hand');
        if (btn) btn.click();
        e.preventDefault();
    }
    if (e.ctrlKey && e.key === 'c') {
        const btn = document.getElementById('btn-chat-toggle');
        if (btn) btn.click();
        e.preventDefault();
    }
    if (e.ctrlKey && e.key === 's') {
        const btn = document.getElementById('btn-screen-share');
        if (btn) btn.click();
        e.preventDefault();
    }
    if (e.ctrlKey && e.key === 'w') {
        const btn = document.getElementById('btn-whiteboard');
        if (btn) btn.click();
        e.preventDefault();
    }
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            if (!modal.classList.contains('hidden')) modal.classList.add('hidden');
        });
        const wb = document.getElementById('whiteboard-container');
        if (wb) wb.classList.remove('active');
        const ss = document.getElementById('shared-screen-container');
        if (ss) ss.classList.remove('active');
    }
});

console.log('🎥 Parsing™ Live loaded successfully!');
console.log('📋 Shortcuts: Ctrl+M (Mic), Ctrl+V (Cam), Ctrl+H (Hand), Ctrl+C (Chat), Ctrl+S (Screen), Ctrl+W (Whiteboard), ESC (Close)');
