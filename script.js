// --- CONFIGURATION ---
// Replace with your actual Cloudflare Calls App ID from Phase 2
const CLOUDFLARE_APP_ID = "YOUR_CLOUDFLARE_APP_ID_HERE"; 

// --- DOM ELEMENTS ---
const localVideo = document.getElementById('local-video');
const remoteVideosContainer = document.getElementById('remote-videos-container');
const btnMic = document.getElementById('btn-mic');
const btnCam = document.getElementById('btn-cam');
const btnLeave = document.getElementById('btn-leave');

let localStream = null;
let peerConnection = null;

// --- INITIALIZATION ---
async function init() {
    try {
        // 1. Get user's camera and microphone
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;

        // 2. Initialize Cloudflare Calls WebRTC connection
        await setupCloudflareCalls();
        
    } catch (error) {
        console.error("Error accessing media devices:", error);
        alert("Could not access camera/microphone. Please check permissions.");
    }
}

// --- CLOUDFLARE CALLS SETUP ---
async function setupCloudflareCalls() {
    // Note: In a production app, you would use the official Cloudflare Calls SDK.
    // This is a simplified conceptual implementation using standard RTCPeerConnection.
    
    const configuration = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] // Cloudflare handles TURN via their API
    };

    peerConnection = new RTCPeerConnection(configuration);

    // Add local tracks to the peer connection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Handle incoming tracks from other participants
    peerConnection.ontrack = (event) => {
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
        
        remoteVideosContainer.appendChild(tile);
    };

    // Create an offer to send to Cloudflare Calls API
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    // TODO: Send this offer to your backend/Cloudflare Calls API endpoint 
    // to get the answer and establish the SFU connection.
    console.log("WebRTC Offer created. Ready to send to Cloudflare Calls API.");
}

// --- UI CONTROLS ---
btnMic.addEventListener('click', () => {
    const isEnabled = localStream.getAudioTracks()[0].enabled;
    localStream.getAudioTracks()[0].enabled = !isEnabled;
    btnMic.classList.toggle('active');
});

btnCam.addEventListener('click', () => {
    const isEnabled = localStream.getVideoTracks()[0].enabled;
    localStream.getVideoTracks()[0].enabled = !isEnabled;
    btnCam.classList.toggle('active');
});

btnLeave.addEventListener('click', () => {
    if(peerConnection) peerConnection.close();
    if(localStream) localStream.getTracks().forEach(track => track.stop());
    alert("You have left the call.");
    window.location.reload();
});

// Start the app
init();
