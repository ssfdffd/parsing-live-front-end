// --- CONFIGURATION ---
const WORKER_URL = "https://parsing-live-backend.YOUR_SUBDOMAIN.workers.dev"; // REPLACE WITH YOUR WORKER URL
const PAYSTACK_PUBLIC_KEY = "pk_test_327c7c43a2772631b3dc0da408f9a004f0432c0d"; 
const FREE_TIER_LIMIT_SECONDS = 3600; 

const currentPage = window.location.pathname.split('/').pop();
const urlParams = new URLSearchParams(window.location.search);

// Global State
let currentUserName = "You";
let isHandRaised = false;

if (currentPage === 'index.html' || currentPage === '' || currentPage === '/') {
    initLandingPage();
} else if (currentPage === 'live.html') {
    initLiveRoom();
}

// ==========================================
// 1. LANDING PAGE LOGIC (index.html)
// ==========================================
function initLandingPage() {
    const startBtn = document.getElementById('start-room-btn');
    const roomInput = document.getElementById('room-name-input');
    const emailInput = document.getElementById('user-email-input');
    const premiumBtn = document.getElementById('show-paystack-btn');
    const premiumModal = document.getElementById('premium-modal');
    const closePremiumModal = document.getElementById('close-premium-modal');
    const premiumForm = document.getElementById('premium-details-form');

    if(startBtn) {
        startBtn.addEventListener('click', async () => {
            const userEmail = emailInput.value.trim();
            if(!userEmail) return alert("Please enter your email.");
            let roomName = roomInput.value.trim() || 'parsing-' + Math.random().toString(36).substring(2, 8);
            roomName = roomName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

            const response = await fetch(`${WORKER_URL}/join-room`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ roomName, userEmail })
            });
            const data = await response.json();
            if (!data.allowed) {
                window.location.href = `live.html?room=${roomName}&email=${encodeURIComponent(userEmail)}&blocked=true`;
                return; 
            }
            window.location.href = `live.html?room=${roomName}&email=${encodeURIComponent(userEmail)}`;
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
// 2. LIVE ROOM LOGIC (live.html)
// ==========================================
function initLiveRoom() {
    const roomName = urlParams.get('room');
    const userEmail = urlParams.get('email');
    const isBlocked = urlParams.get('blocked');

    // Share Button
    const shareBtn = document.getElementById('share-room-btn');
    if(shareBtn) {
        shareBtn.addEventListener('click', () => {
            const shareUrl = `https://live.parsing.co.za/live.html?room=${roomName}`;
            navigator.clipboard.writeText(shareUrl).then(() => showToast());
        });
    }

    // Paywalls
    if (isBlocked === 'true') {
        document.getElementById('capacity-modal').classList.remove('hidden');
        document.getElementById('upgrade-from-capacity-btn').addEventListener('click', () => {
            document.getElementById('capacity-modal').classList.add('hidden');
            if(userEmail) triggerPaystack(userEmail, "Premium User");
        });
    }
    document.getElementById('upgrade-from-timeout-btn').addEventListener('click', () => {
        if(userEmail) triggerPaystack(userEmail, "Premium User");
    });

    // --- JOIN FLOW ---
    if (!userEmail) {
        document.getElementById('join-prompt-modal').classList.remove('hidden');
        document.getElementById('join-room-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('join-name').value.trim();
            const email = document.getElementById('join-email').value.trim();
            currentUserName = name;
            document.querySelector('#local-video-tile .participant-name').textContent = name;

            const response = await fetch(`${WORKER_URL}/join-room`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ roomName, userEmail: email, userName: name })
            });
            const data = await response.json();
            if (!data.allowed) {
                document.getElementById('join-prompt-modal').classList.add('hidden');
                document.getElementById('capacity-modal').classList.remove('hidden');
                return;
            }
            document.getElementById('join-prompt-modal').classList.add('hidden');
            startRoomSession(roomName, email);
        });
    } else {
        startRoomSession(roomName, userEmail);
    }
}

function startRoomSession(roomName, userEmail) {
    startCountdownTimer();
    initWebRTC();
    setupControls();
    setupChat();
}

// --- NEW FEATURES: CHAT, HAND RAISE, CAMERA OFF ---
function setupControls() {
    const btnMic = document.getElementById('btn-mic');
    const btnCam = document.getElementById('btn-cam');
    const btnHand = document.getElementById('btn-hand');
    const btnChatToggle = document.getElementById('btn-chat-toggle');
    const btnLeave = document.getElementById('btn-leave');
    const localTile = document.getElementById('local-video-tile');

    // Mic Toggle
    if(btnMic) btnMic.addEventListener('click', () => {
        if(window.localStream) {
            const track = window.localStream.getAudioTracks()[0];
            track.enabled = !track.enabled;
            btnMic.classList.toggle('active');
        }
    });

    // Camera Toggle (With Visual Indicator)
    if(btnCam) btnCam.addEventListener('click', () => {
        if(window.localStream) {
            const track = window.localStream.getVideoTracks()[0];
            track.enabled = !track.enabled;
            btnCam.classList.toggle('active');
            
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
            addChatMessage("system", `${currentUserName} raised their hand ✋`);
        } else {
            handIndicator.classList.add('hidden');
            addChatMessage("system", `${currentUserName} lowered their hand`);
        }
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
    if(btnLeave) btnLeave.addEventListener('click', () => {
        if(window.localStream) window.localStream.getTracks().forEach(track => track.stop());
        window.location.href = 'index.html';
    });
}

function setupChat() {
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-chat-btn');

    const sendMessage = () => {
        const text = chatInput.value.trim();
        if (!text) return;
        addChatMessage("sent", text);
        chatInput.value = '';
        // Note: In production, send this text via WebRTC DataChannel or WebSocket to other peers
    };

    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
}

function addChatMessage(type, text) {
    const messagesContainer = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    
    if (type === 'system') {
        msgDiv.className = 'chat-message system-msg';
        msgDiv.textContent = text;
    } else if (type === 'sent') {
        msgDiv.className = 'chat-message sent';
        msgDiv.textContent = text;
    } else {
        msgDiv.className = 'chat-message received';
        msgDiv.textContent = text;
    }
    
    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// --- TIMER & WEBRTC ---
function startCountdownTimer() {
    let timeLeft = FREE_TIER_LIMIT_SECONDS;
    const timerDisplay = document.getElementById('countdown-timer');
    const timerInterval = setInterval(() => {
        timeLeft--;
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        if (timeLeft <= 300) timerDisplay.style.color = '#F05090';
        if (timeLeft <= 0) { clearInterval(timerInterval); cutOffCall(); }
    }, 1000);
}

function cutOffCall() {
    if (window.localStream) window.localStream.getTracks().forEach(track => track.stop());
    document.getElementById('timeout-modal').classList.remove('hidden');
    document.querySelectorAll('.control-btn').forEach(btn => btn.disabled = true);
}

async function initWebRTC() {
    const localVideo = document.getElementById('local-video');
    try {
        window.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = window.localStream;
    } catch (error) {
        alert("Camera/Mic access denied.");
    }
}

// --- UTILS ---
function showToast() {
    const toast = document.getElementById('toast-notification');
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

function triggerPaystack(userEmail, userName) {
    const handler = PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY, email: userEmail, amount: 29900, currency: 'ZAR',
        ref: 'PARSING_' + Date.now(),
        callback: function(response) { verifyPremium(response.reference, userEmail, userName); },
        onClose: function() {}
    });
    handler.openIframe();
}

async function verifyPremium(reference, email, name) {
    try {
        const res = await fetch(`${WORKER_URL}/verify-premium`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reference, userEmail: email, userName: name })
        });
        const data = await res.json();
        if(data.success) { alert("Welcome to Parsing™ Live Premium!"); window.location.reload(); }
    } catch (error) { alert("Could not verify payment."); }
}
