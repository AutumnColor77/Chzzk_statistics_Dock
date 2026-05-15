import { clearLocalSessionState } from './state.js';
import { revokeToken } from './api.js';

export function login() {
    const width = 500;
    const height = 600;
    const left = (window.innerWidth / 2) - (width / 2);
    const top = (window.innerHeight / 2) - (height / 2);

    // noopener를 켜면 popup의 window.opener가 null이 되어 postMessage를 보낼 수 없습니다.
    // 콜백 → opener 통지 흐름을 유지하려면 같은 origin(self)이어야 하며, 외부 navigation은 콜백 페이지의
    // 엄격한 CSP(default-src 'none', frame-ancestors 'none')와 SameSite=Lax 쿠키로 보호합니다.
    const popup = window.open('/api/auth/login', 'CheeseStickDockAuth', `width=${width},height=${height},top=${top},left=${left}`);

    // 팝업 차단 등으로 popup이 null인 경우, 인플레이스 redirect로 폴백.
    if (!popup) {
        window.location.assign('/api/auth/login');
    }
}

export async function logout() {
    await revokeToken();
    clearLocalSessionState();
}

export function setupAuthListener(onSuccess) {
    window.addEventListener('message', (event) => {
        if (event.origin !== window.location.origin) return;
        if (!event.source) return;
        if (event.data && event.data.type === 'CHZZK_AUTH_SUCCESS') {
            onSuccess();
        }
    });
}
