/* ================================================================
   WAVEMIRROR 3D THEATRE - Watch Party
   ---------------------------------------------------------------
   A small realtime layer for the 3D theatre. It reuses the same
   Firebase project and the same `rooms/<CODE>` tree that party.js
   already writes to, so the 2D party and the theatre can coexist,
   but it only understands the subset of nodes the theatre needs.

   Where to change the backend:
     ROOM_PATH      - the tree under which rooms live
     getConfig()    - swap Firebase for PeerJS / a websocket / your API
     SYNC_INTERVAL  - how often the host broadcasts position

   Sync model:
     The host is authoritative. It broadcasts { action, time, paused,
     rate } on a 1s timer. Guests never write to videoState; they only
     listen. Every incoming message carries a timestamp, and a guest
     that has been buffering re-seeks on the next tick instead of
     drifting further out.
   ================================================================ */

const ROOM_PATH = "rooms";        // <- realtime backend: change here
const SYNC_INTERVAL = 1000;       // ms, the "~1s" the brief asked for
const MAX_CHAT_LOG = 120;         // trim so a long party cannot grow forever
const CHAT_TRIM_AT = 160;
const STALE_MEMBER_MS = 20000;    // drop members whose heartbeat stopped

/* ---------- profile: reuse the name the user already picked ---------- */

function readTheatreProfile() {
    /* Same storage key party.js uses, so a display name set once is
       shared between the 2D party and the theatre. */
    try {
        const stored = JSON.parse(localStorage.getItem("wavemirror_user_profile") || "null");
        if (stored && stored.username) {
            return {
                username: String(stored.username).slice(0, 24),
                avatar: stored.avatar || "\u{1F3AC}",
                color: stored.color || "#6366f1"
            };
        }
    } catch (e) { /* corrupt or unavailable storage */ }
    return {
        username: "Spectator-" + (100 + Math.floor(Math.random() * 900)),
        avatar: "\u{1F3AC}",
        color: "#6366f1"
    };
}

function getConfig() {
    if (typeof window !== "undefined" && window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) {
        return window.FIREBASE_CONFIG;
    }
    if (typeof window !== "undefined" && window.ENV) {
        return {
            apiKey: window.ENV.FIREBASE_API_KEY || "",
            authDomain: window.ENV.FIREBASE_AUTH_AUTH_DOMAIN || window.ENV.FIREBASE_AUTH_DOMAIN || "",
            databaseURL: window.ENV.FIREBASE_DATABASE_URL || "",
            projectId: window.ENV.FIREBASE_PROJECT_ID || "",
            storageBucket: window.ENV.FIREBASE_STORAGE_BUCKET || "",
            messagingSenderId: window.ENV.FIREBASE_MESSAGING_SENDER_ID || "",
            appId: window.ENV.FIREBASE_APP_ID || "",
            measurementId: window.ENV.FIREBASE_MEASUREMENT_ID || ""
        };
    }
    return {};
}

/* ---------- room codes: same alphabet as party.js, so codes look alike ---------- */

function makeRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
    let a = "", b = "";
    for (let i = 0; i < 3; i++) {
        a += chars.charAt(Math.floor(Math.random() * chars.length));
        b += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `WAVE-${a}-${b}`;
}

/* Room codes are used as Firebase keys, and several characters are
   illegal in RTDB paths. Normalise anything a user might paste. */
function normaliseCode(raw) {
    const cleaned = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!cleaned) return "";
    /* Accept WAVEABC123, WAVE-ABC-123 and abc123 alike. */
    const body = cleaned.startsWith("WAVE") ? cleaned.slice(4) : cleaned;
    if (body.length < 4) return cleaned;
    return `WAVE-${body.slice(0, 3)}-${body.slice(3, 6)}`;
}

/* ================================================================
   TheatreParty
   ================================================================ */

class TheatreParty {
    constructor(handlers = {}) {
        this.on = Object.assign({
            chat: () => {},
            members: () => {},
            state: () => {},      // host state for guests
            joined: () => {},
            left: () => {},
            error: () => {},
            status: () => {}
        }, handlers);

        this.profile = readTheatreProfile();
        this.inParty = false;
        this.isHost = false;
        this.code = null;
        this.db = null;
        this.ref = null;
        this.myKey = null;
        this.members = {};
        this.timer = null;
        this.lastStateStamp = 0;
        this.applying = false;   // suppress echo while we apply remote state
    }

    get available() {
        return typeof firebase !== "undefined" && !!getConfig().apiKey;
    }

    /* ---------------- host ---------------- */

    async host(initialState = {}) {
        if (!this.available) {
            this.on.error("Realtime backend unavailable - loading the 3D API failed.");
            return null;
        }
        this.code = makeRoomCode();
        this.isHost = true;
        this.myKey = "hostKey";

        try {
            this._connect();
            this.on.status("Opening room...");

            /* overwrite() so a recycled code cannot inherit stale members */
            await this.ref.set({
                host: this.profile.username,
                isTheatre: true,   // lets a 2D party recognise the room type
                createdAt: Date.now(),
                /* play = the catalogue title on the screen, with the server
                   chosen for it; source = a direct file/URL the host loaded
                   locally. Exactly one is ever set. */
                theatreState: Object.assign({
                    play: null,
                    source: null,
                    time: 0,
                    duration: 0,
                    paused: true,
                    playing: false,
                    hasVideo: false,
                    timestamp: Date.now()
                }, initialState),
                members: {
                    hostKey: this._memberPayload("Host")
                }
            });

            this.inParty = true;
            this._bindListeners();
            this._startHeartbeat();
            this.on.joined({ code: this.code, isHost: true, members: this.members });
            return this.code;
        } catch (e) {
            console.error("[TheatreParty] host failed", e);
            this.on.error("Could not open the room.");
            this._teardown();
            return null;
        }
    }

    /* ---------------- guest ---------------- */

    async join(rawCode) {
        if (!this.available) {
            this.on.error("Realtime backend unavailable - loading the 3D API failed.");
            return false;
        }
        const code = normaliseCode(rawCode);
        if (code.length < 4) {
            this.on.error("That room code looks incomplete.");
            return false;
        }

        this.isHost = false;
        this.code = code;
        this.myKey = "guest_" + Math.random().toString(36).slice(2, 8);

        try {
            this._connect();
            this.on.status("Finding room...");

            const snap = await this.ref.once("value");
            if (!snap.exists()) {
                this.on.error("No room with that code.");
                this._teardown();
                return false;
            }

            this.inParty = true;
            await this.ref.child(`members/${this.myKey}`).set(this._memberPayload("Guest"));

            this._bindListeners();
            this.on.joined({ code: this.code, isHost: false, members: this.members });
            return true;
        } catch (e) {
            console.error("[TheatreParty] join failed", e);
            this.on.error("Could not join that room.");
            this._teardown();
            return false;
        }
    }

    /* ---------------- host controls ---------------- */

    /* Push a new authoritative state. Timestamp-gated on read, so a
       message that arrives late is ignored rather than applied late. */
    broadcast(state) {
        if (!this.inParty || !this.isHost) return;
        const payload = Object.assign({}, state, { timestamp: Date.now() });
        try {
            this.ref.child("theatreState").set(payload);
        } catch (e) {
            console.warn("[TheatreParty] broadcast failed", e);
        }
    }

    sendChat(text) {
        if (!this.inParty) return;
        const body = String(text || "").trim().slice(0, 300);
        if (!body) return;
        this.ref.child("chat").push().set({
            uid: this.myKey,
            username: this.profile.username,
            avatar: this.profile.avatar,
            text: body,
            at: Date.now()
        }).then(() => this._trimChat()).catch((e) => {
            console.warn("[TheatreParty] chat send failed", e);
            this.on.error("Message did not send.");
        });
    }

    leave() {
        if (!this.inParty) return;
        try {
            if (this.myKey) this.ref.child(`members/${this.myKey}`).remove();
            /* The host tears the room down so a later host with the same
               code does not inherit a ghost roster. */
            if (this.isHost) this.ref.remove();
        } catch (e) { /* offline: Firebase will handle it */ }

        const wasIn = this.inParty;
        this._teardown();
        if (wasIn) this.on.left();
    }

    /* ---------------- internals ---------------- */

    _connect() {
        if (!firebase.apps.length) firebase.initializeApp(getConfig());
        this.db = firebase.database();
        this.ref = this.db.ref(`${ROOM_PATH}/${this.code}`);
    }

    _memberPayload(role) {
        return {
            username: this.profile.username,
            avatar: this.profile.avatar,
            color: this.profile.color,
            role,
            isTheatre: true,
            lastSeen: Date.now()
        };
    }

    _bindListeners() {
        /* Chat: newest only, so a long session does not replay fully. */
        const chatQ = this.ref.child("chat").limitToLast(MAX_CHAT_LOG);
        chatQ.on("child_added", (snap) => {
            const msg = snap.val();
            if (!msg || !msg.text) return;
            this.on.chat(msg);
            this._trimChat();
        });

        /* Members: full set on every change. The roster is small, and this
           is simpler than stitching child events together. */
        this.ref.child("members").on("value", (snap) => {
            const val = snap.val() || {};
            /* Heartbeats mean a closed tab can linger; drop anything stale. */
            const now = Date.now();
            this.members = {};
            for (const key in val) {
                const m = val[key];
                if (!m) continue;
                if (!m.lastSeen || now - m.lastSeen > STALE_MEMBER_MS) continue;
                this.members[key] = m;
            }
            this.on.members(this.members);
        });

        /* Host state: guests only. */
        if (!this.isHost) {
            this.ref.child("theatreState").on("value", (snap) => {
                const state = snap.val();
                if (!state || !state.timestamp) return;
                if (state.timestamp <= this.lastStateStamp) return;
                this.lastStateStamp = state.timestamp;
                this.on.state(state);
            });
        }
    }

    /* Host heartbeat: presence for everyone plus a position update on the
       1s cadence the brief asked for. */
    _startHeartbeat() {
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => {
            if (!this.inParty || !this.isHost) return;
            const now = Date.now();
            try {
                this.ref.child(`members/${this.myKey}/lastSeen`).set(now);
            } catch (e) { /* transient */ }
            /* The route installs a broadcaster here if it wants one. */
            if (typeof this.onHeartbeat === "function") {
                this.broadcast(this.onHeartbeat());
            }
        }, SYNC_INTERVAL);
    }

    /* Guests keep their own presence fresh. */
    startGuestHeartbeat() {
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => {
            if (!this.inParty || this.isHost) return;
            try {
                this.ref.child(`members/${this.myKey}/lastSeen`).set(Date.now());
            } catch (e) { /* transient */ }
        }, SYNC_INTERVAL);
    }

    async _trimChat() {
        try {
            const snap = await this.ref.child("chat").orderByChild("at").limitToLast(1).once("value");
            const latestKey = snap.val() && Object.keys(snap.val())[0];
            const all = await this.ref.child("chat").once("value");
            const keys = Object.keys(all.val() || {});
            if (keys.length < CHAT_TRIM_AT) return;
            /* Drop the oldest, keeping the log bounded. */
            for (const k of keys.slice(0, keys.length - MAX_CHAT_LOG)) {
                if (k === latestKey) continue;
                await this.ref.child(`chat/${k}`).remove();
            }
        } catch (e) { /* trimming is best effort */ }
    }

    _teardown() {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        try {
            this.ref.child("chat").off();
            this.ref.child("members").off();
            this.ref.child("theatreState").off();
        } catch (e) { /* already gone */ }
        this.inParty = false;
        this.isHost = false;
        this.ref = null;
        this.members = {};
        this.lastStateStamp = 0;
    }
}

/* ---------- invitation link, built to match party.js's URL convention ---------- */

function theatreInviteLink(code) {
    const base = new URL(window.location.href);
    base.pathname = base.pathname.replace(/[^/]*$/, "theatre.html");
    base.search = "";
    base.hash = "";
    const q = base.searchParams;
    q.set("room", code);
    /* Carry the current media through so a guest lands on the right screen. */
    if (currentTheatreMedia && currentTheatreMedia.id) {
        q.set("id", currentTheatreMedia.id);
        if (currentTheatreMedia.type) q.set("type", currentTheatreMedia.type);
    }
    return base.toString();
}

/* Set by the route before a party is opened. */
let currentTheatreMedia = null;
function setTheatreMedia(media) { currentTheatreMedia = media; }

if (typeof window !== "undefined") {
    window.TheatreParty = TheatreParty;
    window.theatreInviteLink = theatreInviteLink;
    window.setTheatreMedia = setTheatreMedia;
    window.makeTheatreRoomCode = makeRoomCode;
    window.normaliseTheatreRoomCode = normaliseCode;
    window.MAX_THEATRE_CHAT = MAX_CHAT_LOG;
}