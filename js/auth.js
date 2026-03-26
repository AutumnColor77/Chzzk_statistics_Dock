import { setAccessToken } from './state.js';
import { revokeToken } from './api.js';

export function login() {
    const width = 500;
    const height = 600;
    const left = (window.innerWidth / 2) - (width / 2);
    const top = (window.innerHeight / 2) - (height / 2);
    window.open('/api/auth/login', 'ChzzkAuth', `width=${width},height=${height},top=${top},left=${left}`);
}

export async function logout() {
    await revokeToken();
    setAccessToken(null);
}

export function setupAuthListener(onSuccess) {
    window.addEventListener('message', (event) => {
        if (event.origin !== window.location.origin) return;
        if (event.data && event.data.type === 'CHZZK_AUTH_SUCCESS') {
            const tokenData = event.data.payload;
            setAccessToken(tokenData.accessToken);
            onSuccess();
        }
    });
}
