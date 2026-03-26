import { globals } from './state.js';

export async function fetchLiveStatus(channelId) {
    const url = `/api/live-status?channelId=${channelId}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
}

export async function fetchUserChannel() {
    if (!globals.accessToken) throw new Error('No access token');
    const response = await fetch('/api/users/me', {
        headers: { 'Authorization': `Bearer ${globals.accessToken}` }
    });
    return response;
}

export async function fetchLiveSettings() {
    if (!globals.accessToken) throw new Error('No access token');
    const response = await fetch('/api/lives/setting', {
        headers: { 'Authorization': `Bearer ${globals.accessToken}` }
    });
    return response;
}

export async function updateLiveSettings(body) {
    if (!globals.accessToken) throw new Error('No access token');
    const response = await fetch('/api/lives/setting', {
        method: 'PATCH',
        headers: { 
            'Authorization': `Bearer ${globals.accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    return response;
}

export async function searchCategories(query) {
    if (!query) return null;
    const res = await fetch(`/api/categories/search?query=${encodeURIComponent(query)}`);
    if (res.ok) {
        return res.json();
    }
    throw new Error('Search failed');
}
