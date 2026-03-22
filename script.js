document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const settingsPanel = document.getElementById('settings-panel');
    const statsContainer = document.getElementById('stats-container');
    const settingsToggleButton = document.getElementById('settings-toggle-button');
    
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
    
    let fetchInterval = null;

    // --- Core Functions ---
    async function fetchChzzkData() {
        if (!state.channelId) {
            console.warn("Chzzk channel ID is not set.");
            updateUiForOfflineState("ID 없음");
            return;
        }

        const url = `/api/live-status?channelId=${state.channelId}`;
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
                    
                    state.viewerHistory.push(state.concurrentViewers);
                    if (state.viewerHistory.length > MAX_HISTORY_LENGTH) {
                        state.viewerHistory.shift();
                    }
                } else {
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
        if (statsContainer.style.display === 'none') {
            statsContainer.style.display = 'grid'; // Show stats after first successful fetch
        }

        if (state.liveStatus === 'OPEN') {
            document.getElementById('concurrent-viewers').textContent = state.concurrentViewers.toLocaleString();
            document.getElementById('peak-viewers').textContent = state.peakViewers.toLocaleString();
            document.getElementById('average-viewers').textContent = state.averageViewers.toLocaleString();
        } else {
            document.getElementById('concurrent-viewers').textContent = '오프라인';
            document.getElementById('peak-viewers').textContent = '오프라인';
            document.getElementById('average-viewers').textContent = '오프라인';
        }
        document.getElementById('followers').textContent = state.followers > 0 ? state.followers.toLocaleString() : '-';

        document.getElementById('chat-participants').textContent = 'N/A';
        document.getElementById('subscribers').textContent = 'N/A';
        document.getElementById('donations').textContent = 'N/A';
    }
    
    function updateUiForOfflineState(message) {
        state.liveStatus = 'CLOSE';
        document.getElementById('concurrent-viewers').textContent = message;
        document.getElementById('peak-viewers').textContent = message;
        document.getElementById('average-viewers').textContent = message;
        document.getElementById('followers').textContent = '-';
    }

    function startFetching() {
        if (fetchInterval) {
            clearInterval(fetchInterval);
        }
        if (state.channelId) {
            fetchChzzkData();
            fetchInterval = setInterval(fetchChzzkData, 15000);
        }
    }

    // --- UI and Event Listeners ---
    function setupInitialUI(hasChannelId) {
        if (hasChannelId) {
            statsContainer.style.display = 'grid';
            settingsPanel.classList.remove('visible');
            settingsToggleButton.style.display = 'block';
        } else {
            statsContainer.style.display = 'none';
            settingsPanel.classList.add('visible');
            settingsToggleButton.style.display = 'none';
        }
    }
    
    settingsToggleButton.addEventListener('click', () => {
        settingsPanel.classList.toggle('visible');
    });

    function saveChannelId() {
        const newId = channelIdInput.value.trim();
        if (newId) {
            state.channelId = newId;
            localStorage.setItem('chzzkChannelId', newId);
            state.viewerHistory = [];
            console.log(`Channel ID saved: ${newId}`);
            
            setupInitialUI(true); // Switch to viewer mode
            startFetching(); // Start fetching data
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
        document.querySelectorAll('.value').forEach(el => {
            el.style.color = newColor;
        });
        localStorage.setItem('valueColor', newColor);
    });

    toggles.forEach(toggle => {
        const targetItem = document.getElementById(toggle.dataset.target);
        if (!targetItem) return;
        
        const savedState = localStorage.getItem(`toggle-${toggle.dataset.target}`);
        toggle.checked = savedState ? JSON.parse(savedState) : true; // Default to true if not saved
        targetItem.classList.toggle('hidden', !toggle.checked);

        toggle.addEventListener('change', (event) => {
            targetItem.classList.toggle('hidden', !event.target.checked);
            localStorage.setItem(`toggle-${toggle.dataset.target}`, event.target.checked);
        });
    });

    function configureUnsupportedStats() {
        const unsupported = ['chat-participants-item', 'subscribers-item', 'donations-item'];
        unsupported.forEach(id => {
            document.getElementById(id)?.classList.add('hidden');
            const toggle = document.querySelector(`input[data-target="${id}"]`);
            if (toggle) {
                toggle.checked = false;
                toggle.parentElement.classList.add('hidden'); // Hide the toggle itself
            }
        });
    }

    // --- Initialization ---
    function initialize() {
        const savedId = localStorage.getItem('chzzkChannelId');
        state.channelId = savedId;
        
        setupInitialUI(!!savedId);

        if(savedId) {
            channelIdInput.value = savedId;
            startFetching();
        }

        const savedColor = localStorage.getItem('valueColor');
        if (savedColor) {
            colorPicker.value = savedColor;
             document.querySelectorAll('.value').forEach(el => {
                el.style.color = savedColor;
            });
        }
        
        configureUnsupportedStats();
    }

    initialize();
});
