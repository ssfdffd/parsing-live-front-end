// --- CONFIGURATION ---
const WORKER_URL = "https://parsing-live-backend.YOUR_SUBDOMAIN.workers.dev"; // REPLACE

const portalToken = localStorage.getItem('parsing_portal_token');
const dashboard = document.getElementById('portal-dashboard');
const loginScreen = document.getElementById('portal-login');

// Check if user is logged in
if (portalToken) {
    verifyPortalAccess();
} else {
    dashboard.style.display = 'none';
    loginScreen.style.display = 'flex';
}

async function verifyPortalAccess() {
    try {
        const res = await fetch(`${WORKER_URL}/verify-portal`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: portalToken })
        });
        const data = await res.json();

        if (data.success) {
            // Show Dashboard
            loginScreen.style.display = 'none';
            dashboard.style.display = 'flex';
            document.getElementById('user-email-display').textContent = data.email;
            
            // Setup Dashboard Interactions
            setupDashboard();
        } else {
            // Token invalid
            localStorage.removeItem('parsing_portal_token');
            dashboard.style.display = 'none';
            loginScreen.style.display = 'flex';
        }
    } catch (error) {
        console.error("Portal verification failed", error);
    }
}

function setupDashboard() {
    const createBtn = document.getElementById('create-room-btn');
    const roomInput = document.getElementById('new-room-name');
    const linkContainer = document.getElementById('generated-link-container');
    const linkInput = document.getElementById('generated-link');
    const copyBtn = document.getElementById('copy-link-btn');
    const logoutBtn = document.getElementById('logout-btn');

    // Create Room Logic
    createBtn.addEventListener('click', async () => {
        let roomName = roomInput.value.trim();
        if (!roomName) {
            roomName = 'premium-' + Math.random().toString(36).substring(2, 10);
        } else {
            roomName = roomName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        }

        createBtn.textContent = "Generating...";
        createBtn.disabled = true;

        try {
            const res = await fetch(`${WORKER_URL}/create-unlimited-room`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: portalToken, roomName: roomName })
            });
            const data = await res.json();

            if (data.success) {
                linkInput.value = data.roomUrl;
                linkContainer.classList.remove('hidden');
                roomInput.value = "";
            } else {
                alert("Failed to create room. Please try again.");
            }
        } catch (error) {
            alert("Server error. Please try again.");
        } finally {
            createBtn.textContent = "Generate Link";
            createBtn.disabled = false;
        }
    });

    // Copy Link Logic
    copyBtn.addEventListener('click', () => {
        linkInput.select();
        navigator.clipboard.writeText(linkInput.value);
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
    });

    // Logout Logic
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('parsing_portal_token');
        window.location.reload();
    });
}
