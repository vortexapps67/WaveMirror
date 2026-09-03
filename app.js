// WaveMirror Application Engine - Powered by TMDB API (apikey: fea469f5e20796590292a227a92a2fef)

let currentCatalog = [...FEATURED_MOVIES];
let activeGenre = "All";
let currentPlatform = "Trending";
let activeMovie = null;
let heroSlideIndex = 0;
let heroTimer = null;
let searchDebounce = null;

// Global Stream & Shield State
window.currentId = null;
window.currentType = "movie";
window.currentImdb = null;
window.currentServer = 1;
let blockedPopupsCount = 0;

// Global Ad & Popup Shield Override (Blocks window.open popups)
window.open = function(url, target, features) {
    blockedPopupsCount++;
    console.warn(`[Shield] Intercepted popup #${blockedPopupsCount} attempt to: ${url}`);
    const statusText = document.getElementById("shieldStatus");
    if (statusText) {
        statusText.innerText = `🛡️ Popup Shield Active (${blockedPopupsCount} Ad Popups Intercepted)`;
    }
    showToast("🛡️ Ad Popup Intercepted");
    return null;
};

// Initialize App
document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

async function initApp() {
    showLoader(true);
    
    try {
        const [liveMovies, liveSeries] = await Promise.all([
            fetchLiveTrendingMovies(),
            fetchLiveTrendingSeries()
        ]);

        if (liveMovies && liveMovies.length > 0) {
            currentCatalog = liveMovies;
        }

        renderHeroSlider();
        renderTop10Rail(liveMovies);
        renderMovieGrid(currentCatalog);

        if (liveSeries && liveSeries.length > 0) {
            renderSeriesGrid(liveSeries);
        } else {
            renderSeriesGrid();
        }
    } catch (e) {
        console.warn("Falling back to pre-loaded dataset:", e);
        renderHeroSlider();
        renderTop10Rail(FEATURED_MOVIES);
        renderMovieGrid(FEATURED_MOVIES);
        renderSeriesGrid();
    }

    updateWatchlistUI();
    initScrollEffects();
    showLoader(false);

    // Render Continue Watching section on init
    renderContinueWatching();

    // Set 'Trending' platform pill as active on load
    const platformPills = document.querySelectorAll(".platform-pill");
    platformPills.forEach(btn => {
        const label = btn.innerText.trim();
        if (label === "Trending" || label === "🔥 Trending") {
            btn.classList.add("active");
        }
    });

    // Search CTA button handler
    const searchCtaBtn = document.getElementById("search-cta-btn");
    if (searchCtaBtn) {
        searchCtaBtn.addEventListener("click", () => {
            const searchInput = document.querySelector(".search-input") || document.getElementById("searchInput");
            if (searchInput) {
                searchInput.focus();
                searchInput.scrollIntoView({ behavior: "smooth", block: "center" });
            }
        });
    }

    // Initialize mock reviews database
    initReviewsDatabase();
}

function showLoader(show) {
    const loader = document.getElementById("global-loader");
    if (!loader) return;
    if (show) {
        loader.classList.remove("hidden");
    } else {
        setTimeout(() => loader.classList.add("hidden"), 300);
    }
}

/* ---------------- Hero Spotlight Slider ---------------- */
function renderHeroSlider() {
    const slider = document.getElementById("heroSlider");
    const dots = document.getElementById("heroDots");
    if (!slider || !dots) return;

    const featuredList = currentCatalog.slice(0, 5);
    
    slider.innerHTML = featuredList.map((movie, idx) => `
        <div class="hero-slide ${idx === 0 ? 'active' : ''}" id="slide-${idx}">
            <img class="hero-backdrop" src="${movie.backdrop}" alt="${movie.title}" loading="${idx === 0 ? 'eager' : 'lazy'}">
            <div class="hero-overlay"></div>
            <div class="hero-content">
                <span class="hero-tag">TMDB FEATURED ${movie.type.toUpperCase()}</span>
                <h1 class="hero-title">${movie.title}</h1>
                <div class="hero-meta">
                    <span class="rating-imdb">★ ${movie.rating}</span>
                    <span class="meta-badge">${movie.year}</span>
                    <span class="meta-badge">${movie.quality || '4K'}</span>
                    <span>${movie.duration}</span>
                </div>
                <p class="hero-overview">${movie.overview}</p>
                <div class="hero-actions">
                    <button class="btn-primary" onclick="openPlayerModal('${movie.id}', '${movie.type}')">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        Play Free Stream
                    </button>
                    <button class="btn-secondary" onclick="playTrailer('${movie.id}', '${movie.type}')" style="border-color: var(--primary-gold); color: var(--primary-gold);">
                        🎬 Watch Trailer
                    </button>
                    <button class="btn-secondary" onclick="toggleWatchlistFromHero('${movie.id}')">
                        ${isInWatchlist(movie.id) ? '✓ Saved' : '+ Watchlist'}
                    </button>
                </div>
            </div>
        </div>
    `).join('');

    dots.innerHTML = featuredList.map((_, idx) => `
        <div class="hero-dot ${idx === 0 ? 'active' : ''}" onclick="goToHeroSlide(${idx})"></div>
    `).join('');

    startHeroTimer();
}

function startHeroTimer() {
    clearInterval(heroTimer);
    heroTimer = setInterval(() => {
        const featuredCount = Math.min(5, currentCatalog.length);
        heroSlideIndex = (heroSlideIndex + 1) % featuredCount;
        goToHeroSlide(heroSlideIndex);
    }, 6000);
}

function goToHeroSlide(index) {
    heroSlideIndex = index;
    const slides = document.querySelectorAll(".hero-slide");
    const dots = document.querySelectorAll(".hero-dot");

    slides.forEach((slide, i) => slide.classList.toggle("active", i === index));
    dots.forEach((dot, i) => dot.classList.toggle("active", i === index));
}

/* ---------------- Top 10 Ranked Rail ---------------- */
function renderTop10Rail(list = currentCatalog) {
    const rail = document.getElementById("top10Grid");
    if (!rail) return;

    const top10Items = list.slice(0, 10);
    rail.innerHTML = top10Items.map((movie, idx) => `
        <div class="top10-card" onclick="openPlayerModal('${movie.id}', '${movie.type}')">
            <span class="rank-number">${idx + 1}</span>
            <div class="movie-card" style="margin-left: 15px;">
                <div class="poster-wrapper">
                    <img class="poster-img" src="${movie.poster}" alt="${movie.title}" loading="lazy">
                    <span class="card-quality-badge">${movie.quality || '4K'}</span>
                    <div class="card-overlay">
                        <div class="play-icon-btn">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                    </div>
                </div>
                <div class="movie-info">
                    <div class="movie-title">${movie.title}</div>
                    <div class="movie-subinfo">
                        <span>${movie.year}</span>
                        <span style="color: var(--accent-gold); font-weight:700;">★ ${movie.rating}</span>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

/* ---------------- Catalog & Genre Explorer ---------------- */
async function filterGenre(genre) {
    activeGenre = genre;
    const chips = document.querySelectorAll(".genre-chip");
    chips.forEach(chip => {
        chip.classList.toggle("active", chip.innerText === genre || (genre === "All" && chip.innerText === "All Titles"));
    });

    showLoader(true);
    let results = [];
    try {
        if (genre === "All") {
            const year = document.getElementById("filterYear").value;
            const lang = document.getElementById("filterLang").value;
            if (year !== "All" || lang !== "All") {
                const url = applyAdvancedFilters(`${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}`, "movie");
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    results = parseTMDBItems(data.results, "movie");
                }
            } else {
                results = currentCatalog;
            }
        } else {
            const genreId = GENRE_MAP[genre];
            if (genreId) {
                const url = applyAdvancedFilters(`${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=${genreId}`, "movie");
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    results = parseTMDBItems(data.results, "movie");
                }
            } else {
                results = currentCatalog.filter(m => m.genres && m.genres.includes(genre));
            }
        }
    } catch (e) {
        console.warn("Error filtering genre with advanced parameters:", e);
        results = currentCatalog.filter(m => genre === "All" || (m.genres && m.genres.includes(genre)));
    }
    showLoader(false);
    renderMovieGrid(results);
}

function renderMovieGrid(itemsToRender = currentCatalog) {
    const grid = document.getElementById("movieGrid");
    if (!grid) return;

    if (!itemsToRender || itemsToRender.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; color: var(--text-muted);">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 1rem;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <h3>No titles found</h3>
                <p style="font-size: 0.9rem; margin-top: 0.5rem;">Try another search term or genre filter.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = itemsToRender.map(movie => createMovieCardHTML(movie)).join('');
}

function renderSeriesGrid(seriesList = null) {
    const grid = document.getElementById("seriesGrid");
    if (!grid) return;

    const list = seriesList || currentCatalog.filter(m => m.type === "tv");
    grid.innerHTML = list.map(show => createMovieCardHTML(show)).join('');
}

function createMovieCardHTML(movie) {
    return `
        <div class="movie-card" onclick="openPlayerModal('${movie.id}', '${movie.type || 'movie'}')">
            <div class="poster-wrapper">
                <img class="poster-img" src="${movie.poster}" alt="${movie.title}" loading="lazy">
                <span class="card-badge-top">★ ${movie.rating}</span>
                <span class="card-quality-badge">${movie.quality || '4K'}</span>
                <div class="card-overlay">
                    <div class="play-icon-btn">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                </div>
            </div>
            <div class="movie-info">
                <div class="movie-title">${movie.title}</div>
                <div class="movie-subinfo">
                    <span>${movie.year}</span>
                    <span>${movie.duration}</span>
                </div>
            </div>
        </div>
    `;
}

/* ---------------- Predictive Real-Time TMDB Search ---------------- */
function handleSearch(event) {
    const query = event.target.value.trim();
    clearTimeout(searchDebounce);

    if (query.length < 2) {
        document.getElementById("exploreHeaderTitle").innerText = "Explore Catalog";
        renderMovieGrid(currentCatalog);
        return;
    }

    searchDebounce = setTimeout(async () => {
        showLoader(true);
        const searchResults = await fetchLiveSearch(query);
        showLoader(false);
        
        document.getElementById("exploreHeaderTitle").innerText = `TMDB Search: "${query}"`;
        scrollToSection('explore');
        renderMovieGrid(searchResults);
    }, 400);
}

/* ---------------- Dedicated Watch Page Route Engine ---------------- */
function openPlayerModal(id, mediaType = "movie", autoResume = false) {
    const resumeParam = autoResume ? "&resume=true" : "";
    window.location.href = `watch.html?id=${id}&type=${mediaType || 'movie'}${resumeParam}`;
}

function handleModalWatchlistToggle() {
    if (!activeMovie) return;
    const added = toggleWatchlist(activeMovie);
    updateModalWatchlistBtn();
    updateWatchlistUI();
    showToast(added ? `Added "${activeMovie.title}" to Watchlist` : `Removed "${activeMovie.title}" from Watchlist`);
}

function updateModalWatchlistBtn() {
    const btn = document.getElementById("modalWatchlistBtn");
    if (!btn || !activeMovie) return;
    const inList = isInWatchlist(activeMovie.id);
    btn.innerText = inList ? "✓ Saved to Watchlist" : "+ Add to Watchlist";
    btn.style.background = inList ? "rgba(255, 42, 95, 0.2)" : "linear-gradient(135deg, var(--primary-neon), var(--primary-violet))";
}

function toggleWatchlistFromHero(id) {
    const movie = currentCatalog.find(m => m.id == id);
    if (!movie) return;
    const added = toggleWatchlist(movie);
    renderHeroSlider();
    updateWatchlistUI();
    showToast(added ? `Added "${movie.title}" to Watchlist` : `Removed "${movie.title}" from Watchlist`);
}

/* ---------------- Watchlist Drawer System ---------------- */
function toggleWatchlistDrawer() {
    const drawer = document.getElementById("drawerBackdrop");
    if (!drawer) return;
    drawer.classList.toggle("active");
    updateWatchlistUI();
}

function closeWatchlistDrawer() {
    const drawer = document.getElementById("drawerBackdrop");
    if (drawer) drawer.classList.remove("active");
}

function updateWatchlistUI() {
    const list = getWatchlist();
    const countBadge = document.getElementById("watchlistCount");
    const container = document.getElementById("watchlistContent");

    if (countBadge) countBadge.innerText = list.length;
    if (!container) return;

    if (list.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 4rem 1rem; color: var(--text-muted);">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 1rem;"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                <h3>Your Watchlist is Empty</h3>
                <p style="font-size: 0.85rem; margin-top: 0.5rem;">Explore movies and click "+ Watchlist" to save them here for later.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = list.map(item => `
        <div class="watchlist-item">
            <img class="watchlist-thumb" src="${item.poster}" alt="${item.title}">
            <div class="watchlist-info">
                <div class="watchlist-title">${item.title}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">${item.year} • ${item.quality || '4K'}</div>
                <button class="remove-btn" style="margin-top: 0.4rem;" onclick="removeWatchlistItem('${item.id}')">Remove</button>
            </div>
            <button class="btn-primary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" onclick="openPlayerModal('${item.id}', '${item.type || 'movie'}')">Play</button>
        </div>
    `).join('');
}

function removeWatchlistItem(id) {
    const list = getWatchlist();
    const item = list.find(m => m.id == id);
    if (item) {
        toggleWatchlist(item);
        updateWatchlistUI();
        showToast(`Removed "${item.title}" from Watchlist`);
    }
}

/* ---------------- In-App Social Profile Modal (@_beat_labs) ---------------- */
function openSocialModal() {
    const modal = document.getElementById("socialModal");
    if (modal) modal.classList.add("active");
}

function closeSocialModal() {
    const modal = document.getElementById("socialModal");
    if (modal) modal.classList.remove("active");
}

function copyInstagramHandle() {
    navigator.clipboard.writeText("@_beat_labs");
    showToast("Instagram handle @_beat_labs copied to clipboard!");
}

/* ---------------- FAQ Accordion ---------------- */
function toggleFaq(element) {
    element.classList.toggle("open");
}

/* ---------------- Notification Toasts ---------------- */
function showToast(message) {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary-neon)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(20px)";
        toast.style.transition = "all 0.3s ease";
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

/* ---------------- Navigation & Scroll Utils ---------------- */
function scrollToSection(id) {
    const target = document.getElementById(id);
    if (target) {
        target.scrollIntoView({ behavior: "smooth" });
    }
}

function initScrollEffects() {
    const navbar = document.getElementById("navbar");
    window.addEventListener("scroll", () => {
        if (window.scrollY > 50) {
            navbar.classList.add("scrolled");
        } else {
            navbar.classList.remove("scrolled");
        }
    });

    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closePlayerModal();
            closeSocialModal();
            closeWatchlistDrawer();
        }
    });
}

/* ================================================================
   NEW FEATURES - Platform Filter, Continue Watching, Search CTA
   ================================================================ */

/* ---------------- Platform Filter System ---------------- */
async function filterPlatform(platformName, btnElement) {
    currentPlatform = platformName;
    
    // Toggle active state on platform pill buttons
    const platformPills = document.querySelectorAll(".platform-pill");
    platformPills.forEach(btn => btn.classList.remove("active"));
    
    // Find the pill element if not passed explicitly
    if (!btnElement) {
        btnElement = Array.from(platformPills).find(btn => btn.innerText.trim().includes(platformName));
    }
    if (btnElement) {
        btnElement.classList.add("active");
    }

    showLoader(true);
    let results = [];

    try {
        if (platformName === "Trending" || platformName === "All") {
            const year = document.getElementById("filterYear").value;
            const lang = document.getElementById("filterLang").value;
            if (year !== "All" || lang !== "All") {
                const url = applyAdvancedFilters(`${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}`, "movie");
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    results = parseTMDBItems(data.results, "movie");
                }
            } else {
                results = currentCatalog;
            }

        } else if (platformName === "Latest Release") {
            const url = applyAdvancedFilters(`${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&sort_by=primary_release_date.desc`, "movie");
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                results = parseTMDBItems(data.results, "movie");
            }

        } else if (platformName === "Netflix") {
            const url = applyAdvancedFilters(`${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&with_watch_providers=8&watch_region=IN`, "movie");
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                results = parseTMDBItems(data.results, "movie");
            }

        } else if (platformName === "Prime Video") {
            const url = applyAdvancedFilters(`${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&with_watch_providers=119&watch_region=IN`, "movie");
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                results = parseTMDBItems(data.results, "movie");
            }

        } else if (platformName === "Hotstar") {
            const url = applyAdvancedFilters(`${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&with_watch_providers=122&watch_region=IN`, "movie");
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                results = parseTMDBItems(data.results, "movie");
            }

        } else if (platformName === "Kids") {
            const url = applyAdvancedFilters(`${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=16`, "movie");
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                results = parseTMDBItems(data.results, "movie");
            }

        } else if (platformName === "Crunchyroll") {
            const url = applyAdvancedFilters(`${TMDB_BASE_URL}/discover/tv?api_key=${TMDB_API_KEY}&with_genres=16`, "tv");
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                results = parseTMDBItems(data.results, "tv");
            }

        } else {
            results = currentCatalog;
        }
    } catch (e) {
        console.warn(`[Platform Filter] Error fetching for "${platformName}":`, e);
        results = currentCatalog;
    }

    showLoader(false);

    // Update the explore header title
    const headerTitle = document.getElementById("exploreHeaderTitle");
    if (headerTitle) {
        if (platformName === "Trending" || platformName === "All") {
            headerTitle.innerText = "Explore Catalog";
        } else {
            headerTitle.innerText = `${platformName} — Popular Titles`;
        }
    }

    renderMovieGrid(results);

    // Scroll to explore section
    scrollToSection("explore");
}

/* ---------------- Continue Watching & Resume Engine ---------------- */
const CONTINUE_WATCHING_KEY = "wavemirror_continue_watching";
const MAX_CONTINUE_WATCHING = 25;

function getContinueWatching() {
    try {
        const stored = localStorage.getItem(CONTINUE_WATCHING_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error("Error reading continue watching:", e);
        return [];
    }
}

function getContinueWatchingItem(id) {
    const list = getContinueWatching();
    return list.find(entry => String(entry.id) === String(id));
}

function saveContinueWatching(item) {
    try {
        let list = getContinueWatching();
        const existing = list.find(entry => String(entry.id) === String(item.id));

        const updatedItem = {
            id: String(item.id),
            tmdbId: item.tmdbId || (existing ? existing.tmdbId : item.id),
            imdbId: item.imdbId || (existing ? existing.imdbId : null),
            title: item.title || (existing ? existing.title : "Media Stream"),
            poster: item.poster || (existing ? existing.poster : ""),
            backdrop: item.backdrop || (existing ? existing.backdrop : item.poster),
            type: item.type || (existing ? existing.type : "movie"),
            year: item.year || (existing ? existing.year : "2024"),
            rating: item.rating || (existing ? existing.rating : "8.0"),
            duration: item.duration || (existing ? existing.duration : "2h"),
            season: item.season !== undefined ? parseInt(item.season) : (existing && existing.season !== undefined ? existing.season : 1),
            episode: item.episode !== undefined ? parseInt(item.episode) : (existing && existing.episode !== undefined ? existing.episode : 1),
            server: item.server !== undefined ? item.server : (existing ? existing.server : 1),
            watchedSeconds: item.watchedSeconds !== undefined ? item.watchedSeconds : (existing ? existing.watchedSeconds : 0),
            durationSeconds: item.durationSeconds || (existing ? existing.durationSeconds : 7200),
            progressPercent: item.progressPercent !== undefined ? item.progressPercent : (existing ? existing.progressPercent : 0),
            lastWatchedAt: Date.now()
        };

        // Calculate progress percentage
        if (updatedItem.durationSeconds > 0 && updatedItem.watchedSeconds > 0) {
            updatedItem.progressPercent = Math.min(100, Math.max(1, Math.round((updatedItem.watchedSeconds / updatedItem.durationSeconds) * 100)));
        }

        // Move to front
        list = list.filter(entry => String(entry.id) !== String(item.id));
        list.unshift(updatedItem);

        if (list.length > MAX_CONTINUE_WATCHING) {
            list = list.slice(0, MAX_CONTINUE_WATCHING);
        }

        localStorage.setItem(CONTINUE_WATCHING_KEY, JSON.stringify(list));
        renderContinueWatching();
        updateNavContinueLink();
    } catch (e) {
        console.error("Error saving continue watching:", e);
    }
}

function removeContinueWatchingItem(id, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    try {
        let list = getContinueWatching();
        list = list.filter(entry => String(entry.id) !== String(id));
        localStorage.setItem(CONTINUE_WATCHING_KEY, JSON.stringify(list));
        renderContinueWatching();
        updateNavContinueLink();
        showToast("Removed from Continue Watching");
    } catch (e) {
        console.error("Error removing continue watching item:", e);
    }
}

function clearAllContinueWatching() {
    if (!confirm("Clear your entire continue watching history?")) return;
    localStorage.removeItem(CONTINUE_WATCHING_KEY);
    renderContinueWatching();
    updateNavContinueLink();
    showToast("Watch history cleared");
}

function updateNavContinueLink() {
    const link = document.getElementById("navContinueLink");
    if (!link) return;
    const list = getContinueWatching();
    link.style.display = (list && list.length > 0) ? "inline-block" : "none";
}

function renderContinueWatching() {
    const container = document.getElementById("continueWatching");
    const grid = document.getElementById("continueWatchingGrid");
    if (!container || !grid) return;

    const list = getContinueWatching();

    if (!list || list.length === 0) {
        container.style.display = "none";
        updateNavContinueLink();
        return;
    }

    container.style.display = "block";
    updateNavContinueLink();

    grid.innerHTML = list.map(item => {
        const timeAgo = getTimeAgo(item.lastWatchedAt || item.timestamp);
        const progressPct = item.progressPercent || (item.watchedSeconds ? Math.min(100, Math.round((item.watchedSeconds / (item.durationSeconds || 7200)) * 100)) : 10);
        const isTv = item.type === "tv";
        const badgeLabel = isTv ? `S${item.season || 1} : E${item.episode || 1}` : `${progressPct}% watched`;
        const thumb = item.backdrop || item.poster;

        return `
            <div class="continue-card" onclick="openPlayerModal('${item.id}', '${item.type || 'movie'}', true)">
                <div class="continue-thumbnail-wrap">
                    <img class="continue-thumbnail" src="${thumb}" alt="${item.title}" loading="lazy" onerror="this.src='${item.poster}'">
                    <div class="continue-overlay">
                        <div class="continue-play-badge">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                            Resume
                        </div>
                    </div>
                    <button class="continue-delete-btn" onclick="removeContinueWatchingItem('${item.id}', event)" title="Remove from Continue Watching">✕</button>
                    <div class="continue-progress-bar">
                        <div class="continue-progress-fill" style="width: ${progressPct}%;"></div>
                    </div>
                </div>
                <div class="continue-card-info">
                    <div class="continue-card-title">${item.title}</div>
                    <div class="continue-card-sub">
                        <span class="continue-tag">${badgeLabel}</span>
                        <span>${timeAgo}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
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

function getTimeAgo(timestamp) {
    if (!timestamp) return "";
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
}

/* ---------------- Advanced Filters URL Builder ---------------- */
function applyAdvancedFilters(url, type = "movie") {
    const year = document.getElementById("filterYear").value;
    const lang = document.getElementById("filterLang").value;
    const sort = document.getElementById("filterSort").value;

    let modifiedUrl = url;

    // Append Year filter
    if (year !== "All") {
        if (type === "movie") {
            modifiedUrl += `&primary_release_year=${year}`;
        } else {
            modifiedUrl += `&first_air_date_year=${year}`;
        }
    }

    // Append Original Language filter
    if (lang !== "All") {
        modifiedUrl += `&with_original_language=${lang}`;
    }

    // Append Sort By
    if (sort) {
        if (modifiedUrl.includes("sort_by=")) {
            modifiedUrl = modifiedUrl.replace(/sort_by=[^&]+/, `sort_by=${sort}`);
        } else {
            modifiedUrl += `&sort_by=${sort}`;
        }
    }

    return modifiedUrl;
}

function triggerCatalogReload() {
    if (activeGenre && activeGenre !== "All") {
        filterGenre(activeGenre);
    } else {
        filterPlatform(currentPlatform);
    }
}

/* ---------------- TV Play Next Episode ---------------- */
function playNextEpisode() {
    const seasonSelect = document.getElementById("seasonSelect");
    const episodeSelect = document.getElementById("episodeSelect");
    if (!seasonSelect || !episodeSelect) return;

    const currentEpIndex = episodeSelect.selectedIndex;
    const maxEpIndex = episodeSelect.options.length - 1;

    if (currentEpIndex < maxEpIndex) {
        episodeSelect.selectedIndex = currentEpIndex + 1;
        updateTvStream();
        showToast(`Playing Season ${seasonSelect.value}, Episode ${episodeSelect.value} ⏭`);
        
        saveContinueWatching({
            id: activeMovie.id,
            title: `${activeMovie.title} - S${seasonSelect.value}E${episodeSelect.value}`,
            poster: activeMovie.poster,
            type: "tv",
            timestamp: Date.now()
        });
        renderContinueWatching();
    } else {
        const currentSeasonIndex = seasonSelect.selectedIndex;
        const maxSeasonIndex = seasonSelect.options.length - 1;
        
        if (currentSeasonIndex < maxSeasonIndex) {
            seasonSelect.selectedIndex = currentSeasonIndex + 1;
            episodeSelect.selectedIndex = 0;
            updateTvStream();
            showToast(`Playing Season ${seasonSelect.value}, Episode ${episodeSelect.value} ⏭`);
            
            saveContinueWatching({
                id: activeMovie.id,
                title: `${activeMovie.title} - S${seasonSelect.value}E${episodeSelect.value}`,
                poster: activeMovie.poster,
                type: "tv",
                timestamp: Date.now()
            });
            renderContinueWatching();
        } else {
            showToast("You have reached the end of the series!");
        }
    }
}

/* ---------------- Trailer Player System ---------------- */
async function playTrailer(mediaId, mediaType) {
    showLoader(true);
    try {
        const type = mediaType || "movie";
        const res = await fetch(`${TMDB_BASE_URL}/${type}/${mediaId}/videos?api_key=${TMDB_API_KEY}&language=en-US`);
        if (!res.ok) throw new Error("Failed to load videos.");
        
        const data = await res.json();
        const videos = data.results || [];
        
        let trailer = videos.find(v => v.site === "YouTube" && v.type === "Trailer");
        if (!trailer) {
            trailer = videos.find(v => v.site === "YouTube");
        }
        
        if (trailer && trailer.key) {
            const iframe = document.getElementById("playerIframe");
            if (iframe) {
                iframe.src = `https://www.youtube.com/embed/${trailer.key}?autoplay=1`;
                showToast("🍿 Playing Official Trailer");
                
                const tvControls = document.getElementById("tvControls");
                if (tvControls) tvControls.classList.add("hidden");
                
                const playerModal = document.getElementById("playerModal");
                if (playerModal && !playerModal.classList.contains("active")) {
                    openPlayerModal(mediaId, type);
                    setTimeout(() => {
                        iframe.src = `https://www.youtube.com/embed/${trailer.key}?autoplay=1`;
                        if (tvControls) tvControls.classList.add("hidden");
                    }, 400);
                }
            }
        } else {
            showToast("❌ No trailer available for this title.");
        }
    } catch (e) {
        console.error("Error fetching trailer:", e);
        showToast("Error loading trailer.");
    }
    showLoader(false);
}

/* ---------------- Watchlist Export/Import Backup ---------------- */
function exportWatchlist() {
    try {
        const list = getWatchlist();
        if (!list || list.length === 0) {
            showToast("Watchlist is empty! Nothing to backup.");
            return;
        }
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(list, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `wavemirror_watchlist_backup_${new Date().toISOString().slice(0,10)}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast("Watchlist exported successfully! 💾");
    } catch (e) {
        console.error("Error exporting watchlist:", e);
        showToast("Export failed.");
    }
}

function triggerImportWatchlist() {
    const fileInput = document.getElementById("watchlistImportFile");
    if (fileInput) fileInput.click();
}

function handleImportWatchlist(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const list = JSON.parse(e.target.result);
            if (!Array.isArray(list)) {
                throw new Error("Invalid format. Expected an array.");
            }
            const valid = list.every(item => item.id && item.title && item.poster);
            if (!valid) {
                throw new Error("Invalid watchlist item structure.");
            }

            let current = getWatchlist();
            const initialCount = current.length;
            list.forEach(item => {
                if (!current.some(c => String(c.id) === String(item.id))) {
                    current.push(item);
                }
            });

            localStorage.setItem(WATCHLIST_KEY, JSON.stringify(current));
            updateWatchlistUI();
            const added = current.length - initialCount;
            showToast(`Watchlist imported! Added ${added} new items.`);
        } catch (err) {
            console.error("Error importing watchlist:", err);
            showToast("Import failed: invalid backup file.");
        }
    };
    reader.readAsText(file);
}

/* ---------------- Reviews & Local Moderation System ---------------- */
const REVIEWS_KEY = "wavemirror_reviews";

function initReviewsDatabase() {
    if (!localStorage.getItem(REVIEWS_KEY)) {
        const mockReviews = [
            {
                id: "mock1",
                mediaId: "634649",
                mediaTitle: "Spider-Man: No Way Home",
                userName: "PeterParkerFan",
                rating: 5,
                reviewText: "Absolutely spectacular! Seeing all three Spideys together was a dream come true. The emotional depth of this movie is underrated. Streamed in flawless 4K here!",
                status: "approved",
                timestamp: Date.now() - 3 * 86400000
            },
            {
                id: "mock2",
                mediaId: "634649",
                mediaTitle: "Spider-Man: No Way Home",
                userName: "MovieCritic99",
                rating: 4,
                reviewText: "Great fan service and pacing. Serves as a perfect conclusion to the trilogy, and the action scenes are top-tier. Highly recommend watching it free on WaveMirror.",
                status: "approved",
                timestamp: Date.now() - 1 * 86400000
            },
            {
                id: "mock3",
                mediaId: "1311031",
                mediaTitle: "Demon Slayer: Kimetsu no Yaiba Infinity Castle",
                userName: "AnimeLover",
                rating: 5,
                reviewText: "Ufotable animation does it again! The fights inside the Infinity Castle are breathtaking. The sound design is amazing.",
                status: "approved",
                timestamp: Date.now() - 5 * 86400000
            }
        ];
        localStorage.setItem(REVIEWS_KEY, JSON.stringify(mockReviews));
    }
}

function getReviews() {
    try {
        initReviewsDatabase();
        const stored = localStorage.getItem(REVIEWS_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error("Error reading reviews:", e);
        return [];
    }
}

function saveReview(review) {
    try {
        const reviews = getReviews();
        reviews.unshift(review);
        localStorage.setItem(REVIEWS_KEY, JSON.stringify(reviews));
    } catch (e) {
        console.error("Error saving review:", e);
    }
}

function submitReview(event) {
    event.preventDefault();
    if (!activeMovie) {
        showToast("Error: No active media loaded.");
        return;
    }
    const nameInput = document.getElementById("reviewName");
    const ratingInput = document.getElementById("reviewRating");
    const textInput = document.getElementById("reviewText");

    if (!nameInput || !ratingInput || !textInput) return;

    const name = nameInput.value.trim();
    const rating = parseInt(ratingInput.value);
    const text = textInput.value.trim();

    if (!name || !text) {
        showToast("Please fill in all fields.");
        return;
    }

    const newReview = {
        id: "rev_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        mediaId: String(activeMovie.id),
        mediaTitle: activeMovie.title,
        userName: name,
        rating: rating,
        reviewText: text,
        status: "pending",
        timestamp: Date.now()
    };

    saveReview(newReview);
    showToast("Review submitted! Pending admin moderation. 🛡️");

    nameInput.value = "";
    textInput.value = "";
    ratingInput.value = "5";

    loadReviewsForMedia(activeMovie.id);
}

function loadReviewsForMedia(mediaId) {
    const container = document.getElementById("reviewsList");
    if (!container) return;

    const reviews = getReviews().filter(r => String(r.mediaId) === String(mediaId) && r.status === "approved");

    if (reviews.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem; font-style: italic;">No approved reviews yet. Be the first to write one!</p>`;
        return;
    }

    container.innerHTML = reviews.map(r => {
        const stars = "⭐".repeat(r.rating) + "☆".repeat(5 - r.rating);
        const timeAgo = getTimeAgo(r.timestamp);
        return `
            <div class="review-card" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-glass); border-radius: var(--radius-sm); padding: 0.8rem 1rem; margin-bottom: 0.8rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
                    <span style="font-weight: 700; color: #fff; font-size: 0.9rem;">${escapeHtml(r.userName)}</span>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">${timeAgo}</span>
                </div>
                <div style="color: #FFD700; font-size: 0.8rem; margin-bottom: 0.4rem;">${stars}</div>
                <p style="color: #cbd5e1; font-size: 0.85rem; line-height: 1.4;">${escapeHtml(r.reviewText)}</p>
            </div>
        `;
    }).join("");
}

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/* ---------------- Admin Panel Reviews Moderation ---------------- */
function openAdminPanel() {
    const modal = document.getElementById("adminPanelModal");
    if (!modal) return;
    modal.classList.add("active");
    document.body.style.overflow = "hidden";
    
    document.getElementById("adminPassInput").value = "";
    document.getElementById("adminLoginSection").style.display = "block";
    document.getElementById("adminDashboardSection").style.display = "none";
}

function closeAdminPanel() {
    const modal = document.getElementById("adminPanelModal");
    if (modal) {
        modal.classList.remove("active");
        document.body.style.overflow = "auto";
    }
}

function checkAdminPassword() {
    const pass = document.getElementById("adminPassInput").value;
    if (pass === "admin00") {
        document.getElementById("adminLoginSection").style.display = "none";
        document.getElementById("adminDashboardSection").style.display = "block";
        loadAdminReviews();
        showToast("Access Granted. Welcome Admin.");
    } else {
        showToast("Invalid password! Access denied.");
    }
}

function loadAdminReviews() {
    const container = document.getElementById("adminReviewsList");
    if (!container) return;

    const reviews = getReviews().filter(r => r.status === "pending");

    if (reviews.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 2rem 0;">No reviews pending moderation. Good job!</p>`;
        return;
    }

    container.innerHTML = reviews.map(r => {
        const stars = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
        return `
            <div class="admin-review-card" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: var(--radius-sm); padding: 1rem; margin-bottom: 0.8rem;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                    <div>
                        <strong style="color: #fff; font-size: 1rem;">${escapeHtml(r.mediaTitle)}</strong>
                        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.1rem;">By ${escapeHtml(r.userName)}</div>
                    </div>
                    <span style="color: #FFD700; font-size: 0.85rem;">${stars}</span>
                </div>
                <p style="color: #cbd5e1; font-size: 0.85rem; line-height: 1.4; margin-bottom: 1rem; background: rgba(0,0,0,0.2); padding: 0.5rem; border-radius: 4px;">${escapeHtml(r.reviewText)}</p>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn-primary" style="padding: 0.4rem 1rem; font-size: 0.8rem;" onclick="moderateReview('${r.id}', 'approve')">Approve</button>
                    <button class="btn-secondary" style="padding: 0.4rem 1rem; font-size: 0.8rem; border-color: var(--accent-red); color: var(--accent-red);" onclick="moderateReview('${r.id}', 'reject')">Reject</button>
                </div>
            </div>
        `;
    }).join("");
}

function moderateReview(reviewId, action) {
    try {
        let reviews = getReviews();
        const review = reviews.find(r => r.id === reviewId);
        if (review) {
            if (action === "approve") {
                review.status = "approved";
                showToast("Review approved and published!");
            } else {
                review.status = "rejected";
                showToast("Review rejected.");
            }
            localStorage.setItem(REVIEWS_KEY, JSON.stringify(reviews));
            loadAdminReviews();
            
            if (activeMovie && String(activeMovie.id) === String(review.mediaId)) {
                loadReviewsForMedia(activeMovie.id);
            }
        }
    } catch (e) {
        console.error("Error moderating review:", e);
    }
}

/* ---------------- Privacy, Terms & Cookie Consent Controllers ---------------- */
function checkCookieConsent() {
    const consent = localStorage.getItem("wavemirror_cookies_accepted");
    const banner = document.getElementById("cookieConsentBanner");
    if (!consent && banner) {
        banner.style.display = "block";
        setTimeout(() => {
            banner.classList.add("active");
        }, 300);
    }
}

function acceptAllCookies() {
    localStorage.setItem("wavemirror_cookies_accepted", "true");
    const banner = document.getElementById("cookieConsentBanner");
    if (banner) {
        banner.classList.remove("active");
        setTimeout(() => {
            banner.style.display = "none";
        }, 400);
    }
    showToast("Cookie preferences updated: Accepted! 🍪");
}

function declineCookies() {
    localStorage.setItem("wavemirror_cookies_accepted", "false");
    const banner = document.getElementById("cookieConsentBanner");
    if (banner) {
        banner.classList.remove("active");
        setTimeout(() => {
            banner.style.display = "none";
        }, 400);
    }
    showToast("Cookies declined (watchlist & settings will not persist).");
}

function openPrivacyModal() {
    const m = document.getElementById("privacyModal");
    if (m) m.classList.add("active");
}
function closePrivacyModal() {
    const m = document.getElementById("privacyModal");
    if (m) m.classList.remove("active");
}
function openTermsModal() {
    const m = document.getElementById("termsModal");
    if (m) m.classList.add("active");
}
function closeTermsModal() {
    const m = document.getElementById("termsModal");
    if (m) m.classList.remove("active");
}

/* ---------------- Global App Settings & Customize Accent ---------------- */
function openAppSettingsModal() {
    const modal = document.getElementById("appSettingsModal");
    if (!modal) return;
    
    // Load current settings from localStorage
    const accent = localStorage.getItem("wavemirror_accent_color") || "#FFD700";
    const server = localStorage.getItem("wavemirror_preferred_server") || "1";
    const autoplay = localStorage.getItem("wavemirror_autoplay_trailers") !== "false";
    const syncMode = localStorage.getItem("wavemirror_sync_mode") || "firebase";
    
    // Select correct values
    document.getElementById("settingPreferredServer").value = server;
    document.getElementById("settingAutoplayCheck").checked = autoplay;
    document.getElementById("settingSyncMode").value = syncMode;
    
    // Select active accent color
    const opts = document.querySelectorAll(".settings-accent-opt");
    opts.forEach(opt => {
        const bg = opt.style.backgroundColor || rgbToHex(opt.style.backgroundColor);
        opt.classList.toggle("active", bg.toLowerCase() === accent.toLowerCase());
    });
    
    modal.classList.add("active");
}

function closeAppSettingsModal() {
    const modal = document.getElementById("appSettingsModal");
    if (modal) modal.classList.remove("active");
}

function setGlobalAccent(colorHex) {
    localStorage.setItem("wavemirror_accent_color", colorHex);
    
    // Set custom CSS variables
    document.documentElement.style.setProperty("--primary-neon", colorHex);
    document.documentElement.style.setProperty("--primary-indigo", colorHex);
    document.documentElement.style.setProperty("--border-glow", `rgba(${hexToRgbValues(colorHex)}, 0.45)`);
    document.documentElement.style.setProperty("--shadow-glow", `0 0 30px rgba(${hexToRgbValues(colorHex)}, 0.35)`);
    
    // Toggle active borders in settings
    const opts = document.querySelectorAll(".settings-accent-opt");
    opts.forEach(opt => {
        const bg = opt.style.backgroundColor || rgbToHex(opt.style.backgroundColor);
        opt.classList.toggle("active", bg.toLowerCase() === colorHex.toLowerCase());
    });
    
    showToast("Global accent color updated!");
}

function hexToRgbValues(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return "99, 102, 241";
    return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
}

function updateDefaultServerPref() {
    const val = document.getElementById("settingPreferredServer").value;
    localStorage.setItem("wavemirror_preferred_server", val);
    showToast("Preferred streaming server updated!");
}

function updateSyncModePref() {
    const val = document.getElementById("settingSyncMode").value;
    localStorage.setItem("wavemirror_sync_mode", val);
    if (window.partyState) {
        window.partyState.syncMode = val;
    }
    showToast("Watch Party sync mode updated!");
}

function updateAutoplayPref(checked) {
    localStorage.setItem("wavemirror_autoplay_trailers", checked ? "true" : "false");
    showToast(checked ? "Autoplay trailers enabled" : "Autoplay trailers disabled");
}

function clearAllUserData() {
    if (confirm("Are you sure you want to clear your local cache, watchlist, and custom settings? This action cannot be undone.")) {
        localStorage.clear();
        showToast("Application cache reset! Reloading page...");
        setTimeout(() => {
            window.location.reload();
        }, 1200);
    }
}

// Global Keyboard Shortcuts (Ctrl+K / Cmd+K Search, Escape to Close Modals)
document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const searchInput = document.getElementById("searchInput");
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
    }
    if (e.key === "Escape") {
        closePlayerModal();
        closeSocialModal();
        closeProfileModal();
        closeAppSettingsModal();
        closeWatchlistDrawer();
        closeJoinPartyModal();
        closeSharePartyModal();
        closeAdminPanel();
    }
});

// Hook cookie consent checks and settings accents on load
document.addEventListener("DOMContentLoaded", () => {
    checkCookieConsent();
    
    // Apply saved accent color on load
    const savedAccent = localStorage.getItem("wavemirror_accent_color");
    if (savedAccent) {
        setGlobalAccent(savedAccent);
    }
    
    updateNavContinueLink();
    initTvNavigation();
});

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
