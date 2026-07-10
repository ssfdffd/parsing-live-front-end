// --- CONFIGURATION ---
const WORKER_URL = "https://parsing-live-backend.YOUR_SUBDOMAIN.workers.dev"; // REPLACE WITH YOUR WORKER URL
const PAYSTACK_PUBLIC_KEY = "pk_test_327c7c43a2772631b3dc0da408f9a004f0432c0d"; 
const FREE_TIER_LIMIT_SECONDS = 3600; 

const currentPage = window.location.pathname.split('/').pop();
const urlParams = new URLSearchParams(window.location.search);

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

    // Start Room Logic
    if(startBtn) {
        startBtn.addEventListener('click', async () => {
            const userEmail = emailInput.value.trim();
            if(!userEmail) return alert("Please enter your email.");

            let roomName = roomInput.value.trim() || 'parsing-' + Math.random().toString(36).substring(2, 8);
            roomName = roomName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

            const response = await fetch(`${WORKER_URL}/join-room`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
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

    // Premium Modal Logic
    if(premiumBtn) premiumBtn.addEventListener('click', () => {
        document.getElementById('premium-email').value = emailInput.value.trim(); // Pre-fill email
        premiumModal.classList.remove('hidden');
    });
    if(closePremiumModal) closePremiumModal.addEventListener('click', () => premiumModal.classList.add('hidden'));

    // Premium Form Submission -> Paystack
    if(premiumForm) {
        premiumForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('premium-name').value.trim();
            const email = document.getElementById('premium-email').value.trim();
            if(!name || !email) return alert("Please fill in all details.");
            
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

    // Handle Share Button
    const shareBtn = document.getElementById('share-room-btn');
    if(shareBtn) {
        shareBtn.addEventListener('click', () => {
            const shareUrl = `https://live.parsing.co.za/live.html?room=${roomName}`;
            navigator.clipboard.writeText(shareUrl).then(() => {
                showToast();
            });
        });
    }

    // Handle Paywall Modals
    if (isBlocked === 'true') {
        document.getElementById('capacity-modal').classList.remove('hidden');
        document.getElementById('upgrade-from-capacity-btn').addEventListener('click', () => {
            document.getElementById('capacity-modal').classList.add('hidden');
            document.getElementById('premium-modal-live').classList.remove('hidden'); // Re-use premium modal logic
            openPremiumModalLive(userEmail);
        });
    }

    document.getElementById('upgrade-from-timeout-btn').addEventListener('click', () => {
        openPremiumModalLive(userEmail);
    });

    // --- CRITICAL: Handle Shared Link Joins ---
    if (!userEmail) {
        // They clicked a shared link, no email in URL. Show Join Prompt.
        document.getElementById('join-prompt-modal').classList.remove('hidden');
        
        document.getElementById('join-room-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('join-name').value.trim();
            const email = document.getElementById('join-email').value.trim();

            const response = await fetch(`${WORKER_URL}/join-room`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ roomName, userEmail: email, userName: name })
            });
            const data = await response.json();

            if (!data.allowed) {
                document.getElementById('join-prompt-modal').classList.add('hidden');
                document.getElementById('capacity-modal').classList.remove('hidden');
                return;
            }

            // Success! Hide prompt and start the room
            document.getElementById('join-prompt-modal').classList.add('hidden');
            startRoomSession(roomName, email);
        });
    } else {
        // They came from the landing page, email is already verified
        startRoomSession(roomName, userEmail);
    }
}

function startRoomSession(roomName, userEmail) {
    startCountdownTimer();
    initWebRTC();
    setupControls();
}

// --- PREMIUM MODAL ON LIVE PAGE ---
function openPremiumModalLive(prefillEmail) {
    // We dynamically create the premium modal on the live page if it doesn't exist, 
    // or we can just clone the logic. For simplicity, we'll trigger paystack directly 
    // if they already have an email, or show a prompt if not.
    if(prefillEmail) {
        triggerPaystack(prefillEmail, "Premium User");
    } else {
        alert("Please refresh and enter your details to upgrade.");
    }
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
            cutOffCall();
        }
    }, 1000);
}

function cutOffCall() {
    if (window.localStream) window.localStream.getTracks().forEach(track => track.stop());
    document.getElementById('timeout-modal').classList.remove('hidden');
    document.querySelectorAll('.control-btn').forEach(btn => btn.disabled = true);
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

// --- TOAST NOTIFICATION ---
function showToast() {
    const toast = document.getElementById('toast-notification');
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ==========================================
// 3. PAYSTACK INTEGRATION
// ==========================================
function triggerPaystack(userEmail, userName) {
    const handler = PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: userEmail,
        amount: 29900, // R299.00
        currency: 'ZAR',
        ref: 'PARSING_' + Date.now(),
        metadata: {
            custom_fields: [
                { display_name: "Customer Name", variable_name: "customer_name", value: userName },
                { display_name: "Platform", variable_name: "platform", value: "Parsing Live WebRTC" }
            ]
        },
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
            alert("Welcome to Parsing™ Live Premium! Your limits are now lifted.");
            window.location.reload();
        }
    } catch (error) {
        alert("Could not verify payment. Please contact support.");
    }
}
