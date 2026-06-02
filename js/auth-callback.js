(function () {
    'use strict';

    var TARGET_ORIGIN = window.location.origin;
    var AUTH_CHANNEL_NAME = 'cheese-stick-dock-auth';
    var AUTH_STORAGE_KEY = 'chzzk_auth_success';
    var MAIN_WINDOW_NAME = 'CheeseStickDockApp';
    var AUTH_SUCCESS = { type: 'CHZZK_AUTH_SUCCESS' };

    function broadcastAuthSuccess() {
        try {
            var channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
            channel.postMessage(AUTH_SUCCESS);
            channel.close();
        } catch (_e) {
            // BroadcastChannel 미지원 환경
        }
    }

    function notifyOpener() {
        try {
            if (window.opener && !window.opener.closed) {
                window.opener.postMessage(AUTH_SUCCESS, TARGET_ORIGIN);
                window.opener.focus();
            }
        } catch (_e) {
            // COOP 등으로 opener 접근 불가
        }
    }

    function markAuthSuccess() {
        try {
            localStorage.setItem(AUTH_STORAGE_KEY, String(Date.now()));
        } catch (_e) {
            // ignore
        }
    }

    function attemptClose() {
        try {
            window.close();
        } catch (_e) {
            // ignore
        }
        try {
            window.open('', '_self');
            window.close();
        } catch (_e) {
            // ignore
        }
    }

    function focusMainAndClose() {
        try {
            var main = window.open('/', MAIN_WINDOW_NAME);
            if (main) {
                main.focus();
            }
        } catch (_e) {
            // ignore
        }
        attemptClose();
    }

    function showCloseHint() {
        var title = document.querySelector('.callback-title');
        var desc = document.querySelector('.callback-desc');
        if (title) title.textContent = '로그인 완료';
        if (desc) desc.textContent = '이 창을 닫고 Cheese Stick Dock으로 돌아가세요.';
    }

    function finishAuth() {
        markAuthSuccess();
        broadcastAuthSuccess();
        notifyOpener();

        attemptClose();
        [50, 150, 400, 800].forEach(function (ms) {
            window.setTimeout(function () {
                if (!window.closed) {
                    attemptClose();
                }
            }, ms);
        });

        window.setTimeout(function () {
            if (!window.closed) {
                focusMainAndClose();
            }
            window.setTimeout(function () {
                if (!window.closed) {
                    showCloseHint();
                }
            }, 400);
        }, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', finishAuth, { once: true });
    } else {
        finishAuth();
    }
})();
