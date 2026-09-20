// WaveMirror Runtime Environment Variables Loader (.env & Default Environment Config)
(function(window) {
    window.__ENV__ = window.__ENV__ || {};
    window.process = window.process || { env: {} };
    
    // Baseline environment defaults (sourced from .env)
    const DEFAULT_ENV = {
        FIREBASE_API_KEY: "AIzaSyA0INROBS86Ch1OoWSxzikroI2tiC8DI-c",
        FIREBASE_AUTH_DOMAIN: "vithal-d7cfb.firebaseapp.com",
        FIREBASE_DATABASE_URL: "https://vithal-d7cfb-default-rtdb.firebaseio.com",
        FIREBASE_PROJECT_ID: "vithal-d7cfb",
        FIREBASE_STORAGE_BUCKET: "vithal-d7cfb.firebasestorage.app",
        FIREBASE_MESSAGING_SENDER_ID: "504015060977",
        FIREBASE_APP_ID: "1:504015060977:web:303d71aa9d5c4f8c740e50",
        FIREBASE_MEASUREMENT_ID: "G-93JSYBCTRN",
        WAVEMIRROR_CLOUD_ENDPOINT: "https://vithal-d7cfb-default-rtdb.firebaseio.com/settings.json",
        TMDB_API_KEY: "fea469f5e20796590292a227a92a2fef"
    };

    window.ENV = Object.assign({}, DEFAULT_ENV, window.ENV || {}, window.__ENV__, window.process.env);
    Object.assign(window.process.env, window.ENV);

    function updateFirebaseConfig() {
        window.FIREBASE_CONFIG = {
            apiKey: window.ENV.FIREBASE_API_KEY || DEFAULT_ENV.FIREBASE_API_KEY,
            authDomain: window.ENV.FIREBASE_AUTH_DOMAIN || DEFAULT_ENV.FIREBASE_AUTH_DOMAIN,
            databaseURL: window.ENV.FIREBASE_DATABASE_URL || DEFAULT_ENV.FIREBASE_DATABASE_URL,
            projectId: window.ENV.FIREBASE_PROJECT_ID || DEFAULT_ENV.FIREBASE_PROJECT_ID,
            storageBucket: window.ENV.FIREBASE_STORAGE_BUCKET || DEFAULT_ENV.FIREBASE_STORAGE_BUCKET,
            messagingSenderId: window.ENV.FIREBASE_MESSAGING_SENDER_ID || DEFAULT_ENV.FIREBASE_MESSAGING_SENDER_ID,
            appId: window.ENV.FIREBASE_APP_ID || DEFAULT_ENV.FIREBASE_APP_ID,
            measurementId: window.ENV.FIREBASE_MEASUREMENT_ID || DEFAULT_ENV.FIREBASE_MEASUREMENT_ID
        };
    }

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

    // Try reading local .env file if available
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
        if (typeof fetch !== "undefined") {
            fetch(".env")
                .then(res => res.text())
                .then(text => parseEnvContent(text))
                .catch(() => {});
        }
    }

    updateFirebaseConfig();
})(typeof window !== "undefined" ? window : globalThis);
