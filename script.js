// --- CONFIGURATION ---
const WORKER_URL = "https://parsing-live-backend.YOUR_SUBDOMAIN.workers.dev"; // REPLACE WITH YOUR WORKER URL
const PAYSTACK_PUBLIC_KEY = "pk_test_327c7c43a2772631b3dc0da408f9a004f0432c0d"; // REPLACE WITH YOUR PAYSTACK PUBLIC KEY
const FREE_TIER_LIMIT_SECONDS = 3600; // 1 Hour

const currentPage = window.location.pathname.split('/').pop();

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
    const paystackBtn = document.getElementById('show-paystack-btn');

    if(startBtn) {
        startBtn.addEventListener('click', async () => {
            const userEmail = emailInput.value.trim();
            if(!userEmail) return alert("Please enter your email to check your account status.");

            let roomName = roomInput.value.trim();
            if (!roomName) {
                roomName = 'parsing-' + Math.random().toString(36).substring(2, 8);
            } else {
                roomName = roomName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
            }

            // Check room capacity with backend BEFORE joining
            const response = await fetch(`${WORKER_URL}/join-room`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ roomName, userEmail })
            });
            const data = await response.json();

            if (!data.allowed) {
                alert(data.message);
                return; // Stop them from entering
            }

            window.location.href = `live.html?room=${roomName}&email=${encodeURIComponent(userEmail)}`;
        });
    }

    // Paystack Checkout Trigger
    if(paystackBtn) {
        paystackBtn.addEventListener('click', () => {
            const email = emailInput.value.trim();
            if(!email) return alert("Please enter your email above first.");
            triggerPaystack(email);
        });
    }
}

// ==========================================
// 2. LIVE ROOM LOGIC (live.html)
// ==========================================
function initLiveRoom() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomName = urlParams.get('room');
    const userEmail = urlParams.get('email');
    
    startCountdownTimer();
    initWebRTC();
    setupControls();
}

// --- 1 HOUR TIMER ---
function startCountdownTimer() {
    let timeLeft = FREE_TIER_LIMIT_SECONDS;
    const timerDisplay = document.getElementById('countdown-timer');
    const timerInterval = setInterval(() => {
        timeLeft--;
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        if (timeLeft <= 300) timerDisplay.style.color = '#F05090'; // Hot Pink
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            document.getElementById('premium-modal').classList.remove('hidden');
        }
    }, 1000);
}

// --- WEBRTC & CONTROLS ---
async function initWebRTC() {
    const localVideo = document.getElementById('local-video');
    try {
        window.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = window.localStream;
    } catch (error) {
        alert("Camera/Mic access denied.");
    }
}

function setupControls() {
    const btnMic = document.getElementById('btn-mic');
    const btnCam = document.getElementById('btn-cam');
    const btnLeave = document.getElementById('btn-leave');

    if(btnMic) btnMic.addEventListener('click', () => {
        if(window.localStream) {
            window.localStream.getAudioTracks()[0].enabled = !window.localStream.getAudioTracks()[0].enabled;
            btnMic.classList.toggle('active');
        }
    });

    if(btnCam) btnCam.addEventListener('click', () => {
        if(window.localStream) {
            window.localStream.getVideoTracks()[0].enabled = !window.localStream.getVideoTracks()[0].enabled;
            btnCam.classList.toggle('active');
        }
    });

    if(btnLeave) btnLeave.addEventListener('click', () => {
        if(window.localStream) window.localStream.getTracks().forEach(track => track.stop());
        window.location.href = 'index.html';
    });
}

// ==========================================
// 3. PAYSTACK INTEGRATION
// ==========================================
function triggerPaystack(userEmail) {
    const handler = PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: userEmail,
        amount: 29900, // R299.00 in kobo/cents
        currency: 'ZAR',
        ref: 'PARSING_' + Date.now(),
        metadata: {
            custom_fields: [
                {
                    display_name: "Platform",
                    variable_name: "platform",
                    value: "Parsing Live WebRTC"
                }
            ]
        },
        callback: function(response) {
            // Success! Verify with backend
            verifyPremium(response.reference, userEmail);
        },
        onClose: function() {
            alert('Payment window closed.');
        }
    });
    handler.openIframe();
}

async function verifyPremium(reference, email) {
    const res = await fetch(`${WORKER_URL}/verify-premium`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, userEmail: email })
    });
    const data = await res.json();
    if(data.success) {
        alert("Welcome to Parsing™ Live Premium! Your limits are now lifted.");
        window.location.reload();
    }
}
