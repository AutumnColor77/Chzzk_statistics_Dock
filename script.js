document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const settingsPanel = document.getElementById('settings-panel');
    const statsContainer = document.getElementById('stats-container');
    const settingsToggleButton = document.getElementById('settings-toggle-button');
    
    const colorPicker = document.getElementById('value-color-picker');
    const channelIdInput = document.getElementById('channel-id-input');
    const saveButton = document.getElementById('save-channel-id');
    const toggles = document.querySelectorAll('.settings-group input[type="checkbox"]');
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
        if (statsContainer.style.display === 'none') {
            statsContainer.style.display = 'grid';
        }

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

            if (item.classList.contains('value-hidden')) {
                valueEl.textContent = '가려짐';
            } else {
                valueEl.textContent = items[key];
            }
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
            setupInitialUI(true);
            startFetching();
        }
    }

    saveButton.addEventListener('click', saveChannelId);
    channelIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveChannelId();
    });

    colorPicker.addEventListener('input', (event) => {
        const newColor = event.target.value;
        document.querySelectorAll('.value').forEach(el => {
            el.style.color = newColor;
        });
        localStorage.setItem('valueColor', newColor);
    });
    
    // Setup for all toggles (checkboxes and clickable stat items)
    toggles.forEach(toggle => {
        const targetId = toggle.dataset.target;
        const targetItem = document.getElementById(targetId);
        if (!targetItem) return;
        
        const storageKey = `value-hidden-${targetId}`;
        
        // Load saved state
        const isHidden = localStorage.getItem(storageKey) === 'true';
        toggle.checked = !isHidden;
        targetItem.classList.toggle('value-hidden', isHidden);

        // When checkbox is changed, update state
        toggle.addEventListener('change', (event) => {
            const shouldHide = !event.target.checked;
            targetItem.classList.toggle('value-hidden', shouldHide);
            localStorage.setItem(storageKey, shouldHide);
            updateUi(); // Re-render UI to show "가려짐" or the value
        });
    });

    statItems.forEach(item => {
        item.addEventListener('click', () => {
            const correspondingToggle = document.querySelector(`input[data-target="${item.id}"]`);
            if (correspondingToggle) correspondingToggle.click();
        });
    });

    // --- Initialization ---
    function initialize() {
        const savedId = localStorage.getItem('chzzkChannelId');
        state.channelId = savedId;
        
        setupInitialUI(!!savedId);

        if(savedId) {
            channelIdInput.value = savedId;
            startFetching();
        } else {
            updateUi(); // Show "ID 없음" message
        }

        const savedColor = localStorage.getItem('valueColor');
        if (savedColor) {
            colorPicker.value = savedColor;
             document.querySelectorAll('.value:not(.value-hidden .value)').forEach(el => {
                el.style.color = savedColor;
            });
        }
    }

    initialize();
});
