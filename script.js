document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const colorPicker = document.getElementById('value-color-picker');
    const valueElements = document.querySelectorAll('.value');
    const channelIdInput = document.getElementById('channel-id-input');
    const saveButton = document.getElementById('save-channel-id');
    const toggles = document.querySelectorAll('.settings-group input[type="checkbox"]');

    // --- State Management ---
    const MAX_HISTORY_LENGTH = 120; // Approx 30 minutes of data (120 samples * 15s interval)
    const state = {
        channelId: null,
        liveStatus: 'CLOSE', // CLOSE, OPEN
        concurrentViewers: 0,
        peakViewers: 0,
        followers: 0,
        averageViewers: 0,
        viewerHistory: [],
        // --- Not provided by this API ---
        chatParticipants: 0,
        subscribers: 0,
        donations: 0
    };

    // --- Core Functions ---
    async function fetchChzzkData() {
        if (!state.channelId) {
            console.warn("Chzzk channel ID is not set.");
            updateUiForOfflineState("ID 없음");
            return;
        }

        const url = `https://corsproxy.io/?https://api.chzzk.naver.com/polling/v2/channels/${state.channelId}/live-status`;
        const previousStatus = state.liveStatus;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();

            if (data.code === 200) {
                const content = data.content || {};
                state.liveStatus = content.status || 'CLOSE';

                if (state.liveStatus === 'OPEN') {
                    state.concurrentViewers = content.concurrentUserCount || 0;
                    state.peakViewers = content.accumulateCount || 0;
                    state.followers = content.followerCount || 0;
                    
                    // Add to history for average calculation
                    state.viewerHistory.push(state.concurrentViewers);
                    if (state.viewerHistory.length > MAX_HISTORY_LENGTH) {
                        state.viewerHistory.shift(); // Remove the oldest entry
                    }
                } else {
                    // Stream is closed, keep follower count but reset live stats
                    state.concurrentViewers = 0;
                    state.peakViewers = 0;
                    state.followers = content.followerCount || state.followers;
                }
            } else {
                console.error("Chzzk API error:", data.message);
                state.liveStatus = 'CLOSE';
            }
        } catch (error) {
            console.error("Failed to fetch Chzzk data:", error);
            state.liveStatus = 'CLOSE';
        }
        
        // Handle status change from OPEN to CLOSE
        if (previousStatus === 'OPEN' && state.liveStatus === 'CLOSE') {
            state.viewerHistory = [];
            state.averageViewers = 0;
        }

        calculateAverageViewers();
        updateUi();
    }

    function calculateAverageViewers() {
        if (state.viewerHistory.length === 0) {
            state.averageViewers = 0;
            return;
        }
        const sum = state.viewerHistory.reduce((acc, count) => acc + count, 0);
        state.averageViewers = Math.round(sum / state.viewerHistory.length);
    }

    function updateUi() {
        if (state.liveStatus === 'OPEN') {
            document.getElementById('concurrent-viewers').textContent = state.concurrentViewers.toLocaleString();
            document.getElementById('peak-viewers').textContent = state.peakViewers.toLocaleString();
            document.getElementById('average-viewers').textContent = state.averageViewers.toLocaleString();
        } else {
            document.getElementById('concurrent-viewers').textContent = '오프라인';
            document.getElementById('peak-viewers').textContent = '오프라인';
            document.getElementById('average-viewers').textContent = '오프라인';
        }
        document.getElementById('followers').textContent = state.followers.toLocaleString();

        // Update fields not provided by API
        document.getElementById('chat-participants').textContent = 'N/A';
        document.getElementById('subscribers').textContent = 'N/A';
        document.getElementById('donations').textContent = 'N/A';
    }
    
    function updateUiForOfflineState(message) {
        state.liveStatus = 'CLOSE';
        document.getElementById('concurrent-viewers').textContent = message;
        document.getElementById('peak-viewers').textContent = message;
        document.getElementById('average-viewers').textContent = message;
        document.getElementById('followers').textContent = state.followers > 0 ? state.followers.toLocaleString() : '-';
    }


    // --- Settings and Event Listeners ---
    function applyColor(color) {
        valueElements.forEach(el => {
            el.style.color = color;
        });
    }

    function saveChannelId() {
        const newId = channelIdInput.value.trim();
        if (newId) {
            state.channelId = newId;
            localStorage.setItem('chzzkChannelId', newId);
            state.viewerHistory = []; // Reset history on ID change
            console.log(`Channel ID saved: ${newId}`);
            fetchChzzkData(); // Fetch immediately on save
        }
    }

    saveButton.addEventListener('click', saveChannelId);
    channelIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveChannelId();
        }
    });

    colorPicker.addEventListener('input', (event) => {
        const newColor = event.target.value;
        applyColor(newColor);
        localStorage.setItem('valueColor', newColor);
    });

    toggles.forEach(toggle => {
        const targetItem = document.getElementById(toggle.dataset.target);
        if (!targetItem) return;
        targetItem.classList.toggle('hidden', !toggle.checked);
        toggle.addEventListener('change', (event) => {
            targetItem.classList.toggle('hidden', !event.target.checked);
        });
    });

    function configureStatsVisibility() {
        // Hide only the stats that are truly unsupported
        const unsupported = ['chat-participants-item', 'subscribers-item', 'donations-item'];
        unsupported.forEach(id => {
            document.getElementById(id)?.classList.add('hidden');
            const toggle = document.querySelector(`input[data-target="${id}"]`);
            if (toggle) toggle.checked = false;
        });

        // Ensure 'average-viewers-item' is visible by default
        const avgToggle = document.querySelector('input[data-target="average-viewers-item"]');
        if(avgToggle && !avgToggle.checked) {
            // This logic is tricky because of user settings. Let's just default it to checked in HTML.
            // For now, we will just make sure it is not hidden by this function.
        }
    }

    // --- Initialization ---
    function initialize() {
        const savedId = localStorage.getItem('chzzkChannelId');
        const defaultId = 'b26947470f4361083ac58fc2f822d517';
        state.channelId = savedId || defaultId;
        channelIdInput.value = state.channelId;

        const savedColor = localStorage.getItem('valueColor');
        if (savedColor) {
            colorPicker.value = savedColor;
            applyColor(savedColor);
        } else {
            applyColor(colorPicker.value);
        }

        configureStatsVisibility();

        fetchChzzkData();
        setInterval(fetchChzzkData, 15000); // Update every 15 seconds
    }

    initialize();
});
