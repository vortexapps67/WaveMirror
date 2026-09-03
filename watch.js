// watch.js - WaveMirror Dedicated Streaming Player Page Controller
const CONTINUE_WATCHING_KEY = "wavemirror_continue_watching";

let activeMovie = null;
let currentId = null;
let currentType = "movie";
let currentServer = 1;
let currentImdb = "";
let blockedPopupsCount = 0;
let sessionWatchTimer = null;
let currentSessionSeconds = 0;
let pendingResumeData = null;

// Global Ad & Popup Shield Override (Blocks window.open popups)
window.open = function(url, target, features) {
    blockedPopupsCount++;
    console.warn(`[Shield] Intercepted popup #${blockedPopupsCount} attempt to: ${url}`);
    showToast("🛡️ Ad Popup Intercepted");
    return null;
};

document.addEventListener("DOMContentLoaded", async () => {
    // Load saved accent color
    const savedAccent = localStorage.getItem("wavemirror_accent_color");
    if (savedAccent) {
        setGlobalAccent(savedAccent);
    }

    // Parse URL params
    const params = new URLSearchParams(window.location.search);
    currentId = params.get("id");
    currentType = params.get("type") || "movie";

    if (!currentId) {
        showToast("Error: No media selected!");
        setTimeout(() => { window.location.href = "./"; }, 1500);
        return;
    }

    await initializePlayer();
});

async function initializePlayer() {
    const title = document.getElementById("modalTitle");
    const overview = document.getElementById("modalOverview");
    const tvControls = document.getElementById("tvControls");
    const resumeBanner = document.getElementById("resumePlaybackBanner");
    const resumeBannerText = document.getElementById("resumeBannerText");
    const sessionTimeDisplay = document.getElementById("playerSessionTimeDisplay");

    if (title) title.innerText = "Loading stream...";
    if (overview) overview.innerText = "Connecting to TMDB API & stream servers...";

    // Fetch details
    let movie = await fetchStreamDetails(currentId, currentType);
    if (!movie) {
        movie = { id: currentId, title: "Media Stream", year: "----", rating: "0.0", duration: "0h", overview: "Stream exclusive titles on WaveMirror." };
    }
    activeMovie = movie;
    currentImdb = movie.imdbId || movie.id;

    // Populate Info
    if (title) title.innerText = movie.title;
    const yElem = document.getElementById("modalYear");
    if (yElem) yElem.innerText = movie.year;
    const rElem = document.getElementById("modalRating");
    if (rElem) rElem.innerText = `★ ${movie.rating}`;
    const dElem = document.getElementById("modalDuration");
    if (dElem) dElem.innerText = movie.duration;
    if (overview) overview.innerText = movie.overview;
    const dirElem = document.getElementById("modalDirector");
    if (dirElem) dirElem.innerText = movie.director || "Featured Director";
    const cElem = document.getElementById("modalCast");
    if (cElem) cElem.innerText = movie.cast ? movie.cast.join(", ") : "Lead Actor";
    const gElem = document.getElementById("modalGenres");
    if (gElem) gElem.innerText = movie.genres ? movie.genres.join(" • ") : "Action";

    // Watchlist state check
    updateWatchlistButton();

    // Check saved progress in continue watching
    const saved = getSavedProgress(currentId);
    let targetSeason = 1;
    let targetEpisode = 1;
    currentSessionSeconds = 0;

    if (currentType === "tv") {
        if (tvControls) {
            tvControls.style.display = "flex";
            tvControls.classList.remove("hidden");
        }
        generateSeasonEpisodeDropdowns(movie.seasonsCount || 1);

        if (saved && (saved.season || saved.episode)) {
            targetSeason = saved.season || 1;
            targetEpisode = saved.episode || 1;
            const sSelect = document.getElementById("seasonSelect");
            const eSelect = document.getElementById("episodeSelect");
            if (sSelect) sSelect.value = targetSeason;
            if (eSelect) eSelect.value = targetEpisode;
        }
    } else {
        if (tvControls) {
            tvControls.style.display = "none";
            tvControls.classList.add("hidden");
        }
    }

    // Resume banner check
    if (saved && (saved.watchedSeconds > 30 || saved.season > 1 || saved.episode > 1)) {
        currentSessionSeconds = saved.watchedSeconds || 0;
        pendingResumeData = saved;
        const timeStr = formatSeconds(saved.watchedSeconds || 0);
        const epStr = currentType === "tv" ? `Season ${saved.season || 1}, Episode ${saved.episode || 1}` : `timestamp ${timeStr}`;

        if (resumeBanner && resumeBannerText) {
            resumeBannerText.innerHTML = `You left off at <strong>${epStr}</strong>. Pick up where you left off?`;
            resumeBanner.style.display = "flex";
        }
    } else {
        pendingResumeData = null;
        if (resumeBanner) resumeBanner.style.display = "none";
    }

    // Stream load
    if (currentType === "tv") {
        updateTvStream();
    } else {
        loadServer(1);
    }

    // Save initial continue watching entry
    saveCurrentProgress({
        id: movie.id,
        tmdbId: movie.tmdbId || movie.id,
        imdbId: movie.imdbId,
        title: movie.title,
        poster: movie.poster,
        backdrop: movie.backdrop || movie.poster,
        type: currentType,
        year: movie.year,
        rating: movie.rating,
        duration: movie.duration,
        season: targetSeason,
        episode: targetEpisode,
        watchedSeconds: currentSessionSeconds
    });

    // Session watch timer
    if (sessionWatchTimer) clearInterval(sessionWatchTimer);
    if (sessionTimeDisplay) sessionTimeDisplay.innerText = formatSeconds(currentSessionSeconds);

    sessionWatchTimer = setInterval(() => {
        currentSessionSeconds += 5;
        if (sessionTimeDisplay) {
            sessionTimeDisplay.innerText = formatSeconds(currentSessionSeconds);
        }
        const s = document.getElementById("seasonSelect")?.value || targetSeason;
        const e = document.getElementById("episodeSelect")?.value || targetEpisode;
        saveCurrentProgress({
            id: currentId,
            watchedSeconds: currentSessionSeconds,
            season: parseInt(s) || 1,
            episode: parseInt(e) || 1
        });
    }, 5000);
}

function confirmResumePlayback() {
    const resumeBanner = document.getElementById("resumePlaybackBanner");
    if (resumeBanner) resumeBanner.style.display = "none";
    if (pendingResumeData) {
        if (pendingResumeData.type === "tv" || currentType === "tv") {
            const sSelect = document.getElementById("seasonSelect");
            const eSelect = document.getElementById("episodeSelect");
            if (sSelect) sSelect.value = pendingResumeData.season || 1;
            if (eSelect) eSelect.value = pendingResumeData.episode || 1;
            updateTvStream();
        }
        showToast(`⚡ Resumed from last position (${formatSeconds(pendingResumeData.watchedSeconds || 0)})`);
    }
}

function dismissResumePlayback() {
    const resumeBanner = document.getElementById("resumePlaybackBanner");
    if (resumeBanner) resumeBanner.style.display = "none";
    currentSessionSeconds = 0;
    const sessionTimeDisplay = document.getElementById("playerSessionTimeDisplay");
    if (sessionTimeDisplay) sessionTimeDisplay.innerText = "00:00";
    if (currentType === "tv") {
        const sSelect = document.getElementById("seasonSelect");
        const eSelect = document.getElementById("episodeSelect");
        if (sSelect) sSelect.value = 1;
        if (eSelect) eSelect.value = 1;
        updateTvStream();
    }
    if (currentId) {
        saveCurrentProgress({
            id: currentId,
            watchedSeconds: 0,
            season: 1,
            episode: 1
        });
    }
    showToast("Starting stream from beginning");
}

function toggleCinemaLights() {
    const isDimmed = document.body.classList.toggle("cinema-lights-dim");
    const btn = document.getElementById("cinemaLightsBtn");
    if (btn) {
        btn.classList.toggle("active", isDimmed);
        btn.innerHTML = isDimmed ? "💡 Lights On" : "💡 Lights";
    }
    showToast(isDimmed ? "💡 Cinema Lights Dimmed" : "💡 Cinema Lights Restored");
}

function adjustSessionTime(deltaSeconds) {
    currentSessionSeconds = Math.max(0, currentSessionSeconds + deltaSeconds);
    const sessionTimeDisplay = document.getElementById("playerSessionTimeDisplay");
    if (sessionTimeDisplay) sessionTimeDisplay.innerText = formatSeconds(currentSessionSeconds);

    const s = document.getElementById("seasonSelect")?.value || 1;
    const e = document.getElementById("episodeSelect")?.value || 1;

    if (currentId) {
        saveCurrentProgress({
            id: currentId,
            watchedSeconds: currentSessionSeconds,
            season: parseInt(s) || 1,
            episode: parseInt(e) || 1
        });
    }
    showToast(deltaSeconds > 0 ? `⏩ +${Math.round(deltaSeconds/60)}m (${formatSeconds(currentSessionSeconds)})` : `⏪ ${Math.round(deltaSeconds/60)}m (${formatSeconds(currentSessionSeconds)})`);
}

function saveManualBookmark() {
    const input = document.getElementById("manualBookmarkInput");
    if (!input || !input.value.trim()) {
        showToast("Enter a timestamp e.g. 45:20 or 1:15:00");
        return;
    }
    const seconds = parseSeconds(input.value.trim());
    if (seconds <= 0 && input.value.trim() !== "0" && input.value.trim() !== "00:00") {
        showToast("Invalid format. Use MM:SS or HH:MM:SS");
        return;
    }
    currentSessionSeconds = seconds;
    const sessionTimeDisplay = document.getElementById("playerSessionTimeDisplay");
    if (sessionTimeDisplay) sessionTimeDisplay.innerText = formatSeconds(seconds);

    const s = document.getElementById("seasonSelect")?.value || 1;
    const e = document.getElementById("episodeSelect")?.value || 1;

    if (currentId) {
        saveCurrentProgress({
            id: currentId,
            watchedSeconds: seconds,
            season: parseInt(s) || 1,
            episode: parseInt(e) || 1
        });
    }
    input.value = "";
    showToast(`🔖 Bookmark saved at ${formatSeconds(seconds)}!`);
}

function getSavedProgress(id) {
    try {
        const stored = localStorage.getItem(CONTINUE_WATCHING_KEY);
        const list = stored ? JSON.parse(stored) : [];
        return list.find(entry => String(entry.id) === String(id));
    } catch (e) {
        return null;
    }
}

function saveCurrentProgress(item) {
    try {
        let list = JSON.parse(localStorage.getItem(CONTINUE_WATCHING_KEY) || "[]");
        const existing = list.find(entry => String(entry.id) === String(item.id));

        const updated = {
            id: String(item.id),
            tmdbId: item.tmdbId || (existing ? existing.tmdbId : item.id),
            imdbId: item.imdbId || (existing ? existing.imdbId : currentImdb),
            title: item.title || (existing ? existing.title : activeMovie ? activeMovie.title : "Media Stream"),
            poster: item.poster || (existing ? existing.poster : activeMovie ? activeMovie.poster : ""),
            backdrop: item.backdrop || (existing ? existing.backdrop : activeMovie ? activeMovie.backdrop : ""),
            type: item.type || (existing ? existing.type : currentType),
            year: item.year || (existing ? existing.year : activeMovie ? activeMovie.year : "2024"),
            rating: item.rating || (existing ? existing.rating : activeMovie ? activeMovie.rating : "8.0"),
            duration: item.duration || (existing ? existing.duration : activeMovie ? activeMovie.duration : "2h"),
            season: item.season !== undefined ? parseInt(item.season) : (existing && existing.season !== undefined ? existing.season : 1),
            episode: item.episode !== undefined ? parseInt(item.episode) : (existing && existing.episode !== undefined ? existing.episode : 1),
            server: item.server !== undefined ? item.server : (existing ? existing.server : 1),
            watchedSeconds: item.watchedSeconds !== undefined ? item.watchedSeconds : (existing ? existing.watchedSeconds : 0),
            durationSeconds: item.durationSeconds || (existing ? existing.durationSeconds : 7200),
            progressPercent: item.progressPercent !== undefined ? item.progressPercent : (existing ? existing.progressPercent : 0),
            lastWatchedAt: Date.now()
        };

        if (updated.durationSeconds > 0 && updated.watchedSeconds > 0) {
            updated.progressPercent = Math.min(100, Math.max(1, Math.round((updated.watchedSeconds / updated.durationSeconds) * 100)));
        }

        list = list.filter(entry => String(entry.id) !== String(item.id));
        list.unshift(updated);
        if (list.length > 25) list = list.slice(0, 25);
        localStorage.setItem(CONTINUE_WATCHING_KEY, JSON.stringify(list));
    } catch (e) {
        console.error("Error saving progress:", e);
    }
}

function formatSeconds(sec) {
    if (!sec || isNaN(sec)) return "00:00";
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function parseSeconds(str) {
    if (!str) return 0;
    const parts = str.trim().split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0] * 60;
    return 0;
}

function loadServer(num, btnElement = null) {
    currentServer = num;
    const iframe = document.getElementById("playerIframe");
    if (!iframe) return;

    if (currentType === "tv") {
        updateTvStream();
    } else {
        if (num === 1) {
            iframe.src = `https://vidlink.pro/movie/${currentId}`;
        } else if (num === 2) {
            iframe.src = `https://vidsrc.xyz/embed/movie/${currentImdb}`;
        } else if (num === 3) {
            iframe.src = `https://vidsrc.cc/embed/movie/${currentId}`;
        } else {
            iframe.src = `https://autoembed.cc/embed/movie/${currentId}`;
        }
    }

    if (btnElement) {
        const buttons = document.querySelectorAll(".server-btn");
        buttons.forEach(b => b.classList.remove("active"));
        btnElement.classList.add("active");
    }
}

function generateSeasonEpisodeDropdowns(seasonsCount) {
    const seasonSelect = document.getElementById("seasonSelect");
    const episodeSelect = document.getElementById("episodeSelect");
    if (!seasonSelect || !episodeSelect) return;

    seasonSelect.innerHTML = Array.from({length: seasonsCount}, (_, i) => `<option value="${i+1}">Season ${i+1}</option>`).join('');
    episodeSelect.innerHTML = Array.from({length: 24}, (_, i) => `<option value="${i+1}">Episode ${i+1}</option>`).join('');
}

function updateTvStream() {
    const s = document.getElementById("seasonSelect")?.value || 1;
    const e = document.getElementById("episodeSelect")?.value || 1;
    const iframe = document.getElementById("playerIframe");
    if (!iframe) return;

    if (currentServer === 1) {
        iframe.src = `https://vidlink.pro/tv/${currentId}/${s}/${e}`;
    } else if (currentServer === 2) {
        iframe.src = `https://vidsrc.xyz/embed/tv/${currentId}/${s}-${e}`;
    } else if (currentServer === 3) {
        iframe.src = `https://vidsrc.cc/embed/tv/${currentId}/${s}/${e}`;
    } else {
        iframe.src = `https://autoembed.cc/embed/tv/${currentId}/${s}/${e}`;
    }

    if (currentId) {
        saveCurrentProgress({
            id: currentId,
            season: parseInt(s) || 1,
            episode: parseInt(e) || 1
        });
    }
}

function closeAdOverlay() {
    const iframe = document.getElementById("playerIframe");
    if (!iframe) return;
    const currentSrc = iframe.src;
    iframe.src = "about:blank";
    setTimeout(() => {
        iframe.src = currentSrc;
        showToast("⚡ Player Cleaned & Ad Overlay Cleared");
    }, 100);
}

function handleWatchlistToggle() {
    if (!activeMovie) return;
    let watchlist = JSON.parse(localStorage.getItem("wavemirror_watchlist")) || [];
    const index = watchlist.findIndex(m => String(m.id) === String(activeMovie.id));
    
    if (index === -1) {
        watchlist.push(activeMovie);
        localStorage.setItem("wavemirror_watchlist", JSON.stringify(watchlist));
        showToast(`Added "${activeMovie.title}" to Watchlist`);
    } else {
        watchlist.splice(index, 1);
        localStorage.setItem("wavemirror_watchlist", JSON.stringify(watchlist));
        showToast(`Removed "${activeMovie.title}" from Watchlist`);
    }
    updateWatchlistButton();
}

function updateWatchlistButton() {
    const btn = document.getElementById("modalWatchlistBtn");
    if (!btn || !activeMovie) return;
    
    let watchlist = JSON.parse(localStorage.getItem("wavemirror_watchlist")) || [];
    const inWatchlist = watchlist.some(m => String(m.id) === String(activeMovie.id));
    btn.innerText = inWatchlist ? "✓ In Watchlist" : "+ Add to Watchlist";
}

function startWatchPartyFromPlayer() {
    if (!currentId) return;
    window.location.href = `./?startParty=true&movieId=${currentId}&type=${currentType}&server=${currentServer}`;
}

function setGlobalAccent(colorHex) {
    document.documentElement.style.setProperty("--primary-neon", colorHex);
    document.documentElement.style.setProperty("--primary-indigo", colorHex);
    document.documentElement.style.setProperty("--border-glow", `rgba(${hexToRgbValues(colorHex)}, 0.45)`);
}

function hexToRgbValues(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return "99, 102, 241";
    return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
}

function showToast(msg) {
    const container = document.getElementById("toastContainer") || document.body;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(50px)";
        setTimeout(() => toast.remove(), 300);
    }, 2800);
}
