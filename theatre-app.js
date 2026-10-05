/* ================================================================
   WAVEMIRROR 3D THEATRE - Route controller
   ---------------------------------------------------------------
   Owns everything that is neither the 3D scene nor the realtime layer:
   query params, media metadata, the transport overlay, the film picker,
   the seat picker, the party panel, keyboard shortcuts, and wiring it
   all together.

   Loaded as a module so it can import the scene. Runs after DOM ready.
   ================================================================ */

import { TheatreScene, resolveVideoSource, pickQualityTier, SEATS, SEAT_NOTES, SEAT_LAYOUT } from "./theatre-scene.js";
import { SERVERS, embedUrlFor, searchTmdb, trendingTmdb, tmdbMeta } from "./theatre-screen.js";

const $ = (id) => document.getElementById(id);

const ui = {
    canvas: $("theatre-canvas"),
    gate: $("thGate"),
    gateTitle: $("thGateTitle"),
    spinner: $("thSpinner"),
    enter: $("thEnter"),
    back: $("thBack"),
    title: $("thTitle"),
    subtitle: $("thSubtitle"),
    presence: $("thPresence"),
    presenceText: $("thPresenceText"),
    resetView: $("thResetView"),
    fps: $("thFps"),
    fpsValue: $("thFpsValue"),
    partyToggle: $("thPartyToggle"),
    bottom: $("thBottom"),
    seekRow: $("thSeekRow"),
    seek: $("thSeek"),
    timeNow: $("thTimeNow"),
    timeEnd: $("thTimeEnd"),
    play: $("thPlay"),
    playIcon: $("thPlayIcon"),
    playLabel: $("thPlayLabel"),
    mute: $("thMute"),
    muteIcon: $("thMuteIcon"),
    volume: $("thVolume"),
    seatBtn: $("thSeatBtn"),
    lightsBtn: $("thLightsBtn"),
    perfBtn: $("thPerfBtn"),
    zoomBtn: $("thZoomBtn"),
    sourceBtn: $("thSourceBtn"),
    exit: $("thExit"),
    hint: $("thHint"),

    providerStrip: $("thProviderStrip"),
    providerText: $("thProviderText"),
    reloadBtn: $("thReloadBtn"),

    sourcePanel: $("thSourcePanel"),
    filmHeading: $("thFilmHeading"),
    search: $("thSearch"),
    searchBtn: $("thSearchBtn"),
    results: $("thResults"),
    serverWrap: $("thServerWrap"),
    servers: $("thServers"),
    srcUrl: $("thSrcUrl"),
    srcApply: $("thSrcApply"),
    srcFile: $("thSrcFile"),
    srcFileLabel: $("thFileLabel"),
    srcClose: $("thSrcClose"),

    seatPanel: $("thSeatPanel"),
    seatPlan: $("thSeatPlan"),
    seatDetail: $("thSeatDetail"),
    seatCode: $("thSeatCode"),
    seatBlurb: $("thSeatBlurb"),
    sitBtn: $("thSitBtn"),
    seatClose: $("thSeatClose"),

    party: $("thParty"),
    roomWrap: $("thRoomWrap"),
    roomCode: $("thRoomCode"),
    copyRoom: $("thCopyRoom"),
    tabs: Array.from(document.querySelectorAll(".th-tab")),
    partyStart: $("thPartyStart"),
    partyJoin: $("thPartyJoin"),
    hostBtn: $("thHostBtn"),
    leaveBtn: $("thLeaveBtn"),
    joinCode: $("thJoinCode"),
    joinBtn: $("thJoinBtn"),
    chatPane: $("thChatPane"),
    peoplePane: $("thPeoplePane"),
    chatLog: $("thChatLog"),
    chatForm: $("thChatForm"),
    chatInput: $("thChatInput"),
    members: $("thMembers")
};

const state = {
    scene: null,
    party: null,
    media: { id: null, type: "movie", title: "3D Theatre", poster: "", year: "" },
    /* What is actually on the screen right now. `server` matters because
       a party guest loading the same title on a different provider would
       be watching a different thing, so it is broadcast too. */
    play: null,
    source: null,
    applyingRemote: false,
    scrubFocused: false,
    selectedSeat: SEATS.find(s => s.id === "B3") || SEATS[0],
    hasVideo: false,
    lastSnapshot: null,
    returnUrl: null,
    idleTimer: null,
    hintTimer: null,
    moveTimer: null,
    hostTicker: null,
    userMoved: false,
    privateNoticeShown: false,
    entered: false,
    houseLights: false,
    searchTimer: null,
    searchToken: 0,
    fps: 0
};

/* ---------------------------------------------------------------
   Query params
   --------------------------------------------------------------- */

const params = new URLSearchParams(window.location.search);
const roomFromUrl = params.get("room");
const resolved = resolveVideoSource(params);

/* ---------------------------------------------------------------
   Boot
   --------------------------------------------------------------- */

async function boot() {
    await loadMedia();

    applyMediaToUi();
    buildSeatPlan();
    buildServerList();

    const tier = pickQualityTier();
    try {
        state.scene = new TheatreScene(ui.canvas, {
            tier,
            src: "",
            onVideoEvent: onVideoEvent
        });
    } catch (e) {
        console.error("[Theatre] scene failed to build", e);
        failGate("This device could not start WebGL, so the theatre cannot open.");
        return;
    }

    if (state.media.poster) state.scene.setPoster(state.media.poster);
    state.scene._idleGlow();

    /* Put whatever the URL asked for on the screen. */
    if (resolved && resolved.kind === "embed" && resolved.media) {
        applyEmbed(resolved.media, resolved.server, { silent: true });
    } else if (resolved && resolved.kind === "file") {
        applySource(resolved.src, "Saved link", { silent: true });
    }

    setupTransport();
    setupFilmPicker();
    setupSeatPicker();
    setupParty();
    setupKeyboard();
    setupIdleChrome();
    setupStick();
    setupFpsMeter();

    /* You arrive at the rear entrance. The seat panel picks a seat later. */
    state.scene.resetView();
    selectSeat(state.selectedSeat);

    /* Compile before revealing, so entering is not a stutter. */
    state.scene.renderer.compile(state.scene.scene, state.scene.camera);
    /* Introspection handle for the browser console. */
    window.theatre = state;
    readyGate();
}

/* ---------------------------------------------------------------
   Media metadata
   --------------------------------------------------------------- */

async function loadMedia() {
    const id = params.get("id");
    const type = params.get("type") === "tv" ? "tv" : "movie";
    if (!id || !/^\d+$/.test(id)) return;
    const meta = await tmdbMeta(type, id);
    if (!meta) return;
    state.media.id = id;
    state.media.type = type;
    state.media.title = meta.title;
    state.media.year = meta.year;
    state.media.overview = meta.overview;
    state.media.genres = meta.genres;
    state.media.rating = meta.rating;
    state.media.poster = meta.backdrop || meta.poster;
    state.media.tmdbPoster = meta.poster;
    if (typeof window.setTheatreMedia === "function") window.setTheatreMedia(state.media);
}

function applyMediaToUi() {
    ui.title.textContent = state.media.title;
    const bits = [];
    if (state.media.year) bits.push(state.media.year);
    bits.push("3D Theatre");
    ui.subtitle.textContent = bits.join(" \u00b7 ");
    document.title = `${state.media.title} | WaveMirror 3D Theatre`;
    ui.gateTitle.textContent = state.media.title === "3D Theatre" ? "Take your seat" : state.media.title;
}

function failGate(msg) {
    ui.spinner.hidden = true;
    ui.enter.textContent = "Cannot open theatre";
    ui.enter.disabled = true;
    const note = document.querySelector(".th-gate-note");
    if (note) note.textContent = msg;
}

function readyGate() {
    ui.spinner.hidden = true;
    ui.enter.disabled = false;
    ui.enter.textContent = "Enter the theatre";
    ui.enter.focus({ preventScroll: true });
}

/* ---------------------------------------------------------------
   Putting something on the screen
   ---------------------------------------------------------------
   Two paths, and the difference is technical rather than stylistic:

     applyEmbed  - a TMDB title through a provider iframe, carried on
                   the CSS3D quad. Works for any catalogue title.
     applySource - a direct media URL or a local file, decoded locally
                   and drawn on the WebGL screen as a texture.
   ---------------------------------------------------------------- */

/* Show a catalogue title on a chosen provider. */
function applyEmbed(media, serverKey, opts = {}) {
    if (!media || !media.id) return false;
    const server = SERVERS.find(s => s.key === serverKey) || SERVERS[0];
    const url = embedUrlFor({ id: media.id, type: media.type }, media.season || 1, media.episode || 1, server.key);
    const ok = state.scene.setEmbed(Object.assign({}, media, { server: server.key, url }));
    if (!ok) {
        flashHint("That server would not load", 3200);
        return false;
    }
    state.play = {
        kind: "embed",
        id: media.id,
        type: media.type,
        season: media.season || 1,
        episode: media.episode || 1,
        server: server.key,
        title: media.title || state.media.title,
        poster: state.media.poster || ""
    };
    state.source = null;
    paintServerList();
    /* Surface the provider strip at once rather than waiting for the
       load event to tell the truth. */
    ui.providerStrip.hidden = false;
    ui.providerStrip.dataset.status = "opening";
    ui.providerText.textContent = PROVIDER_COPY.opening;
    if (!opts.silent) {
        closePanels();
        flashHint(`${state.play.title} \u00b7 ${server.name}`);
    }
    return true;
}

/* Show media we hold directly. */
function applySource(url, label, opts = {}) {
    if (!url) return false;
    try {
        if (/^https?:/i.test(url)) localStorage.setItem("wavemirror_theatre_src", url);
    } catch (e) { /* private mode */ }
    state.scene.setSource(url);
    state.scene.posterMaterial.opacity = 0;
    state.play = null;
    state.source = {
        kind: "file",
        /* A blob: URL is document-scoped, so it is never broadcast. */
        shareable: /^https?:/i.test(url),
        url: /^https?:/i.test(url) ? url : ""
    };
    ui.providerStrip.hidden = true;
    ui.seekRow.hidden = false;
    ui.play.hidden = false;
    ui.mute.hidden = false;
    ui.volume.hidden = false;
    if (label && !opts.silent) {
        ui.subtitle.textContent = `${label} \u00b7 3D Theatre`;
    }
    if (!opts.silent) {
        closePanels();
        flashHint("Loading\u2026");
    }
    return true;
}

/* ================================================================
   TRANSPORT
   ================================================================ */

function fmtTime(secs) {
    if (!isFinite(secs) || secs < 0) return "00:00";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function paintRange(el, pct) {
    el.style.setProperty("--pct", Math.max(0, Math.min(100, pct)) + "%");
}

/* Provider status -> something a person can act on. */
const PROVIDER_COPY = {
    idle: "Screen idle",
    opening: "Opening the player\u2026",
    opened: "Playing from the provider",
    slow: "This server is slow to respond. Try another one.",
    error: "This server would not load. Pick another."
};

function paintProvider(status) {
    ui.providerStrip.hidden = false;
    ui.providerStrip.dataset.status = status;
    ui.providerText.textContent = PROVIDER_COPY[status] || status;
}

function onVideoEvent(snap) {
    state.lastSnapshot = snap;
    state.hasVideo = snap.hasVideo;

    const provider = snap.mode === "iframe";

    /* Only surface the transport that can actually do something. */
    ui.seekRow.hidden = provider || snap.duration <= 0;
    ui.play.hidden = provider;
    ui.mute.hidden = provider;
    ui.volume.hidden = provider;

    if (provider) paintProvider(snap.providerStatus);

    if (!ui.play.hidden) {
        ui.playIcon.innerHTML = snap.paused
            ? '<path d="M8 5v14l11-7z"/>'
            : '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>';
        ui.playLabel.textContent = snap.paused ? "Play" : "Pause";
    }

    ui.muteIcon.innerHTML = snap.muted
        ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'
        : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>';

    if (!state.scrubFocused) {
        ui.timeNow.textContent = fmtTime(snap.time);
        if (snap.duration > 0) {
            ui.seek.value = String(snap.time);
            paintRange(ui.seek, (snap.time / snap.duration) * 100);
        }
    }
    if (snap.duration > 0) {
        ui.timeEnd.textContent = fmtTime(snap.duration);
        ui.seek.disabled = false;
    } else {
        ui.seek.disabled = true;
    }

    if (snap.hasVideo && snap.duration > 0 && state.scene) {
        state.scene.screenMaterial.emissiveIntensity = snap.paused ? 0.5 : 1.0;
    }
}

function setupTransport() {
    ui.play.addEventListener("click", () => togglePlay());
    ui.mute.addEventListener("click", () => {
        const v = state.scene.video;
        if (!v) return;
        state.scene.setMuted(!v.muted);
        onVideoEvent(state.scene.snapshot());
    });

    ui.volume.addEventListener("input", () => {
        const val = Number(ui.volume.value);
        state.scene.setVolume(val);
        state.scene.setMuted(val === 0);
        paintRange(ui.volume, val * 100);
        onVideoEvent(state.scene.snapshot());
    });
    paintRange(ui.volume, 100);

    /* Scrubbing: freeze the readout, apply on release. */
    ui.seek.addEventListener("pointerdown", () => { state.scrubFocused = true; });
    ui.seek.addEventListener("input", () => {
        const dur = state.lastSnapshot ? state.lastSnapshot.duration : 0;
        const t = Number(ui.seek.value);
        ui.timeNow.textContent = fmtTime(t);
        paintRange(ui.seek, dur > 0 ? (t / dur) * 100 : 0);
    });
    const commit = () => {
        if (!state.scrubFocused) return;
        state.scrubFocused = false;
        const t = Number(ui.seek.value);
        state.applyingRemote = true;
        state.scene.seek(t);
        onVideoEvent(state.scene.snapshot());
        state.applyingRemote = false;
    };
    ui.seek.addEventListener("pointerup", commit);
    ui.seek.addEventListener("pointercancel", commit);
    ui.seek.addEventListener("change", commit);
    ui.seek.addEventListener("keyup", commit);

    ui.reloadBtn.addEventListener("click", () => {
        state.scene.reloadSource();
        flashHint("Reloading\u2026");
    });

    ui.lightsBtn.addEventListener("click", () => toggleHouseLights());
    ui.perfBtn.addEventListener("click", () => togglePerformanceMode());
    ui.zoomBtn.addEventListener("click", () => toggleScreenZoom());
    ui.resetView.addEventListener("click", () => {
        state.scene.resetView();
        flashHint("Back at the entrance");
    });
    ui.sourceBtn.addEventListener("click", () => openFilmPicker());
    ui.seatBtn.addEventListener("click", () => openSeatPanel());
    ui.exit.addEventListener("click", () => exitTheatre());
    ui.back.addEventListener("click", () => exitTheatre());
}

function togglePlay() {
    /* With a provider iframe on the screen, playback is the provider's
       business: its own controls live on the screen itself. */
    if (state.play && state.play.kind === "embed") {
        flashHint("Use the controls on the screen to play", 2400);
        return;
    }
    if (!state.hasVideo) {
        openFilmPicker();
        return;
    }
    state.applyingRemote = true;
    if (state.scene.video.paused) state.scene.play();
    else state.scene.pause();
    setTimeout(() => { state.applyingRemote = false; }, 60);
}

function toggleHouseLights() {
    state.houseLights = state.scene.toggleHouseLights();
    ui.lightsBtn.setAttribute("aria-pressed", String(state.houseLights));
    flashHint(state.houseLights ? "House lights on" : "House lights off");
}

/* ================================================================
   FILM PICKER
   ================================================================ */

function buildServerList() {
    ui.servers.innerHTML = "";
    for (const s of SERVERS) {
        const b = document.createElement("button");
        b.className = "th-server";
        b.dataset.key = s.key;
        b.innerHTML = `${s.name}<span class="tag">${s.tag}</span>`;
        b.title = `Play from ${s.name}`;
        b.addEventListener("click", () => {
            if (!state.play || state.play.kind !== "embed") return;
            switchServer(s.key);
        });
        ui.servers.appendChild(b);
    }
    paintServerList();
}

function paintServerList() {
    const active = state.play && state.play.kind === "embed" ? state.play.server : null;
    Array.from(ui.servers.children).forEach(b => {
        b.classList.toggle("is-active", b.dataset.key === active);
    });
    ui.serverWrap.hidden = !active;
}

function switchServer(key) {
    if (!state.play || state.play.kind !== "embed") return;
    state.scene.useServer(key, state.play);
    state.play.server = key;
    paintServerList();
    flashHint(`Switched to ${(SERVERS.find(s => s.key === key) || {}).name || key}`);
}

function openFilmPicker() {
    closePanels();
    ui.sourcePanel.hidden = false;
    paintServerList();
    if (!ui.results.childElementCount) runSearch("");
    ui.search.focus({ preventScroll: true });
}

function closePanels() {
    ui.sourcePanel.hidden = true;
    ui.seatPanel.hidden = true;
    ui.seatBtn.setAttribute("aria-pressed", "false");
}

function renderResults(items) {
    ui.results.innerHTML = "";
    if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "th-empty";
        empty.textContent = ui.search.value.trim()
            ? "Nothing matched that."
            : "No catalogue available. Check your TMDB key.";
        ui.results.appendChild(empty);
        return;
    }
    for (const item of items) {
        const b = document.createElement("button");
        b.className = "th-result";
        b.title = `${item.title}${item.year ? " (" + item.year + ")" : ""}`;
        b.innerHTML =
            (item.poster
                ? `<img src="${item.poster}" alt="" loading="lazy" decoding="async">`
                : '<div style="aspect-ratio:2/3;background:var(--surface-3)"></div>') +
            `<span class="nm"></span><span class="mt"></span>`;
        /* Set text, never interpolate remote strings into HTML. */
        b.querySelector(".nm").textContent = item.title;
        b.querySelector(".mt").textContent =
            [item.year, item.type === "tv" ? "Series" : "Movie", item.rating].filter(Boolean).join(" \u00b7 ");
        b.addEventListener("click", () => pickFilm(item));
        ui.results.appendChild(b);
    }
}

async function runSearch(query) {
    const token = ++state.searchToken;
    const q = query.trim();
    /* Empty query shows what is popular, which is a better first screen
       than an empty grid. */
    const items = q ? await searchTmdb(q, "multi") : await trendingTmdb("movie");
    if (token !== state.searchToken) return;   // a newer search already won
    renderResults(items);
}

function pickFilm(item) {
    state.media.id = item.id;
    state.media.type = item.type;
    state.media.title = item.title;
    state.media.year = item.year;
    state.media.poster = "";
    applyMediaToUi();
    loadDetail(item);
    applyEmbed({
        id: item.id,
        type: item.type,
        title: item.title,
        season: 1,
        episode: 1
    }, (state.play && state.play.server) || SERVERS[0].key);
}

/* Fetch the art and blurb after the pick, so the screen starts playing
   immediately and the chrome fills in behind it. */
async function loadDetail(item) {
    const meta = await tmdbMeta(item.type, item.id);
    if (!meta) return;
    if (state.media.id !== item.id) return;   // user moved on
    state.media.overview = meta.overview;
    state.media.genres = meta.genres;
    state.media.rating = meta.rating;
    state.media.poster = meta.backdrop || meta.poster;
    if (state.play) state.play.poster = state.media.poster;
    if (!state.play) state.scene.setPoster(state.media.poster);
}

function setupFilmPicker() {
    ui.searchBtn.addEventListener("click", () => runSearch(ui.search.value));

    /* Debounced search: typing should not fire a request per keystroke. */
    ui.search.addEventListener("input", () => {
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(() => runSearch(ui.search.value), 320);
    });
    ui.search.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            clearTimeout(state.searchTimer);
            runSearch(ui.search.value);
        }
        if (e.key === "Escape") closePanels();
    });

    ui.srcApply.addEventListener("click", () => applySource(ui.srcUrl.value.trim(), "Custom link"));
    ui.srcUrl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") applySource(ui.srcUrl.value.trim(), "Custom link");
    });
    ui.srcFile.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        /* A blob URL is local-only, so it is deliberately not persisted. */
        applySource(URL.createObjectURL(file), file.name);
        e.target.value = "";
    });
    ui.srcClose.addEventListener("click", closePanels);
}

/* ================================================================
   SEAT PICKER
   ================================================================ */

/* Built from SEAT_LAYOUT so the map can never disagree with the room. */
function buildSeatPlan() {
    const legend = ui.seatPlan.querySelector(".seat-legend");
    ui.seatPlan.innerHTML = '<div class="seat-screen"></div>';
    for (const row of SEAT_LAYOUT.rows) {
        const wrap = document.createElement("div");
        wrap.className = "seat-row";

        const label = document.createElement("div");
        label.className = "seat-row-label";
        const b = document.createElement("b");
        b.textContent = `Row ${row.id}`;
        const note = document.createElement("span");
        note.textContent = row.label;
        label.append(b, note);
        wrap.appendChild(label);

        const grid = document.createElement("div");
        grid.className = "seat-grid";
        for (const seat of SEATS.filter(s => s.row === row.id)) {
            const btn = document.createElement("button");
            btn.className = "map-seat";
            btn.textContent = seat.id;
            btn.dataset.seat = seat.id;
            btn.title = `Select seat ${seat.id}, ${row.label}`;
            btn.setAttribute("aria-label", `Select seat ${seat.id}, ${row.label}`);
            btn.addEventListener("click", () => selectSeat(seat));
            grid.appendChild(btn);
        }
        wrap.appendChild(grid);
        ui.seatPlan.appendChild(wrap);
    }
    ui.seatPlan.appendChild(legend);
    paintSeatPlan();
}

function paintSeatPlan() {
    Array.from(ui.seatPlan.querySelectorAll(".map-seat")).forEach(b => {
        b.classList.toggle("is-selected", b.dataset.seat === (state.selectedSeat && state.selectedSeat.id));
    });
}

function selectSeat(seat) {
    if (!seat) return;
    state.selectedSeat = seat;
    ui.seatCode.textContent = seat.id;
    ui.seatBlurb.textContent = SEAT_NOTES[seat.id] || "";
    ui.seatDetail.querySelector(".eyebrow").textContent =
        seat.row === "A" ? "Main floor" : seat.row === "B" ? "Mezzanine" : "Raised back row";
    paintSeatPlan();
}

function openSeatPanel() {
    closePanels();
    ui.seatPanel.hidden = false;
    ui.seatBtn.setAttribute("aria-pressed", "true");
}

function setupSeatPicker() {
    ui.seatClose.addEventListener("click", closePanels);
    ui.sitBtn.addEventListener("click", () => {
        const seat = state.scene.sitAt(state.selectedSeat);
        if (!seat) return;
        closePanels();
        flashHint(`Settled into ${seat.id}`, 2200);
        markUserMoved();
    });
}

/* ================================================================
   PARTY
   ================================================================ */

function setupParty() {
    ui.partyToggle.addEventListener("click", () => {
        const open = ui.party.classList.toggle("is-open");
        ui.partyToggle.setAttribute("aria-pressed", String(open));
        if (open) ui.chatInput.focus({ preventScroll: true });
    });

    ui.tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            ui.tabs.forEach(t => t.classList.toggle("is-active", t === tab));
            const showChat = tab.dataset.tab === "chat";
            ui.chatPane.hidden = !showChat;
            ui.peoplePane.hidden = showChat;
        });
    });

    ui.hostBtn.addEventListener("click", startHosting);
    ui.leaveBtn.addEventListener("click", leaveParty);
    ui.joinBtn.addEventListener("click", joinRoom);
    ui.joinCode.addEventListener("keydown", (e) => {
        if (e.key === "Enter") joinRoom();
    });

    ui.copyRoom.addEventListener("click", async () => {
        if (!state.party || !state.party.code) return;
        const link = window.theatreInviteLink(state.party.code);
        try {
            await navigator.clipboard.writeText(link);
            flashHint("Invite link copied");
        } catch (e) {
            flashHint(state.party.code);
        }
    });

    ui.chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const text = ui.chatInput.value.trim();
        if (!text) return;
        if (state.party && state.party.inParty) {
            state.party.sendChat(text);
        } else {
            appendChat({ username: "You", avatar: "\u{1F3AC}", text, uid: "self" });
        }
        ui.chatInput.value = "";
    });

    /* If the URL already carried a room code, try to join straight away. */
    if (roomFromUrl) {
        ui.joinCode.value = roomFromUrl;
        setTimeout(() => joinRoom(true), 400);
    } else {
        ui.partyStart.style.display = "flex";
    }
}

function makeParty() {
    return new window.TheatreParty({
        chat: appendChat,
        members: renderMembers,
        state: applyRemoteState,
        joined: onPartyJoined,
        left: onPartyLeft,
        error: (msg) => flashHint(msg, 3200),
        status: (msg) => { ui.subtitle.textContent = msg; }
    });
}

async function startHosting() {
    if (state.party) state.party.leave();
    const party = makeParty();
    state.party = party;

    const initial = {
        title: state.media.title,
        poster: state.media.poster || "",
        seat: state.selectedSeat ? state.selectedSeat.id : "B3"
    };

    ui.hostBtn.disabled = true;
    ui.hostBtn.textContent = "Opening\u2026";
    const code = await party.host(initial);
    ui.hostBtn.disabled = false;
    ui.hostBtn.textContent = "Start a party";

    if (!code) {
        ui.subtitle.textContent = state.media.title;
        return;
    }

    /* The host publishes position on its own 1s tick. */
    startHostTicker();
    party.broadcast(hostSnapshot());
}

async function joinRoom(silent = false) {
    if (state.party) state.party.leave();
    const code = ui.joinCode.value.trim();
    if (!code) {
        if (!silent) flashHint("Enter a room code", 2200);
        return;
    }
    const party = makeParty();
    state.party = party;
    if (!silent) ui.joinBtn.textContent = "Joining\u2026";
    const ok = await party.join(code);
    ui.joinBtn.textContent = "Join";
    if (!ok && !silent) ui.joinCode.focus({ preventScroll: true });
    if (ok) party.startGuestHeartbeat();
}

function startHostTicker() {
    if (state.hostTicker) clearInterval(state.hostTicker);
    state.hostTicker = setInterval(() => {
        const party = state.party;
        if (!party || !party.inParty || !party.isHost) return;
        party.broadcast(hostSnapshot());
    }, 1000);
}

function hostSnapshot() {
    const snap = state.scene ? state.scene.snapshot() : {};
    return {
        /* For a provider embed the meaningful thing is the title and the
           server, not a timestamp: each guest loads the same iframe
           themselves and controls it on the screen. */
        play: state.play,
        source: state.source,
        hasVideo: !!state.hasVideo,
        time: snap.time || 0,
        duration: snap.duration || 0,
        paused: !!snap.paused,
        playing: !!(snap.paused === false && snap.hasVideo),
        title: state.media.title,
        poster: state.media.poster || "",
        seat: state.selectedSeat ? state.selectedSeat.id : "B3"
    };
}

function applyRemoteState(remote) {
    if (!state.scene) return;
    state.applyingRemote = true;

    if (remote.title && remote.title !== state.media.title) {
        state.media.title = remote.title;
        ui.title.textContent = remote.title;
        document.title = `${remote.title} | WaveMirror 3D Theatre`;
    }
    if (remote.poster && !state.scene.posterTexture) state.scene.setPoster(remote.poster);

    /* Adopt the host's title. A provider embed is rebuilt from the id and
       server, so every guest watches the same thing through the same
       provider without anything being proxied. */
    if (remote.play && remote.play.id && remote.play.id !== (state.play && state.play.id)) {
        applyEmbedQuiet(remote.play);
    } else if (remote.play && remote.play.server &&
               remote.play.server !== (state.play && state.play.server)) {
        switchServer(remote.play.server);
    } else if (!remote.play && remote.source && remote.source.url &&
               remote.source.url !== (state.source && state.source.url)) {
        applySourceQuiet(remote.source.url);
    } else if (!remote.play && remote.source && !remote.source.shareable &&
               !state.hasVideo && !state.privateNoticeShown) {
        /* The host is watching a local file we cannot read. Say so once,
           rather than showing a black screen with no explanation. */
        state.privateNoticeShown = true;
        appendChat({
            username: "System",
            text: "The host is playing a file from their own device, which cannot be shared. Load the same video yourself to watch along.",
            system: true
        });
        flashHint("Host's source cannot be shared", 3600);
        openFilmPicker();
    }

    /* Movement: the host took a seat. */
    if (remote.seat && !state.userMoved) {
        const seat = SEATS.find(s => s.id === remote.seat);
        if (seat) {
            state.selectedSeat = seat;
            paintSeatPlan();
            state.scene.sitAt(seat);
        }
    }

    /* Playback sync only applies to media we decode ourselves. */
    if (state.hasVideo && (!state.play || state.play.kind === "file")) {
        const v = state.scene.video;
        const hostTime = remote.time || 0;
        const drift = v.currentTime - hostTime;

        if (v.paused && !remote.paused) v.play().catch(() => {});
        else if (!v.paused && remote.paused) v.pause();

        /* Correct when the slip is visible. While the film is running a
           small gap is smoothed by playback itself, so the threshold is
           tighter; while paused any gap means a missed seek. */
        const threshold = v.paused ? 0.4 : 1.2;
        if (Math.abs(drift) > threshold) state.scene.seek(hostTime);
    }

    onVideoEvent(state.scene.snapshot());
    state.applyingRemote = false;
}

function applyEmbedQuiet(play) {
    state.applyingRemote = true;
    applyEmbed({
        id: play.id,
        type: play.type,
        season: play.season,
        episode: play.episode,
        title: play.title
    }, play.server, { silent: true });
    state.applyingRemote = false;
}

function applySourceQuiet(url) {
    /* Defence in depth: never adopt a document-scoped URL from the wire. */
    if (!/^https?:/i.test(url)) return;
    state.applyingRemote = true;
    applySource(url, null, { silent: true });
    state.applyingRemote = false;
}

function onPartyJoined(info) {
    ui.roomWrap.hidden = false;
    ui.roomCode.textContent = info.code;
    ui.hostBtn.hidden = true;
    ui.leaveBtn.hidden = false;
    ui.partyStart.hidden = true;
    ui.partyJoin.hidden = true;
    ui.party.classList.add("is-open");
    ui.partyToggle.setAttribute("aria-pressed", "true");

    appendChat({
        username: "System",
        text: info.isHost
            ? "Room open. Share the link or the code to invite people."
            : "You joined the room. Chat is live.",
        system: true
    });
    renderPresence(info.members || {});
}

function leaveParty() {
    if (state.party) state.party.leave();
    state.party = null;
    if (state.hostTicker) { clearInterval(state.hostTicker); state.hostTicker = null; }
    onPartyLeft();
}

function onPartyLeft() {
    ui.roomWrap.hidden = true;
    ui.partyStart.hidden = false;
    ui.partyJoin.hidden = true;
    ui.hostBtn.hidden = false;
    ui.leaveBtn.hidden = true;
    ui.members.innerHTML = "";
    renderPresence({});
    appendChat({ username: "System", text: "You left the party. The theatre still works solo.", system: true });
}

function renderMembers(members) {
    ui.members.innerHTML = "";
    const list = Object.entries(members || {});
    if (!list.length) {
        const empty = document.createElement("div");
        empty.className = "th-member";
        const nm = document.createElement("span");
        nm.className = "nm";
        nm.style.color = "var(--text-muted)";
        nm.textContent = "Nobody else here yet";
        empty.appendChild(nm);
        ui.members.appendChild(empty);
    }
    for (const [, m] of list) {
        const row = document.createElement("div");
        row.className = "th-member";
        const av = document.createElement("span");
        av.className = "av";
        av.textContent = m.avatar || "\u{1F3AC}";
        const nm = document.createElement("span");
        nm.className = "nm";
        nm.textContent = m.username || "Guest";
        row.append(av, nm);
        if (m.role === "Host") {
            const badge = document.createElement("span");
            badge.className = "th-host-badge";
            badge.textContent = "Host";
            row.appendChild(badge);
        }
        ui.members.appendChild(row);
    }
    renderPresence(members || {});
}

function renderPresence(members) {
    const n = Object.keys(members || {}).length;
    if (!n) {
        ui.presence.classList.remove("is-live");
        ui.presenceText.textContent = "Solo";
        return;
    }
    ui.presence.classList.add("is-live");
    ui.presenceText.textContent = n === 1 ? "1 watching" : `${n} watching`;
}

function appendChat(msg) {
    const wrap = document.createElement("div");
    wrap.className = "th-msg" + (msg.system ? " is-system" : "") +
        (msg.uid === "self" || msg.uid === (state.party && state.party.myKey) ? " is-self" : "");

    if (!msg.system) {
        const who = document.createElement("div");
        who.className = "who";
        who.textContent = msg.username || "Guest";
        wrap.appendChild(who);
    }
    const bub = document.createElement("div");
    bub.className = "bub";
    bub.textContent = msg.text || "";
    wrap.appendChild(bub);

    ui.chatLog.appendChild(wrap);
    /* Keep the DOM bounded on very long sessions. */
    while (ui.chatLog.childElementCount > 120) ui.chatLog.removeChild(ui.chatLog.firstChild);
    ui.chatLog.scrollTop = ui.chatLog.scrollHeight;
}

/* ================================================================
   TOUCH STICK
   ================================================================ */

function setupStick() {
    const stick = $("thStick");
    const knob = $("thStickKnob");
    if (!stick || !knob || !state.scene) return;

    const RADIUS = 34;   // knob travel in px

    const reset = () => {
        state.scene.setMoveVector(0, 0);
        knob.style.transform = "";
    };

    function onStickMove(e) {
        const rect = stick.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let dx = e.clientX - cx;
        let dy = e.clientY - cy;
        const len = Math.hypot(dx, dy);
        if (len > RADIUS) {
            dx = (dx / len) * RADIUS;
            dy = (dy / len) * RADIUS;
        }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        /* Normalised: x = strafe, y = forward (screen up is forward). */
        state.scene.setMoveVector(dx / RADIUS, -dy / RADIUS);
    }

    stick.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        stick.setPointerCapture(e.pointerId);
        markUserMoved();
        onStickMove(e);
    });
    stick.addEventListener("pointermove", (e) => {
        if (!stick.hasPointerCapture || !stick.hasPointerCapture(e.pointerId)) return;
        onStickMove(e);
    });
    stick.addEventListener("pointerup", reset);
    stick.addEventListener("pointercancel", reset);
    /* Losing the pointer mid-drag must not leave the walker running. */
    stick.addEventListener("lostpointercapture", reset);
}

/* ================================================================
   KEYBOARD
   ================================================================ */

function setupKeyboard() {
    window.addEventListener("keydown", (e) => {
        const tag = (e.target.tagName || "").toLowerCase();
        const typing = tag === "input" || tag === "textarea" || tag === "select";

        if (e.key === "Escape") {
            if (!ui.sourcePanel.hidden || !ui.seatPanel.hidden) { closePanels(); return; }
            if (typing) { e.target.blur(); return; }
            exitTheatre();
            return;
        }
        if (typing) return;

        /* Space toggles playback, but not when it would scroll the page. */
        if (e.code === "Space") {
            e.preventDefault();
            togglePlay();
            return;
        }
        /* M mute, L house lights, F fullscreen, R reset view.
           Deliberately no S shortcut: S is already walk-backward. */
        switch (e.key.toLowerCase()) {
            case "m": {
                if (!state.scene.video) return;
                state.scene.setMuted(!state.scene.video.muted);
                onVideoEvent(state.scene.snapshot());
                break;
            }
            case "l": toggleHouseLights(); break;
            case "f": toggleFullscreen(); break;
            case "r": state.scene.resetView(); flashHint("Back at the entrance"); break;
            case "e": {
                const wasSeated = !!state.scene.seated;
                const seat = state.scene.toggleSitNearest();
                if (seat) {
                    state.selectedSeat = seat;
                    paintSeatPlan();
                    ui.seatCode.textContent = seat.id;
                    ui.seatBlurb.textContent = SEAT_NOTES[seat.id] || "";
                    flashHint(`Seat ${seat.id}. Press E to stand.`, 2600);
                } else if (wasSeated) {
                    flashHint("Standing", 1200);
                } else {
                    flashHint("No seat in reach", 1400);
                }
                break;
            }
            case "p": togglePerformanceMode(); break;
            case "z": toggleScreenZoom(); break;
            default: break;
        }
    });
}

/* Performance mode: favours a high frame rate over crisp shadows. */
let performanceMode = false;
function togglePerformanceMode() {
    performanceMode = !performanceMode;
    state.scene.setPerformanceMode(performanceMode);
    flashHint(performanceMode ? "Performance mode on" : "Quality mode on");
    if (ui.perfBtn) ui.perfBtn.setAttribute("aria-pressed", String(performanceMode));
}

/* Screen zoom: telephoto in. */
let screenZoom = false;
function toggleScreenZoom() {
    screenZoom = !screenZoom;
    state.scene.setScreenZoom(screenZoom);
    flashHint(screenZoom ? "Screen zoom in" : "Screen zoom off");
    if (ui.zoomBtn) ui.zoomBtn.setAttribute("aria-pressed", String(screenZoom));
}

function toggleFullscreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen?.();
    } else {
        document.documentElement.requestFullscreen?.().catch(() => {});
    }
}

/* ================================================================
   PERFORMANCE METER
   ================================================================ */

/* A visible frame counter is worth having in a room this heavy: if the
   device is struggling, the number explains why before the user assumes
   the theatre is broken.

   It samples renderer.info.render.frame, which Three.js increments once
   per actual render. Counting frames in a setInterval instead would
   measure the interval, not the scene. */
function setupFpsMeter() {
    let lastFrame = state.scene.renderer.info.render.frame;
    let lastAt = performance.now();

    setInterval(() => {
        const now = performance.now();
        const elapsed = now - lastAt;
        const frames = state.scene.renderer.info.render.frame - lastFrame;
        lastFrame = state.scene.renderer.info.render.frame;
        lastAt = now;
        if (elapsed <= 0) return;

        state.fps = Math.round((frames * 1000) / elapsed);
        ui.fpsValue.textContent = String(state.fps);
        ui.fps.classList.toggle("is-good", state.fps >= 45);
        ui.fps.classList.toggle("is-mid", state.fps >= 25 && state.fps < 45);
        ui.fps.classList.toggle("is-bad", state.fps < 25);
    }, 500);

    ui.fps.title = `Frames per second, ${state.scene.tier} quality. ` +
        "Lower the tier if the room feels sluggish.";
    ui.fps.addEventListener("click", () => {
        flashHint("Render detail is chosen automatically for this device", 2600);
    });
}

/* ================================================================
   IDLE CHROME
   ================================================================ */

function setupIdleChrome() {
    const wake = () => {
        ui.bottom.classList.remove("is-idle");
        if (state.idleTimer) clearTimeout(state.idleTimer);
        state.idleTimer = setTimeout(() => {
            if (!state.scrubFocused) ui.bottom.classList.add("is-idle");
        }, 3200);
    };
    ["pointermove", "pointerdown", "keydown", "wheel"].forEach(ev =>
        window.addEventListener(ev, wake, { passive: true })
    );
    wake();

    ui.hint.classList.add("is-visible");
    setTimeout(() => ui.hint.classList.remove("is-visible"), 6000);
}

function flashHint(text, ms = 1800) {
    ui.hint.textContent = text;
    ui.hint.classList.add("is-visible");
    if (state.hintTimer) clearTimeout(state.hintTimer);
    state.hintTimer = setTimeout(() => ui.hint.classList.remove("is-visible"), ms);
}

/* ---------------------------------------------------------------
   Lifecycle
   --------------------------------------------------------------- */

function markUserMoved() {
    state.userMoved = true;
    /* Re-arm following after a few seconds of stillness. */
    clearTimeout(state.moveTimer);
    state.moveTimer = setTimeout(() => { state.userMoved = false; }, 5000);
}

function exitTheatre() {
    /* Leaving a party must never take the theatre down with it. */
    if (state.party && state.party.inParty) state.party.leave();
    if (state.hostTicker) { clearInterval(state.hostTicker); state.hostTicker = null; }
    if (state.scene) state.scene.stop();
    window.location.href = state.returnUrl || "./index.html";
}

function enterTheatre() {
    if (!state.scene || state.entered) return;
    state.entered = true;
    ui.gate.classList.add("is-gone");
    state.scene.start();

    /* The click is a real user gesture. A local file can start unmuted;
       a provider iframe cannot be touched from here, so its own play
       control on the screen handles that. */
    if (state.hasVideo) {
        state.scene.setMuted(false);
        state.scene.play();
    }
    markUserMoved();
}

document.addEventListener("visibilitychange", () => {
    if (!state.scene) return;
    if (document.hidden) {
        state.scene.stop();
        state.scene.video.pause();
    } else if (ui.gate.classList.contains("is-gone")) {
        state.scene.start();
    }
});

/* Free the GPU on the way out; bfcache restores need a fresh start. */
window.addEventListener("pagehide", () => {
    if (state.scene) state.scene.dispose();
});

window.addEventListener("pageshow", (e) => {
    if (e.persisted && state.scene) {
        state.scene.disposed = false;
        state.scene.start();
    }
});

/* Mark movement so guest follow-mode stops fighting the walker. */
window.addEventListener("keydown", (e) => {
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
        markUserMoved();
    }
}, { passive: true });
ui.canvas.addEventListener("pointerdown", markUserMoved, { passive: true });

/* ---------------------------------------------------------------
   Go
   --------------------------------------------------------------- */

ui.enter.addEventListener("click", enterTheatre);

document.addEventListener("DOMContentLoaded", () => {
    /* Remember where to send people back to. */
    const back = params.get("from");
    state.returnUrl = back && /^[\w\-./%?=&:]+$/.test(back) ? back : "./index.html";

    boot().catch((e) => {
        console.error("[Theatre] boot failed", e);
        failGate("Something went wrong opening the theatre. Try again.");
    });
});