// WaveMirror Universal Environment Variables & Firebase Configuration Engine
(function(window) {
    window.__ENV__ = window.__ENV__ || {};
    window.process = window.process || { env: {} };

    window.ENV = {
        FIREBASE_API_KEY: window.__ENV__.FIREBASE_API_KEY || window.process.env.FIREBASE_API_KEY || "AIzaSyDsFLdaHNTjSNbO2fi4W5HvNQKyIfQy2no",
        FIREBASE_AUTH_DOMAIN: window.__ENV__.FIREBASE_AUTH_DOMAIN || window.process.env.FIREBASE_AUTH_DOMAIN || "shop-1e207.firebaseapp.com",
        FIREBASE_DATABASE_URL: window.__ENV__.FIREBASE_DATABASE_URL || window.process.env.FIREBASE_DATABASE_URL || "https://shop-1e207-default-rtdb.firebaseio.com",
        FIREBASE_PROJECT_ID: window.__ENV__.FIREBASE_PROJECT_ID || window.process.env.FIREBASE_PROJECT_ID || "shop-1e207",
        FIREBASE_STORAGE_BUCKET: window.__ENV__.FIREBASE_STORAGE_BUCKET || window.process.env.FIREBASE_STORAGE_BUCKET || "shop-1e207.firebasestorage.app",
        FIREBASE_MESSAGING_SENDER_ID: window.__ENV__.FIREBASE_MESSAGING_SENDER_ID || window.process.env.FIREBASE_MESSAGING_SENDER_ID || "123370597498",
        FIREBASE_APP_ID: window.__ENV__.FIREBASE_APP_ID || window.process.env.FIREBASE_APP_ID || "1:123370597498:web:527b50fb6858d64d2edfc3",
        FIREBASE_MEASUREMENT_ID: window.__ENV__.FIREBASE_MEASUREMENT_ID || window.process.env.FIREBASE_MEASUREMENT_ID || "G-4J40C28S58",
        WAVEMIRROR_CLOUD_ENDPOINT: window.__ENV__.WAVEMIRROR_CLOUD_ENDPOINT || window.process.env.WAVEMIRROR_CLOUD_ENDPOINT || "https://shop-1e207-default-rtdb.firebaseio.com/settings.json",
        TMDB_API_KEY: window.__ENV__.TMDB_API_KEY || window.process.env.TMDB_API_KEY || "fea469f5e20796590292a227a92a2fef"
    };

    // Expose to window.process.env for standard cross-compatibility
    Object.assign(window.process.env, window.ENV);

    // Universal Firebase Configuration Object
    window.FIREBASE_CONFIG = {
        apiKey: window.ENV.FIREBASE_API_KEY,
        authDomain: window.ENV.FIREBASE_AUTH_DOMAIN,
        databaseURL: window.ENV.FIREBASE_DATABASE_URL,
        projectId: window.ENV.FIREBASE_PROJECT_ID,
        storageBucket: window.ENV.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: window.ENV.FIREBASE_MESSAGING_SENDER_ID,
        appId: window.ENV.FIREBASE_APP_ID,
        measurementId: window.ENV.FIREBASE_MEASUREMENT_ID
    };
})(typeof window !== "undefined" ? window : globalThis);
