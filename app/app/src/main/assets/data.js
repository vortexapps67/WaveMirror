// WaveMirror Data Engine (Powered strictly by TMDB API)

const TMDB_API_KEY = "fea469f5e20796590292a227a92a2fef"; // User TMDB API Key
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMG_POSTER = "https://image.tmdb.org/t/p/w500";
const TMDB_IMG_BACKDROP = "https://image.tmdb.org/t/p/original";

const GENRE_MAP = {
    "Action": 28,
    "Adventure": 12,
    "Animation": 16,
    "Comedy": 35,
    "Crime": 80,
    "Drama": 18,
    "Fantasy": 14,
    "Horror": 27,
    "Sci-Fi": 878,
    "Biography": 36,
    "Romance": 10749,
    "Thriller": 53
};

// High definition fallback database
const FEATURED_MOVIES = [
    {
        id: "693134",
        tmdbId: 693134,
        imdbId: "tt15239678",
        title: "Dune: Part Two",
        type: "movie",
        poster: "https://image.tmdb.org/t/p/w500/1pdfLPoLMag8StABMwMFiChgZii.jpg",
        backdrop: "https://image.tmdb.org/t/p/original/xOMo8BRK7PfcJv9JCnx7s52SuTx.jpg",
        year: "2024",
        rating: "8.5",
        duration: "2h 46m",
        quality: "4K Ultra HD",
        genres: ["Action", "Adventure", "Sci-Fi"],
        overview: "Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.",
        director: "Denis Villeneuve",
        cast: ["Timothée Chalamet", "Zendaya", "Rebecca Ferguson"],
        top10: 1,
        trending: true
    },
    {
        id: "872585",
        tmdbId: 872585,
        imdbId: "tt15398776",
        title: "Oppenheimer",
        type: "movie",
        poster: "https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGvjW71vYTo.jpg",
        backdrop: "https://image.tmdb.org/t/p/original/fm6K8OiXeEXHYD7yODk9kHfMTeJ.jpg",
        year: "2023",
        rating: "8.9",
        duration: "3h 00m",
        quality: "IMAX 4K",
        genres: ["Biography", "Drama", "History"],
        overview: "The story of American scientist J. Robert Oppenheimer and his role in the development of the atomic bomb during World War II.",
        director: "Christopher Nolan",
        cast: ["Cillian Murphy", "Emily Blunt", "Robert Downey Jr."],
        top10: 2,
        trending: true
    },
    {
        id: "572802",
        tmdbId: 572802,
        imdbId: "tt9663782",
        title: "Aquaman and the Lost Kingdom",
        type: "movie",
        poster: "https://image.tmdb.org/t/p/w500/7lTnUdOHDiAtmFFWOtxtl92SrM6.jpg",
        backdrop: "https://image.tmdb.org/t/p/original/cnGoWzY5vWiuwM0Y344jh5FwjhG.jpg",
        year: "2023",
        rating: "6.9",
        duration: "2h 04m",
        quality: "4K HDR",
        genres: ["Action", "Adventure", "Fantasy"],
        overview: "Black Manta seeks revenge on Aquaman for his father's death. Using the power of the mythic Black Trident, he becomes a formidable foe.",
        director: "James Wan",
        cast: ["Jason Momoa", "Patrick Wilson", "Amber Heard"],
        top10: 3,
        trending: true
    },
    {
        id: "569094",
        tmdbId: 569094,
        imdbId: "tt9362722",
        title: "Spider-Man: Across the Spider-Verse",
        type: "movie",
        poster: "https://image.tmdb.org/t/p/w500/8Vt6mWEReuy4Of61Lnj5Xj7sFm8.jpg",
        backdrop: "https://image.tmdb.org/t/p/original/4XM8DUTQb3lhPpFGMD1p1L.jpg",
        year: "2023",
        rating: "8.7",
        duration: "2h 20m",
        quality: "4K HDR",
        genres: ["Animation", "Action", "Adventure"],
        overview: "Miles Morales catapults across the Multiverse, where he encounters a team of Spider-People charged with protecting its very existence.",
        director: "Joaquim Dos Santos",
        cast: ["Shameik Moore", "Hailee Steinfeld", "Oscar Isaac"],
        top10: 4,
        trending: true
    },
    {
        id: "157336",
        tmdbId: 157336,
        imdbId: "tt0816692",
        title: "Interstellar",
        type: "movie",
        poster: "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
        backdrop: "https://image.tmdb.org/t/p/original/pBRD98cSuWk2s3n.jpg",
        year: "2014",
        rating: "8.7",
        duration: "2h 49m",
        quality: "IMAX 4K",
        genres: ["Sci-Fi", "Drama", "Adventure"],
        overview: "The adventures of a group of explorers who make use of a newly discovered wormhole to surpass the limitations on human space travel.",
        director: "Christopher Nolan",
        cast: ["Matthew McConaughey", "Anne Hathaway", "Jessica Chastain"],
        top10: 5,
        trending: true
    }
];

// Active TMDB API Fetch Functions
async function fetchLiveTrendingMovies() {
    try {
        const res = await fetch(`${TMDB_BASE_URL}/trending/movie/week?api_key=${TMDB_API_KEY}`);
        if (!res.ok) throw new Error("TMDB response not ok");
        const data = await res.json();
        return parseTMDBItems(data.results, "movie");
    } catch (e) {
        console.warn("Live API fetch fallback triggered:", e);
        return FEATURED_MOVIES;
    }
}

async function fetchLiveTrendingSeries() {
    try {
        const res = await fetch(`${TMDB_BASE_URL}/trending/tv/week?api_key=${TMDB_API_KEY}`);
        if (!res.ok) throw new Error("TMDB TV response not ok");
        const data = await res.json();
        return parseTMDBItems(data.results, "tv");
    } catch (e) {
        console.warn("Live TV fetch fallback triggered:", e);
        return [];
    }
}

async function fetchLiveGenreMovies(genreName) {
    try {
        const genreId = GENRE_MAP[genreName];
        if (!genreId) return [];
        const res = await fetch(`${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=${genreId}&sort_by=popularity.desc`);
        if (!res.ok) throw new Error("TMDB genre response not ok");
        const data = await res.json();
        return parseTMDBItems(data.results, "movie");
    } catch (e) {
        console.warn("Live genre fetch fallback triggered:", e);
        return [];
    }
}

async function fetchLiveSearch(query) {
    try {
        const res = await fetch(`${TMDB_BASE_URL}/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error("TMDB search response not ok");
        const data = await res.json();
        return parseTMDBItems(data.results.filter(i => i.media_type === 'movie' || i.media_type === 'tv'), "movie");
    } catch (e) {
        console.warn("Live search fallback triggered:", e);
        return [];
    }
}

// Fetch Full Details + IMDB External ID from TMDB API
async function fetchStreamDetails(id, mediaType = "movie") {
    try {
        if (mediaType === "tv") {
            const res = await fetch(`${TMDB_BASE_URL}/tv/${id}?api_key=${TMDB_API_KEY}&append_to_response=credits`);
            if (!res.ok) throw new Error("TMDB TV detail error");
            const data = await res.json();
            return {
                id: String(data.id),
                tmdbId: data.id,
                title: data.name || data.title,
                type: "tv",
                poster: data.poster_path ? `${TMDB_IMG_POSTER}${data.poster_path}` : "https://image.tmdb.org/t/p/w500/49WJfeN0moxb9IPfGn88qMG4dF1.jpg",
                backdrop: data.backdrop_path ? `${TMDB_IMG_BACKDROP}${data.backdrop_path}` : "https://image.tmdb.org/t/p/original/56v2KjBlU4XaOv9r1kR78.jpg",
                year: (data.first_air_date || "2024").substring(0, 4),
                rating: Math.round((data.vote_average || 8.5) * 10) / 10,
                duration: `${data.number_of_seasons || 1} Seasons`,
                seasonsCount: data.number_of_seasons || 1,
                overview: data.overview || "Stream this TV show exclusively on WaveMirror.",
                director: "WaveMirror TV",
                cast: data.credits && data.credits.cast ? data.credits.cast.slice(0, 4).map(c => c.name) : ["Lead Actor"],
                genres: data.genres ? data.genres.map(g => g.name) : ["Drama"]
            };
        } else {
            const [detRes, extRes] = await Promise.all([
                fetch(`${TMDB_BASE_URL}/movie/${id}?api_key=${TMDB_API_KEY}&append_to_response=credits`),
                fetch(`${TMDB_BASE_URL}/movie/${id}/external_ids?api_key=${TMDB_API_KEY}`)
            ]);

            const data = detRes.ok ? await detRes.json() : {};
            const extData = extRes.ok ? await extRes.json() : {};
            const imdbId = extData.imdb_id || (FEATURED_MOVIES.find(m => m.id == id) || {}).imdbId || "tt15239678";

            return {
                id: String(data.id || id),
                tmdbId: data.id || id,
                imdbId,
                title: data.title || "Movie Stream",
                type: "movie",
                poster: data.poster_path ? `${TMDB_IMG_POSTER}${data.poster_path}` : "https://image.tmdb.org/t/p/w500/1pdfLPoLMag8StABMwMFiChgZii.jpg",
                backdrop: data.backdrop_path ? `${TMDB_IMG_BACKDROP}${data.backdrop_path}` : "https://image.tmdb.org/t/p/original/xOMo8BRK7PfcJv9JCnx7s52SuTx.jpg",
                year: (data.release_date || "2024").substring(0, 4),
                rating: Math.round((data.vote_average || 8.5) * 10) / 10,
                duration: data.runtime ? `${Math.floor(data.runtime/60)}h ${data.runtime%60}m` : "2h 15m",
                overview: data.overview || "Stream this blockbuster movie exclusively on WaveMirror.",
                director: data.credits && data.credits.crew ? (data.credits.crew.find(c => c.job === "Director") || { name: "Featured Director" }).name : "Featured Director",
                cast: data.credits && data.credits.cast ? data.credits.cast.slice(0, 4).map(c => c.name) : ["Lead Actor"],
                genres: data.genres ? data.genres.map(g => g.name) : ["Action"]
            };
        }
    } catch (e) {
        console.warn("Error fetching stream details:", e);
        return null;
    }
}

function parseTMDBItems(results, defaultType = "movie") {
    if (!results) return [];
    return results.map((item, idx) => {
        const mediaType = item.media_type || defaultType;
        const genres = getGenreNames(item.genre_ids);
        return {
            id: String(item.id),
            tmdbId: item.id,
            title: item.title || item.name,
            type: mediaType,
            poster: item.poster_path ? `${TMDB_IMG_POSTER}${item.poster_path}` : "https://image.tmdb.org/t/p/w500/1pdfLPoLMag8StABMwMFiChgZii.jpg",
            backdrop: item.backdrop_path ? `${TMDB_IMG_BACKDROP}${item.backdrop_path}` : "https://image.tmdb.org/t/p/original/xOMo8BRK7PfcJv9JCnx7s52SuTx.jpg",
            year: (item.release_date || item.first_air_date || "2024").substring(0, 4),
            rating: Math.round((item.vote_average || 8.0) * 10) / 10,
            duration: mediaType === 'tv' ? 'TV Series' : '2h 15m',
            quality: "4K HDR",
            genres,
            overview: item.overview || "Stream this title exclusively on WaveMirror.",
            top10: idx < 10 ? idx + 1 : null,
            trending: true
        };
    });
}

function getGenreNames(ids) {
    const map = {
        28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy",
        80: "Crime", 18: "Drama", 14: "Fantasy", 27: "Horror", 878: "Sci-Fi", 36: "Biography", 10749: "Romance", 53: "Thriller"
    };
    if (!ids) return ["Action", "Sci-Fi"];
    const names = ids.map(id => map[id]).filter(Boolean);
    return names.length > 0 ? names : ["Action", "Drama"];
}

// LocalStorage Watchlist Helper
const WATCHLIST_KEY = "wavemirror_watchlist_v2";

function getWatchlist() {
    try {
        const stored = localStorage.getItem(WATCHLIST_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error("Error reading watchlist", e);
        return [];
    }
}

function saveWatchlist(list) {
    try {
        localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
    } catch (e) {
        console.error("Error saving watchlist", e);
    }
}

function isInWatchlist(id) {
    const list = getWatchlist();
    return list.some(item => item.id == id || item.tmdbId == id);
}

function toggleWatchlist(movie) {
    let list = getWatchlist();
    const index = list.findIndex(item => item.id == movie.id || (movie.tmdbId && item.tmdbId == movie.tmdbId));
    
    let added = false;
    if (index >= 0) {
        list.splice(index, 1);
    } else {
        list.unshift(movie);
        added = true;
    }
    saveWatchlist(list);
    return added;
}
