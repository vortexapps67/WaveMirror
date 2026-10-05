/* ================================================================
   WAVEMIRROR 3D THEATRE - Screen surface
   ---------------------------------------------------------------
   The screen has to show a stream that lives in a THIRD-PARTY
   <iframe>. That cannot be a VideoTexture: a browser will not let
   one document read pixels out of another document, so there is no
   frame to upload as a texture, no matter what CORS headers say.

   The way this is solved: keep the iframe as a real DOM element and
   carry it through a CSS 3D transform, so the browser's own
   compositor draws it inside a quad that sits in perspective on the
   auditorium screen. This file owns:

     - a second Three.js scene containing one plane (the CSS3D quad)
     - a CSS3DRenderer overlay pinned to the viewport
     - the cross-origin <iframe> as a child of that quad
     - a fallback VideoTexture path for sources we DO own
       (a local file, or a direct https video link)

   The WebGL screen mesh is made invisible while an iframe is showing,
   because the CSS quad is the visible surface; it comes back for
   VideoTexture playback and for the idle/poster state.

   Where to change things:
     - SERVER LIST        -> SERVERS below
     - EMBED SANDBOX      -> sandboxFor()
     - VERIFY A URL       -> providerUrlLooksSane()
   ================================================================ */

import * as THREE from "three";
import { CSS3DRenderer, CSS3DObject } from "three/addons/renderers/CSS3DRenderer.js";

/* ---------------------------------------------------------------
   SERVER LIST  <-- edit here
   The same six providers watch.js loadServer() uses, with the same
   URLs, so a title that plays on the watch page plays in the theatre
   and switching servers means the same thing in both places.

   These are iframe embeds, so they go through the CSS3D path. A new
   server is one entry here - no other file needs to change.
   --------------------------------------------------------------- */
export const SERVERS = [
    {
        key: "vidlink",
        name: "Server 1",
        tag: "Primary",
        origin: "https://vidlink.pro",
        movie: (id) => `https://vidlink.pro/movie/${id}`,
        tv: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}`
    },
    {
        key: "vidsrc-xyz",
        name: "Server 2",
        tag: "TMDB ids",
        origin: "https://vidsrc.xyz",
        movie: (id) => `https://vidsrc.xyz/embed/movie/${id}`,
        tv: (id, s, e) => `https://vidsrc.xyz/embed/tv/${id}/${s}-${e}`
    },
    {
        key: "vidsrc-cc",
        name: "Server 3",
        tag: "Movies & series",
        origin: "https://vidsrc.cc",
        movie: (id) => `https://vidsrc.cc/v2/embed/movie/${id}`,
        tv: (id, s, e) => `https://vidsrc.cc/v2/embed/tv/${id}/${s}/${e}`
    },
    {
        key: "embed-su",
        name: "Server 4",
        tag: "Backup",
        origin: "https://embed.su",
        movie: (id) => `https://embed.su/embed/movie/${id}`,
        tv: (id, s, e) => `https://embed.su/embed/tv/${id}/${s}/${e}`
    },
    {
        key: "autoembed",
        name: "Server 5",
        tag: "Backup",
        origin: "https://player.autoembed.cc",
        movie: (id) => `https://player.autoembed.cc/embed/movie/${id}`,
        tv: (id, s, e) => `https://player.autoembed.cc/embed/tv/${id}/${s}/${e}`
    },
    {
        key: "2embed",
        name: "Server 6",
        tag: "Backup",
        origin: "https://www.2embed.cc",
        movie: (id) => `https://www.2embed.cc/embed/${id}`,
        tv: (id, s, e) => `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}`
    }
];

/* Some providers refuse to play inside a sandboxed frame and instead tell
   the viewer to "disable sandbox". We cannot reliably detect which ones, so
   the iframe is left unsandboxed - the part of the page that matters is the
   same-origin room around it. A new server is therefore sandbox-free by
   default; guard it here only if you know it copes with one. */
function sandboxFor(key) {
    return null;
}

/* Cheap sanity check so a malformed id cannot turn into a stray request
   to some other origin. The URL must be https, must be on the origin the
   server entry declares, and must look like a media path. */
function providerUrlLooksSane(url, expectedOrigin) {
    try {
        const u = new URL(url);
        if (u.protocol !== "https:") return false;
        if (expectedOrigin && u.origin !== expectedOrigin) return false;
        if (/\.\./.test(u.pathname)) return false;
        return /\/(movie|tv|embed|embedtv)\//.test(u.pathname);
    } catch (e) {
        return false;
    }
}

/* ================================================================
   ScreenSurface
   ================================================================ */

export class ScreenSurface {
    /**
     * @param {object} opts
     * @param {HTMLCanvasElement} opts.canvas   the WebGL canvas (kept for layout parity)
     * @param {THREE.Object3D} opts.anchor      the WebGL screen mesh to sit against
     * @param {number} opts.worldWidth           screen width in metres
     * @param {number} opts.worldHeight          screen height in metres
     * @param {THREE.Scene} opts.parentScene    scene used for the CSS3D plane
     * @param {THREE.Camera} opts.parentCamera  camera shared with the WebGL renderer
     */
    constructor(opts) {
        this.anchor = opts.anchor;
        this.worldWidth = opts.worldWidth;
        this.worldHeight = opts.worldHeight;
        this.parentScene = opts.parentScene;
        this.parentCamera = opts.parentCamera;
        this.host = opts.host || document.body;
        this.onStatus = opts.onStatus || null;

        this.mode = "empty";           // empty | iframe | texture
        this.status = "idle";          // idle | opening | opened | slow | error
        this.iframe = null;
        this.media = null;
        this._timeout = null;

        this._build();
    }

    _build() {
        /* A fixed, transparent overlay that sits on top of the WebGL canvas.
           CSS3DRenderer writes world transforms into its children; the
           overlay itself must never intercept pointer events. */
        this.cssScene = new THREE.Scene();

        this.cssRenderer = new CSS3DRenderer();
        this.cssRenderer.domElement.className = "wm-screen-layer";
        this.cssRenderer.domElement.style.cssText =
            "position:fixed;inset:0;z-index:1;pointer-events:none;overflow:hidden;";
        /* Keep the WebGL canvas painted on top of the film's own UI chrome
           (play buttons) while the film's pixels sit behind them. */
        this.host.prepend(this.cssRenderer.domElement);

        /* A fixed pixel-space quad, scaled down to the screen's world width
           so a 16:9 box maps exactly onto the WebGL screen mesh. PX is big
           enough that a scaled-down quad is still sharp on a 4K display. */
        const PX = 1600;
        const el = document.createElement("div");
        el.className = "wm-screen-quad";
        el.style.cssText =
            `width:${PX}px;height:${Math.round(PX * (this.worldHeight / this.worldWidth))}px;` +
            "position:absolute;left:0;top:0;overflow:hidden;background:#000;" +
            "border-radius:3px;will-change:transform;";

        this.quad = new CSS3DObject(el);
        this.quadEl = el;

        /* Match the anchor's placement, then flatten the plane so the quad
           faces the same way as the screen mesh. */
        this.quad.position.copy(this.anchor.position);
        this.quad.quaternion.copy(this.anchor.quaternion);
        this.quad.scale.setScalar(this.worldWidth / PX);
        this.cssScene.add(this.quad);

        /* While an iframe owns the screen, the WebGL mesh steps aside. */
        this.anchor.visible = true;
    }

    /* ---------------- sizing ---------------- */

    resize(width, height) {
        this.cssRenderer.setSize(width, height);
    }

    /* ---------------- iframe mode ---------------- */

    /**
     * Put a provider iframe on the screen.
     * @param {object} media { id, type, season, episode, server, title, url }
     */
    showEmbed(media) {
        if (!media || !media.url) {
            this.showPoster();
            return false;
        }
        const server = SERVERS.find((s) => s.key === media.server) || SERVERS[0];
        if (!providerUrlLooksSane(media.url, server.origin)) {
            this._setStatus("error");
            this.showPoster();
            return false;
        }

        this._clearTimeout();
        this.clearEmbed();

        const iframe = document.createElement("iframe");
        iframe.className = "wm-screen-iframe";
        /* An iframe defaults to 300x150 and does not inherit the quad's
           size, so it has to be told. Without this the provider renders
           in a letterboxed 60x30 box in the corner of the screen. */
        iframe.style.cssText = "display:block;width:100%;height:100%;border:0;background:#000;";
        iframe.title = `${media.title || "Video"} - ${server.name}`;
        iframe.allow = "autoplay; fullscreen; encrypted-media; picture-in-picture";
        iframe.allowFullscreen = true;
        iframe.referrerPolicy = "strict-origin-when-cross-origin";
        iframe.loading = "eager";
        /* Intentionally no sandbox. Providers key off its presence and
           degrade or refuse to play instead of just stripping features,
           which is exactly the "disable sandbox" failure you would see. */
        const sb = sandboxFor(server.key);
        if (sb) iframe.setAttribute("sandbox", sb);

        iframe.addEventListener("load", () => {
            if (iframe !== this.iframe) return;
            this._clearTimeout();
            this._setStatus("opened");
        });
        iframe.addEventListener("error", () => {
            if (iframe !== this.iframe) return;
            this._setStatus("error");
        });

        this.media = media;
        this.iframe = iframe;
        /* Mode must be set before the mask is applied: it decides whether the
           CSS3D layer paints and whether the WebGL screen steps aside. */
        this.mode = "iframe";
        this.quadEl.appendChild(iframe);
        this._setStatus("opening");

        /* Providers can be slow to respond; tell the guest rather than
           leaving them staring at a black screen. */
        this._timeout = setTimeout(() => {
            if (this.status === "opening") this._setStatus("slow");
        }, 15000);

        iframe.src = media.url;
        this._applyMask();
        return true;
    }

    /* A provider that reports its own failure through postMessage. */
    listenForProviderErrors() {
        this._onMessage = (e) => {
            if (!this.iframe || !this.media) return;
            if (e.source !== this.iframe.contentWindow) return;
            let data = e.data;
            if (typeof data === "string") {
                if (data.length > 10000) return;
                try { data = JSON.parse(data); } catch { return; }
            }
            if (!data || typeof data !== "object") return;
            const isError =
                ("event" in data && data.event === "error") ||
                ("type" in data && (data.type === "error" || data.type === "ERROR"));
            if (isError) this._setStatus("error");
        };
        window.addEventListener("message", this._onMessage);
    }

    clearEmbed() {
        if (this.iframe) {
            this.iframe.remove();
            this.iframe = null;
        }
        this.media = null;
        this._clearTimeout();
        this._applyMask();
    }

    reload() {
        if (!this.iframe) return;
        const src = this.iframe.src;
        this._setStatus("opening");
        this.iframe.src = src;
    }

    /* Swap to another server for the same title. */
    useServer(serverKey, media) {
        const server = SERVERS.find((s) => s.key === serverKey);
        if (!server || !media) return false;
        const url = embedUrlFor(
            { id: media.id, type: media.type },
            media.season || 1,
            media.episode || 1,
            serverKey
        );
        return this.showEmbed(Object.assign({}, media, { server: serverKey, url }));
    }

    /* ---------------- WebGL mesh visibility ---------------- */

    /* When the CSS quad is the visible surface, the WebGL mesh must not
       also draw, or you get two coplanar surfaces fighting for the depth
       buffer. */
    _applyMask() {
        const cssOwnsScreen = this.mode === "iframe";
        this.anchor.visible = !cssOwnsScreen;
        this.cssRenderer.domElement.style.display = cssOwnsScreen ? "block" : "none";
    }

    /* ---------------- render ---------------- */

    render() {
        if (this.mode === "iframe") {
            this.cssRenderer.render(this.cssScene, this.parentCamera);
        }
    }

    /* ---------------- state ---------------- */

    setMode(mode) {
        this.mode = mode;
        this._applyMask();
    }

    showPoster() {
        this.clearEmbed();
        this.setMode("texture");
    }

    _setStatus(status) {
        this.status = status;
        if (typeof this.onStatus === "function") this.onStatus(status);
    }

    _clearTimeout() {
        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = null;
        }
    }

    dispose() {
        this._clearTimeout();
        if (this._onMessage) window.removeEventListener("message", this._onMessage);
        this.clearEmbed();
        this.cssRenderer.domElement.remove();
    }
}

/* ================================================================
   CATALOGUE  <-- edit here
   TMDB search, so the theatre browses the same collection the rest of
   the site does. Keys come from env.js via window.ENV, never inlined
   here.
   ================================================================ */

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG_POSTER = "https://image.tmdb.org/t/p/w342";

function tmdbKey() {
    if (typeof window !== "undefined" && window.ENV && window.ENV.TMDB_API_KEY) {
        return window.ENV.TMDB_API_KEY;
    }
    return "";
}

/* Search endpoint varies by type; everything downstream wants the same
   shape, so normalise here once. */
async function tmdbFetch(path, params) {
    const key = tmdbKey();
    if (!key) return null;
    const qs = new URLSearchParams(Object.assign({ api_key: key }, params || {}));
    try {
        const res = await fetch(`${TMDB_BASE}${path}?${qs}`);
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        console.warn("[Theatre] TMDB request failed:", e);
        return null;
    }
}

function toItem(r, type) {
    return {
        id: String(r.id),
        type: r.media_type || type,
        title: r.title || r.name || "Untitled",
        year: (r.release_date || r.first_air_date || "").substring(0, 4),
        rating: r.vote_average ? r.vote_average.toFixed(1) : "",
        poster: r.poster_path ? `${TMDB_IMG_POSTER}${r.poster_path}` : ""
    };
}

export async function searchTmdb(query, type = "multi") {
    if (!query || !tmdbKey()) return [];
    /* multi returns people too; keep only what we can actually play. */
    const data = await tmdbFetch(
        type === "multi" ? "/search/multi" : `/search/${type}`,
        { query, include_adult: "false" }
    );
    if (!data) return [];
    return (data.results || [])
        .filter((r) => r.media_type === "movie" || r.media_type === "tv")
        .slice(0, 18)
        .map((r) => toItem(r, type));
}

export async function trendingTmdb(type = "movie") {
    const data = await tmdbFetch(`/trending/${type}/week`, {});
    if (!data) return [];
    return (data.results || [])
        .filter((r) => r.media_type === "movie" || r.media_type === "tv")
        .slice(0, 18)
        .map((r) => toItem(r, type));
}

export async function tmdbSeasons(seriesId) {
    const data = await tmdbFetch(`/tv/${encodeURIComponent(seriesId)}`, {});
    return (data && data.seasons) || [];
}

/* Title and still art for the theatre chrome and the party panel. */
export async function tmdbMeta(type, id) {
    const data = await tmdbFetch(`/${type}/${encodeURIComponent(id)}`, {});
    if (!data) return null;
    return {
        title: data.title || data.name || "Untitled",
        year: (data.release_date || data.first_air_date || "").substring(0, 4),
        overview: data.overview || "",
        runtime: data.runtime || (data.episode_run_time && data.episode_run_time[0]) || 0,
        genres: (data.genres || []).map(g => g.name),
        rating: data.vote_average ? data.vote_average.toFixed(1) : "",
        poster: data.poster_path ? `https://image.tmdb.org/t/p/w342${data.poster_path}` : "",
        backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/w780${data.backdrop_path}` : ""
    };
}

/* Build the embed URL for a catalogue pick on a given server. */
export function embedUrlFor(item, season = 1, episode = 1, serverKey = SERVERS[0].key) {
    const server = SERVERS.find(s => s.key === serverKey) || SERVERS[0];
    if (!server || !item) return "";
    return item.type === "tv"
        ? server.tv(item.id, season, episode)
        : server.movie(item.id);
}