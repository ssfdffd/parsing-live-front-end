// --- CONFIGURATION ---
const CLOUDFLARE_APP_ID = "371197fd-f759-4d31-9f8c-43a451fc0d38"; // Your App ID
const FREE_TIER_LIMIT_SECONDS = 3600; // 1 Hour

// --- PAGE DETECTION ---
// Check which page we are on to run the correct logic
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

    if(startBtn) {
        startBtn.addEventListener('click', () => {
            let roomName = roomInput.value.trim();
            
            // If empty, generate a unique Jitsi-style random name
            if (!roomName) {
                roomName = 'parsing-' + Math.random().toString(36).substring(2, 8) + '-' + Math.random().toString(36).substring(2, 8);
            } else {
                // Clean up the room name for URLs
                roomName = roomName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
            }

            // Redirect to the live room with the room name in the URL
            window.location.href = `live.html?room=${roomName}`;
        });
    }
}

// ==========================================
// 2. LIVE ROOM LOGIC (live.html)
// ==========================================
function initLiveRoom() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomName = urlParams.get('room') || 'default-room';
    
    console.log(`Joining room: ${roomName} using App ID: ${CLOUDFLARE_APP_ID}`);

    // Start the 1-hour timer
    startCountdownTimer();

    // Initialize WebRTC (Camera/Mic)
    initWebRTC();

    // Setup UI Controls
    setupControls();
}

// --- 1 HOUR TIMER LOGIC ---
function startCountdownTimer() {
    let timeLeft = FREE_TIER_LIMIT_SECONDS;
    const timerDisplay = document.getElementById('countdown-timer');
    const modal = document.getElementById('premium-modal');

    const timerInterval = setInterval(() => {
        timeLeft--;
        
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        // Change color to Hot Pink when under 5 minutes
        if (timeLeft <= 300) {
            timerDisplay.style.color = '#F05090'; // Hot Pink
        }

        // Time is up!
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            cutOffCall();
        }
    }, 1000);
}

function cutOffCall() {
    // Stop all media tracks
    if (window.localStream) {
        window.localStream.getTracks().forEach(track => track.stop());
    }
    
    // Show the Premium Paywall Modal
    const modal = document.getElementById('premium-modal');
    if (modal) {
        modal.classList.remove('hidden');
    }
    
    // Disable control buttons
    document.querySelectorAll('.control-btn').forEach(btn => btn.disabled = true);
}

// --- WEBRTC SETUP ---
async function initWebRTC() {
    const localVideo = document.getElementById('local-video');
    try {
        // Get camera and microphone
        window.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = window.localStream;
        
        // Note: In a production environment, you would now use the Cloudflare Calls SDK 
        // to connect this localStream to the SFU using the CLOUDFLARE_APP_ID.
        console.log("Media acquired. Ready to connect to Cloudflare Calls SFU.");
        
    } catch (error) {
        console.error("Error accessing media:", error);
        alert("Could not access camera/microphone. Please check browser permissions.");
    }
}
// --- REPLACE THE OLD setupCloudflareCalls WITH THIS ---
async function setupCloudflareCalls() {
    const configuration = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };

    window.peerConnection = new RTCPeerConnection(configuration);

    // Add local camera/mic tracks to the connection
    window.localStream.getTracks().forEach(track => {
        window.peerConnection.addTrack(track, window.localStream);
    });

    // Handle incoming video/audio from other participants
    window.peerConnection.ontrack = (event) => {
        const remoteVideo = document.createElement('video');
        remoteVideo.autoplay = true;
        remoteVideo.playsinline = true;
        remoteVideo.srcObject = event.streams[0];
        
        const tile = document.createElement('div');
        tile.className = 'video-tile';
        tile.appendChild(remoteVideo);
        
        const nameTag = document.createElement('span');
        nameTag.className = 'participant-name cream-text';
        nameTag.innerText = 'Participant';
        tile.appendChild(nameTag);
        
        document.getElementById('remote-videos-container').appendChild(tile);
    };

    // Create the WebRTC Offer
    const offer = await window.peerConnection.createOffer();
    await window.peerConnection.setLocalDescription(offer);

    // --- THE NEW CONNECTION TO YOUR CLOUDFLARE WORKER ---
    // Replace the URL below with the exact Worker URL you copied in Phase 2!
    const WORKER_URL = "https://parsing-live-backend.YOUR_SUBDOMAIN.workers.dev"; 

    try {
        const response = await fetch(WORKER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ offerSdp: offer.sdp })
        });

        const data = await response.json();
        
        // Apply the Answer from Cloudflare to complete the connection
        await window.peerConnection.setRemoteDescription({
            type: "answer",
            sdp: data.answerSdp
        });
        
        console.log("Successfully connected to Cloudflare Calls SFU!");
    } catch (error) {
        console.error("Failed to connect to backend:", error);
        alert("Could not connect to the video server. Please check your backend Worker URL.");
    }
}

// --- UI CONTROLS ---
function setupControls() {
    const btnMic = document.getElementById('btn-mic');
    const btnCam = document.getElementById('btn-cam');
    const btnLeave = document.getElementById('btn-leave');

    if(btnMic) {
        btnMic.addEventListener('click', () => {
            if(window.localStream) {
                const isEnabled = window.localStream.getAudioTracks()[0].enabled;
                window.localStream.getAudioTracks()[0].enabled = !isEnabled;
                btnMic.classList.toggle('active');
            }
        });
    }

    if(btnCam) {
        btnCam.addEventListener('click', () => {
            if(window.localStream) {
                const isEnabled = window.localStream.getVideoTracks()[0].enabled;
                window.localStream.getVideoTracks()[0].enabled = !isEnabled;
                btnCam.classList.toggle('active');
            }
        });
    }

    if(btnLeave) {
        btnLeave.addEventListener('click', () => {
            if(window.localStream) window.localStream.getTracks().forEach(track => track.stop());
            window.location.href = 'index.html';
        });
    }
}
