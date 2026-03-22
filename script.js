document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const settingsPanel = document.getElementById('settings-panel');
    const statsContainer = document.getElementById('stats-container');
    const settingsToggleButton = document.getElementById('settings-toggle-button');
    
    const channelIdInput = document.getElementById('channel-id-input');
    const saveButton = document.getElementById('save-channel-id');
    const statItems = document.querySelectorAll('.stat-item');

    // --- State Management ---
    const MAX_HISTORY_LENGTH = 120;
    const state = {
        channelId: null,
        liveStatus: 'CLOSE',
        concurrentViewers: 0,
        peakViewers: 0,
        followers: 0,
        averageViewers: 0,
        viewerHistory: [],
    };
    
    let fetchInterval = null;

    // --- Core Functions ---
    async function fetchChzzkData() {
        if (!state.channelId) {
            updateUi(); // Call updateUi to show "ID 없음"
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
                state.liveStatus = 'CLOSE';
            }
        } catch (error) {
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
        const items = {
            'concurrent-viewers': state.liveStatus === 'OPEN' ? state.concurrentViewers.toLocaleString() : '오프라인',
            'peak-viewers': state.liveStatus === 'OPEN' ? state.peakViewers.toLocaleString() : '오프라인',
            'average-viewers': state.liveStatus === 'OPEN' ? state.averageViewers.toLocaleString() : '오프라인',
            'followers': state.followers > 0 ? state.followers.toLocaleString() : (state.liveStatus === 'CLOSE' ? '오프라인' : '0'),
        };

        if (!state.channelId) {
             Object.keys(items).forEach(key => items[key] = 'ID 없음');
        }

        statItems.forEach(item => {
            const valueEl = item.querySelector('.value');
            const itemId = item.id;
            const key = itemId.replace('-item', '');
            valueEl.textContent = items[key];
        });
    }

    function startFetching() {
        if (fetchInterval) clearInterval(fetchInterval);
        if (state.channelId) {
            fetchChzzkData();
            fetchInterval = setInterval(fetchChzzkData, 15000);
        }
    }

    // --- UI and Event Listeners ---
    function updateSettingsButtonText() {
        const isVisible = settingsPanel.classList.contains('visible');
        settingsToggleButton.textContent = isVisible ? '설정 접기' : '설정 열기';
    }

    function setupInitialUI(hasChannelId) {
        statsContainer.style.display = 'grid';
        settingsToggleButton.style.display = 'block';

        if (hasChannelId) {
            settingsPanel.classList.remove('visible');
        } else {
            settingsPanel.classList.add('visible');
        }
        updateSettingsButtonText();
    }
    
    settingsToggleButton.addEventListener('click', () => {
        settingsPanel.classList.toggle('visible');
        updateSettingsButtonText();
    });

    function saveChannelId() {
        let newId = channelIdInput.value.trim();

        if (newId.includes('chzzk.naver.com/live/')) {
            try {
                const url = new URL(newId);
                const pathParts = url.pathname.split('/');
                newId = pathParts[pathParts.length - 1] || '';
            } catch (e) {
                console.error("Invalid URL format:", e);
            }
        }
        
        if (newId) {
            state.channelId = newId;
            localStorage.setItem('chzzkChannelId', newId); // Save the channel ID
            state.viewerHistory = [];
            setupInitialUI(true);
            startFetching();
        }
    }

    saveButton.addEventListener('click', saveChannelId);
    channelIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveChannelId();
    });

    // --- Initialization ---
    function initialize() {
        const savedId = localStorage.getItem('chzzkChannelId');
        if (savedId) {
            state.channelId = savedId;
            channelIdInput.value = savedId; // Pre-fill the input field
            setupInitialUI(true);
            startFetching();
        } else {
            setupInitialUI(false);
            updateUi(); // Show "ID 없음" message initially
        }
    }

    initialize();
});
