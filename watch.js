// watch.js - WaveMirror Dedicated Streaming Hub Controller
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
let searchDebounce = null;

// Global Ad & Popup Shield Override (Blocks window.open popups)
window.open = function(url, target, features) {
    blockedPopupsCount++;
    console.warn(`[Shield] Intercepted popup #${blockedPopupsCount} attempt to: ${url}`);
    const shieldStatus = document.getElementById("shieldStatus");
    if (shieldStatus) {
        shieldStatus.innerText = `🛡️ Popup Shield Active (${blockedPopupsCount} Blocked)`;
    }
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
    const autoResume = params.get("resume") === "true";

    if (!currentId) {
        showToast("Error: No media selected! Redirecting...");
        setTimeout(() => { window.location.href = "./"; }, 1500);
        return;
    }

    updateWatchlistCount();
    await initializePlayer(autoResume);
    await fetchAndRenderSimilar(currentId, currentType);

    // Global keyboard shortcut
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeWatchlistDrawer();
            const results = document.getElementById("watchSearchResults");
            if (results) results.classList.remove("active");
        }
    });

    // Close search dropdown on click outside
    document.addEventListener("click", (e) => {
        const searchBox = document.querySelector(".watch-search-box");
        const results = document.getElementById("watchSearchResults");
        if (searchBox && !searchBox.contains(e.target) && results) {
            results.classList.remove("active");
        }
    });

    initTvNavigation();
});

async function initializePlayer(autoResume = false) {
    const title = document.getElementById("modalTitle");
    const overview = document.getElementById("modalOverview");
    const tvControls = document.getElementById("tvControls");
    const resumeBanner = document.getElementById("resumePlaybackBanner");
    const resumeBannerText = document.getElementById("resumeBannerText");
    const sessionTimeDisplay = document.getElementById("playerSessionTimeDisplay");

    if (title) title.innerText = "Loading stream...";
    if (overview) overview.innerText = "Connecting to TMDB API & stream servers...";

    // Fetch stream details
    let movie = await fetchStreamDetails(currentId, currentType);
    if (!movie) {
        movie = {
            id: currentId,
            title: "Media Stream",
            year: "2024",
            rating: "8.0",
            duration: "2h",
            overview: "Stream exclusive titles in 4K Ultra HD on WaveMirror.",
            genres: ["Featured", "Cinema"],
            poster: "",
            backdrop: ""
        };
    }
    activeMovie = movie;
    currentImdb = movie.imdbId || movie.id;
    document.title = `${movie.title} - WaveMirror Stream`;

    // Populate Info
    if (title) title.innerText = movie.title;
    const yElem = document.getElementById("modalYear");
    if (yElem) yElem.innerText = movie.year || "2024";
    const rElem = document.getElementById("modalRating");
    if (rElem) rElem.innerText = `★ ${movie.rating || '8.0'}`;
    const dElem = document.getElementById("modalDuration");
    if (dElem) dElem.innerText = movie.duration || "2h";
    if (overview) overview.innerText = movie.overview || "No overview available.";
    const dirElem = document.getElementById("modalDirector");
    if (dirElem) dirElem.innerText = movie.director || "Featured Director";
    const cElem = document.getElementById("modalCast");
    if (cElem) cElem.innerText = movie.cast ? movie.cast.join(", ") : "Lead Cast";
    const gElem = document.getElementById("modalGenres");
    if (gElem) gElem.innerText = movie.genres ? movie.genres.join(" • ") : "Action • Cinema";

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

        if (autoResume) {
            if (resumeBanner) resumeBanner.style.display = "none";
            showToast(`⚡ Resumed playback from ${epStr}`);
        } else if (resumeBanner && resumeBannerText) {
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

    // Session watch timer (runs every 5 seconds to track elapsed duration)
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

async function fetchStreamDetails(id, type = "movie") {
    try {
        const endpoint = `${TMDB_BASE_URL}/${type}/${id}?api_key=${TMDB_API_KEY}&append_to_response=credits,external_ids`;
        const res = await fetch(endpoint);
        if (!res.ok) return null;
        const data = await res.json();

        const directorObj = data.credits?.crew?.find(c => c.job === "Director");
        const castMembers = data.credits?.cast?.slice(0, 5).map(c => c.name) || [];
        const genres = data.genres?.map(g => g.name) || [];

        return {
            id: data.id,
            tmdbId: data.id,
            imdbId: data.external_ids?.imdb_id || (type === "movie" ? "tt15239678" : "tt0944947"),
            title: data.title || data.name,
            year: (data.release_date || data.first_air_date || "2024").substring(0, 4),
            rating: data.vote_average ? data.vote_average.toFixed(1) : "8.0",
            duration: data.runtime ? `${Math.floor(data.runtime / 60)}h ${data.runtime % 60}m` : (data.episode_run_time?.[0] ? `${data.episode_run_time[0]}m/ep` : "45m/ep"),
            overview: data.overview || "Stream exclusive titles on WaveMirror.",
            genres: genres,
            poster: data.poster_path ? `${TMDB_IMG_POSTER}${data.poster_path}` : "",
            backdrop: data.backdrop_path ? `${TMDB_IMG_BACKDROP}${data.backdrop_path}` : "",
            director: directorObj ? directorObj.name : "Featured Director",
            cast: castMembers,
            seasonsCount: data.number_of_seasons || 1,
            type: type
        };
    } catch (e) {
        console.warn("[Watch] Error fetching TMDB details:", e);
        if (typeof FEATURED_MOVIES !== "undefined") {
            return FEATURED_MOVIES.find(m => m.id == id) || null;
        }
        return null;
    }
}

async function fetchAndRenderSimilar(id, type = "movie") {
    const grid = document.getElementById("similarGrid");
    if (!grid) return;

    try {
        const url = `${TMDB_BASE_URL}/${type}/${id}/recommendations?api_key=${TMDB_API_KEY}`;
        const res = await fetch(url);
        let items = [];
        if (res.ok) {
            const data = await res.json();
            items = data.results || [];
        }

        // Fallback to top rated/popular if recommendations is empty
        if (!items || items.length === 0) {
            const fallbackUrl = `${TMDB_BASE_URL}/trending/${type}/week?api_key=${TMDB_API_KEY}`;
            const fRes = await fetch(fallbackUrl);
            if (fRes.ok) {
                const fData = await fRes.json();
                items = fData.results?.filter(i => String(i.id) !== String(id)) || [];
            }
        }

        if (!items || items.length === 0) {
            grid.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem;">No direct recommendations available.</p>`;
            return;
        }

        grid.innerHTML = items.slice(0, 10).map(item => {
            const title = item.title || item.name;
            const year = (item.release_date || item.first_air_date || "2024").substring(0, 4);
            const poster = item.poster_path ? `${TMDB_IMG_POSTER}${item.poster_path}` : (item.backdrop_path ? `${TMDB_IMG_BACKDROP}${item.backdrop_path}` : "");
            const rating = item.vote_average ? item.vote_average.toFixed(1) : "8.0";

            return `
                <a class="similar-card" href="watch.html?id=${item.id}&type=${type}">
                    <img class="similar-poster" src="${poster}" alt="${title}" loading="lazy" onerror="this.src='https://via.placeholder.com/300x450?text=${encodeURIComponent(title)}'">
                    <div class="similar-info">
                        <div class="similar-title" title="${title}">${title}</div>
                        <div class="similar-sub">
                            <span>${year}</span>
                            <span style="color: var(--primary-gold); font-weight: 700;">★ ${rating}</span>
                        </div>
                    </div>
                </a>
            `;
        }).join('');
    } catch (e) {
        console.warn("[Watch] Error rendering recommendations:", e);
    }
}

function handleWatchLiveSearch(query) {
    clearTimeout(searchDebounce);
    const resultsContainer = document.getElementById("watchSearchResults");
    if (!resultsContainer) return;

    if (!query || query.trim().length < 2) {
        resultsContainer.innerHTML = "";
        resultsContainer.classList.remove("active");
        return;
    }

    searchDebounce = setTimeout(async () => {
        try {
            const res = await fetch(`${TMDB_BASE_URL}/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query.trim())}`);
            if (!res.ok) return;
            const data = await res.json();
            const valid = (data.results || []).filter(item => (item.media_type === "movie" || item.media_type === "tv") && (item.poster_path || item.backdrop_path));

            if (valid.length === 0) {
                resultsContainer.innerHTML = `<div style="padding: 1rem; color: var(--text-muted); font-size: 0.85rem; text-align: center;">No matches found for "${query}"</div>`;
                resultsContainer.classList.add("active");
                return;
            }

            resultsContainer.innerHTML = valid.slice(0, 6).map(item => {
                const title = item.title || item.name;
                const type = item.media_type || "movie";
                const year = (item.release_date || item.first_air_date || "2024").substring(0, 4);
                const poster = item.poster_path ? `${TMDB_IMG_POSTER}${item.poster_path}` : `${TMDB_IMG_BACKDROP}${item.backdrop_path}`;
                const rating = item.vote_average ? item.vote_average.toFixed(1) : "8.0";

                return `
                    <a class="watch-search-item" href="watch.html?id=${item.id}&type=${type}">
                        <img src="${poster}" alt="${title}">
                        <div style="flex: 1; overflow: hidden;">
                            <div style="font-weight: 600; font-size: 0.88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</div>
                            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">
                                <span style="text-transform: uppercase; color: var(--primary-cyan);">${type}</span> • ${year} • ★ ${rating}
                            </div>
                        </div>
                    </a>
                `;
            }).join('');
            resultsContainer.classList.add("active");
        } catch (e) {
            console.warn("[Watch] Live search error:", e);
        }
    }, 300);
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
    renderTvEpisodesGrid();
}

function renderTvEpisodesGrid() {
    const grid = document.getElementById("tvEpisodesGrid");
    if (!grid) return;
    const s = document.getElementById("seasonSelect")?.value || 1;
    const currentEp = document.getElementById("episodeSelect")?.value || 1;
    
    grid.innerHTML = Array.from({length: 24}, (_, i) => {
        const epNum = i + 1;
        const isActive = parseInt(currentEp) === epNum;
        return `
            <button class="episode-tv-tile ${isActive ? 'active' : ''}" onclick="selectEpisodeFromTvGrid(${epNum})">
                S${s}:E${epNum}
            </button>
        `;
    }).join('');
}

function selectEpisodeFromTvGrid(epNum) {
    const eSelect = document.getElementById("episodeSelect");
    if (eSelect) {
        eSelect.value = epNum;
        updateTvStream();
    }
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

    renderTvEpisodesGrid();

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
    updateWatchlistCount();
}

function updateWatchlistButton() {
    const btn = document.getElementById("modalWatchlistBtn");
    if (!btn || !activeMovie) return;
    
    let watchlist = JSON.parse(localStorage.getItem("wavemirror_watchlist")) || [];
    const inWatchlist = watchlist.some(m => String(m.id) === String(activeMovie.id));
    btn.innerText = inWatchlist ? "✓ In Watchlist" : "+ Add to Watchlist";
}

function updateWatchlistCount() {
    const badge = document.getElementById("watchlistCount");
    if (!badge) return;
    const watchlist = JSON.parse(localStorage.getItem("wavemirror_watchlist")) || [];
    badge.innerText = watchlist.length;
}

function toggleWatchlistDrawer() {
    const drawer = document.getElementById("drawerBackdrop");
    if (!drawer) return;
    const isActive = drawer.classList.toggle("active");
    if (isActive) {
        renderWatchlistDrawer();
    }
}

function closeWatchlistDrawer() {
    const drawer = document.getElementById("drawerBackdrop");
    if (drawer) drawer.classList.remove("active");
}

function renderWatchlistDrawer() {
    const container = document.getElementById("watchlistContent");
    if (!container) return;
    const watchlist = JSON.parse(localStorage.getItem("wavemirror_watchlist")) || [];

    if (watchlist.length === 0) {
        container.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; color: var(--text-muted); gap: 0.8rem; padding: 2rem;">
                <span style="font-size: 2.5rem;">🍿</span>
                <h4 style="color: #fff; font-size: 1.1rem; margin: 0;">Your Watchlist is Empty</h4>
                <p style="font-size: 0.85rem; margin: 0; line-height: 1.5;">Save titles to watch later by clicking "+ Add to Watchlist".</p>
            </div>
        `;
        return;
    }

    container.innerHTML = watchlist.map(item => `
        <div class="watchlist-card" style="display: flex; gap: 0.8rem; background: var(--bg-card); border: 1px solid var(--border-glass); border-radius: var(--radius-sm); padding: 0.6rem; margin-bottom: 0.8rem; align-items: center;">
            <img src="${item.poster}" alt="${item.title}" style="width: 50px; height: 75px; border-radius: 4px; object-fit: cover;">
            <div style="flex: 1; overflow: hidden;">
                <div style="font-weight: 700; font-size: 0.9rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.title}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted); margin: 0.2rem 0;">★ ${item.rating || '8.0'} • ${item.year || '2024'}</div>
                <div style="display: flex; gap: 0.5rem; margin-top: 0.4rem;">
                    <a href="watch.html?id=${item.id}&type=${item.type || 'movie'}" class="btn-primary" style="padding: 0.25rem 0.65rem; font-size: 0.72rem; text-decoration: none;">▶ Play</a>
                    <button class="btn-secondary" style="padding: 0.25rem 0.65rem; font-size: 0.72rem;" onclick="removeFromWatchlist('${item.id}')">✕ Remove</button>
                </div>
            </div>
        </div>
    `).join('');
}

function removeFromWatchlist(id) {
    let watchlist = JSON.parse(localStorage.getItem("wavemirror_watchlist")) || [];
    watchlist = watchlist.filter(m => String(m.id) !== String(id));
    localStorage.setItem("wavemirror_watchlist", JSON.stringify(watchlist));
    renderWatchlistDrawer();
    updateWatchlistCount();
    updateWatchlistButton();
    showToast("Removed from Watchlist");
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

/* ---------------- 📺 10-Foot Smart TV Mode & Spatial Navigation ---------------- */
function isSmartTvUserAgent() {
    const ua = navigator.userAgent;
    return /SmartTV|Tizen|Web0S|webOS|Android TV|GoogleTV|FireTV|AppleTV|PlayStation|Xbox|HbbTV|CrKey|LargeScreen/i.test(ua);
}

function initTvNavigation() {
    const saved = localStorage.getItem("wavemirror_tv_mode");
    const isTv = saved === "true" || (saved === null && isSmartTvUserAgent());
    if (isTv) {
        document.body.classList.add("tv-mode");
    }
    updateTvModeButtons();
    setupSpatialNavigation();
}

function toggleTvMode() {
    const isTv = document.body.classList.toggle("tv-mode");
    localStorage.setItem("wavemirror_tv_mode", isTv ? "true" : "false");
    updateTvModeButtons();
    showToast(isTv ? "📺 Smart TV Mode Activated (10-Foot UI)" : "🖥️ Standard Web UI Restored");
    if (isTv) {
        focusFirstTvElement();
    }
}

function updateTvModeButtons() {
    const isTv = document.body.classList.contains("tv-mode");
    const btns = document.querySelectorAll(".tv-mode-btn");
    btns.forEach(btn => {
        btn.innerHTML = isTv ? "📺 Exit TV Mode" : "📺 TV Mode";
        btn.classList.toggle("active", isTv);
    });
}

function focusFirstTvElement() {
    const focusable = getFocusableElements();
    if (focusable.length > 0) {
        focusable[0].focus();
        focusable[0].scrollIntoView({ behavior: "smooth", block: "center" });
    }
}

function getFocusableElements() {
    return Array.from(document.querySelectorAll(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href], input:not([disabled]), select:not([disabled]), .movie-card, .top10-card, .continue-card, .server-btn, .similar-card, .episode-tv-tile, .genre-chip'
    )).filter(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0 && el.offsetHeight > 0;
    });
}

function setupSpatialNavigation() {
    document.addEventListener("keydown", (e) => {
        // 'T' toggles TV mode
        if (e.key.toLowerCase() === "t" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
            e.preventDefault();
            toggleTvMode();
            return;
        }

        if (!document.body.classList.contains("tv-mode")) return;

        // D-Pad Arrow Navigation
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
            e.preventDefault();
            navigateSpatial(e.key);
        }
    });
}

function navigateSpatial(direction) {
    const focusables = getFocusableElements();
    if (!focusables.length) return;

    const current = document.activeElement && focusables.includes(document.activeElement) ? document.activeElement : null;
    if (!current) {
        focusables[0].focus();
        focusables[0].scrollIntoView({ behavior: "smooth", block: "center" });
        return;
    }

    const currentRect = current.getBoundingClientRect();
    const currentCenter = {
        x: currentRect.left + currentRect.width / 2,
        y: currentRect.top + currentRect.height / 2
    };

    let bestCandidate = null;
    let minDistance = Infinity;

    focusables.forEach(el => {
        if (el === current) return;
        const rect = el.getBoundingClientRect();
        const center = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };

        const dx = center.x - currentCenter.x;
        const dy = center.y - currentCenter.y;

        // Validate direction
        let valid = false;
        if (direction === "ArrowRight" && dx > 15 && Math.abs(dy) < Math.abs(dx) * 1.5) valid = true;
        if (direction === "ArrowLeft" && dx < -15 && Math.abs(dy) < Math.abs(dx) * 1.5) valid = true;
        if (direction === "ArrowDown" && dy > 15) valid = true;
        if (direction === "ArrowUp" && dy < -15) valid = true;

        if (valid) {
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < minDistance) {
                minDistance = distance;
                bestCandidate = el;
            }
        }
    });

    if (bestCandidate) {
        bestCandidate.focus();
        bestCandidate.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }
}
