// WaveMirror Runtime Environment Variables Loader (.env Parser)
(function(window) {
    window.__ENV__ = window.__ENV__ || {};
    window.process = window.process || { env: {} };
    window.ENV = window.ENV || {};

    function parseEnvContent(text) {
        if (!text || typeof text !== "string") return;
        const lines = text.split(/\r?\n/);
        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith("#")) continue;
            const eqIdx = line.indexOf("=");
            if (eqIdx !== -1) {
                const key = line.substring(0, eqIdx).trim();
                let val = line.substring(eqIdx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                if (key) {
                    window.ENV[key] = val;
                    window.process.env[key] = val;
                }
            }
        }
        updateFirebaseConfig();
    }

    function updateFirebaseConfig() {
        window.FIREBASE_CONFIG = {
            apiKey: window.ENV.FIREBASE_API_KEY || "",
            authDomain: window.ENV.FIREBASE_AUTH_DOMAIN || "",
            databaseURL: window.ENV.FIREBASE_DATABASE_URL || "",
            projectId: window.ENV.FIREBASE_PROJECT_ID || "",
            storageBucket: window.ENV.FIREBASE_STORAGE_BUCKET || "",
            messagingSenderId: window.ENV.FIREBASE_MESSAGING_SENDER_ID || "",
            appId: window.ENV.FIREBASE_APP_ID || "",
            measurementId: window.ENV.FIREBASE_MEASUREMENT_ID || ""
        };
    }

    // 1. Synchronous attempt to read .env immediately during script load
    try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", ".env", false);
        xhr.send(null);
        if (xhr.status === 200 || xhr.status === 0) {
            if (xhr.responseText && xhr.responseText.includes("FIREBASE_")) {
                parseEnvContent(xhr.responseText);
            }
        }
    } catch (e) {
        // Fallback for async fetch if synchronous XHR is restricted
        if (typeof fetch !== "undefined") {
            fetch(".env")
                .then(res => res.text())
                .then(text => parseEnvContent(text))
                .catch(() => {});
        }
    }

    // Merge any pre-defined window.__ENV__ or window.process.env
    Object.assign(window.ENV, window.__ENV__, window.process.env);
    updateFirebaseConfig();
})(typeof window !== "undefined" ? window : globalThis);
