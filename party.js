// WaveMirror Watch Party Engine - P2P Sync & Audio/Chat Dashboard using PeerJS

const ICE_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:openrelay.metered.ca:80' },
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelay',
            credential: 'openrelay'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelay',
            credential: 'openrelay'
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelay',
            credential: 'openrelay'
        }
    ]
};

function createPeerInstance(id = null) {
    const options = {
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true,
        config: ICE_CONFIG,
        debug: 1
    };
    return id ? new Peer(id, options) : new Peer(options);
}

// State variables
let localUser = {
    username: "",
    avatar: "🍿",
    color: "#FFD700"
};

let partyState = {
    inParty: false,
    isHost: false,
    roomId: null,
    peer: null,
    hostConn: null, // Connection to host (if client)
    peerConns: {},  // Map of client peerId -> DataConnection (if host)
    members: {},    // Map of peerId -> { username, avatar, color, isMuted }
    activeMedia: {
        id: null,
        title: "",
        type: "movie",
        server: 1,
        season: 1,
        episode: 1
    },
    localAudioStream: null,
    peerCalls: {},  // Map of peerId -> mediaCall
    isVoiceActive: false,
    isMuted: false,
    allowGuestControls: false,
    localFileName: null,
    localFileSize: null,
    localVideoStream: null,
    ytPlayer: null,
    syncMode: localStorage.getItem("wavemirror_sync_mode") || "firebase",
    db: null,
    dbRoomRef: null
};

const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyAPjV1bkduOVAl8u_30C7XbO7MgkDo9yE4",
    authDomain: "chicknbun.firebaseapp.com",
    databaseURL: "https://chicknbun-default-rtdb.firebaseio.com",
    projectId: "chicknbun",
    storageBucket: "chicknbun.firebasestorage.app",
    messagingSenderId: "645109894487",
    appId: "1:645109894487:web:99466cf25e3e5b6019c212",
    measurementId: "G-N7F026W5G5"
};

// Initialize Profile on page load
document.addEventListener("DOMContentLoaded", () => {
    initUserProfile();
    checkUrlForParty();
    initPartyCatalog();
});

// --- Profile Management ---

function initUserProfile() {
    try {
        const stored = localStorage.getItem("wavemirror_user_profile");
        if (stored) {
            localUser = JSON.parse(stored);
        } else {
            localUser.username = `Spectator-${Math.floor(Math.random() * 900) + 100}`;
            localUser.avatar = "🍿";
            localUser.color = "#FFD700";
            saveProfileLocally();
        }
    } catch (e) {
        console.error("Error reading profile", e);
    }
}

function saveProfileLocally() {
    localStorage.setItem("wavemirror_user_profile", JSON.stringify(localUser));
}

function openProfileModal() {
    const modal = document.getElementById("profileModal");
    if (!modal) return;
    
    document.getElementById("profileUsername").value = localUser.username;
    
    // Set active status on emoji selectors
    const emojiOpts = document.querySelectorAll(".emoji-opt");
    emojiOpts.forEach(btn => {
        btn.classList.toggle("active", btn.innerText === localUser.avatar);
    });
    
    // Set active status on color selectors
    const colorOpts = document.querySelectorAll(".color-opt");
    colorOpts.forEach(btn => {
        const bg = btn.style.backgroundColor || rgbToHex(btn.style.backgroundColor);
        btn.classList.toggle("active", btn.style.backgroundColor.toLowerCase() === hexToRgb(localUser.color) || bg.toLowerCase() === localUser.color.toLowerCase());
    });
    
    modal.classList.add("active");
}

function closeProfileModal() {
    const modal = document.getElementById("profileModal");
    if (modal) modal.classList.remove("active");
}

function selectAvatarEmoji(emoji) {
    localUser.avatar = emoji;
    const emojiOpts = document.querySelectorAll(".emoji-opt");
    emojiOpts.forEach(btn => {
        btn.classList.toggle("active", btn.innerText === emoji);
    });
}

function selectProfileColor(color) {
    localUser.color = color;
    const colorOpts = document.querySelectorAll(".color-opt");
    colorOpts.forEach(btn => {
        const styleBg = btn.style.backgroundColor;
        btn.classList.toggle("active", styleBg === color || rgbToHex(styleBg) === color);
    });
}

function saveUserProfile() {
    const usernameInput = document.getElementById("profileUsername");
    if (usernameInput) {
        const name = usernameInput.value.trim();
        if (name) localUser.username = name;
    }
    saveProfileLocally();
    closeProfileModal();
    showToast("Profile updated successfully!");
    
    // If in party, send profile updates
    if (partyState.inParty) {
        const payload = {
            type: "profileUpdate",
            profile: localUser
        };
        sendToParty(payload);
        
        // Update self in local list
        const myPeerId = partyState.peer ? partyState.peer.id : 'me';
        partyState.members[myPeerId] = { ...localUser, isMuted: partyState.isMuted };
        renderMemberList();
    }
}

// Helper utilities for color conversion
function rgbToHex(rgb) {
    if (!rgb || rgb.indexOf('rgb') !== 0) return rgb;
    const parts = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)$/);
    if (!parts) return rgb;
    const r = parseInt(parts[1]).toString(16).padStart(2, '0');
    const g = parseInt(parts[2]).toString(16).padStart(2, '0');
    const b = parseInt(parts[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `rgb(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)})` : hex;
}

// --- Watch Party Logic ---

function checkUrlForParty() {
    const params = new URLSearchParams(window.location.search);
    const partyRoom = params.get("party");
    if (partyRoom) {
        showToast(`Joining Watch Party ${partyRoom}...`);
        joinWatchParty(partyRoom);
        return;
    }

    const startParty = params.get("startParty");
    if (startParty === "true") {
        const movieId = params.get("movieId");
        const type = params.get("type") || "movie";
        const server = parseInt(params.get("server")) || 1;
        
        // Host a party with this movie!
        const code = generateRoomCode();
        if (partyState.syncMode === "firebase") {
            partyState.isHost = true;
            partyState.roomId = code;
            initFirebaseHost(code, movieId, type, server);
        } else {
            createWatchPartyWithMedia(code, movieId, type, server);
        }
    }
}

function createWatchPartyWithMedia(roomCode, movieId, type, server) {
    if (typeof Peer === "undefined") {
        setTimeout(() => createWatchPartyWithMedia(roomCode, movieId, type, server), 200);
        return;
    }
    roomCode = roomCode.toUpperCase().trim();
    showLoader(true);
    partyState.isHost = true;
    partyState.roomId = roomCode;
    
    partyState.peer = createPeerInstance(`wm-party-${roomCode.replace(/-/g, "")}`);

    partyState.peer.on("open", (id) => {
        partyState.inParty = true;
        const myId = id;
        partyState.members[myId] = { ...localUser, isMuted: false, role: "Host" };
        
        switchToPartyView();
        document.getElementById("partyRoomCode").innerText = roomCode;
        addSystemMessage("Watch Party created! Copy the link and share it with friends.");
        showLoader(false);
        
        loadPartyMedia(movieId, type, server, 1, 1, true);
    });

    partyState.peer.on("connection", (conn) => {
        setupHostConnection(conn);
    });

    partyState.peer.on("call", (call) => {
        if (partyState.isVoiceActive && partyState.localAudioStream) {
            call.answer(partyState.localAudioStream);
            setupVoiceCall(call);
        } else {
            call.answer(); 
        }
    });

    partyState.peer.on("error", (err) => {
        console.error("PeerJS Error", err);
        showLoader(false);
        if (err.type === "unavailable-id") {
            showToast("This Watch Party room is already active! Creating a different one...");
            createWatchPartyWithMedia(generateRoomCode(), movieId, type, server);
        } else {
            showToast(`Connection error: ${err.message}`);
        }
    });
}

function showWatchPartyCreateUI() {
    // Check if already in party
    if (partyState.inParty) {
        showToast("You are already in a Watch Party!");
        switchToPartyView();
        return;
    }
    
    // Create random room code
    const code = generateRoomCode();
    createWatchParty(code);
}

function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No confusing characters like 0, O, 1, I
    let code1 = "";
    let code2 = "";
    for (let i = 0; i < 3; i++) {
        code1 += chars.charAt(Math.floor(Math.random() * chars.length));
        code2 += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `WAVE-${code1}-${code2}`;
}

function createWatchParty(roomCode) {
    roomCode = roomCode.toUpperCase().trim();
    if (partyState.syncMode === "firebase") {
        initFirebaseHost(roomCode);
        return;
    }
    if (typeof Peer === "undefined") {
        setTimeout(() => createWatchParty(roomCode), 200);
        return;
    }
    showLoader(true);
    partyState.isHost = true;
    partyState.roomId = roomCode;
    
    partyState.peer = createPeerInstance(`wm-party-${roomCode.replace(/-/g, "")}`);

    partyState.peer.on("open", (id) => {
        partyState.inParty = true;
        const myId = id;
        partyState.members[myId] = { ...localUser, isMuted: false, role: "Host" };
        
        switchToPartyView();
        document.getElementById("partyRoomCode").innerText = roomCode;
        addSystemMessage("Watch Party created! Copy the link and share it with friends.");
        showLoader(false);
        
        // Select Dune: Part Two as default
        loadPartyMedia("693134", "movie", 1, 1, 1, true);
    });

    partyState.peer.on("connection", (conn) => {
        setupHostConnection(conn);
    });

    partyState.peer.on("call", (call) => {
        if (partyState.isVoiceActive && partyState.localAudioStream) {
            call.answer(partyState.localAudioStream);
            setupVoiceCall(call);
        } else {
            // Reject call or answer with no audio stream if voice chat is disabled
            call.answer(); 
        }
    });

    partyState.peer.on("error", (err) => {
        console.error("PeerJS Error", err);
        showLoader(false);
        if (err.type === "unavailable-id") {
            showToast("This Watch Party room is already active! Creating a different one...");
            createWatchParty(generateRoomCode());
        } else {
            showToast(`Connection error: ${err.message}`);
        }
    });
}

async function joinWatchParty(roomCode) {
    roomCode = roomCode.toUpperCase().trim();
    showLoader(true);
    
    // Auto-detect Sync Mode: Check if room exists on Firebase
    if (typeof firebase !== "undefined") {
        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(DEFAULT_FIREBASE_CONFIG);
            }
            const db = firebase.database();
            const roomRef = db.ref(`rooms/${roomCode}`);
            const snapshot = await roomRef.once("value");
            
            if (snapshot.exists()) {
                console.log("Firebase room found! Joining via Cloud Database sync...");
                partyState.syncMode = "firebase";
                initFirebaseGuest(roomCode);
                return;
            }
        } catch (e) {
            console.warn("Firebase check failed, trying WebRTC...", e);
        }
    }
    
    // Fall back to WebRTC
    console.log("Room not found on Firebase. Falling back to WebRTC...");
    partyState.syncMode = "webrtc";
    
    if (typeof Peer === "undefined") {
        setTimeout(() => joinWatchParty(roomCode), 200);
        return;
    }
    
    partyState.isHost = false;
    partyState.roomId = roomCode;
    let connectRetries = 0;
    partyState.peer = createPeerInstance();

    partyState.peer.on("open", (id) => {
        tryConnectToHost();
    });

    function tryConnectToHost() {
        const hostId = `wm-party-${roomCode.replace(/-/g, "")}`;
        console.log(`Attempting connection to host: ${hostId} (Attempt ${connectRetries + 1})`);
        
        const conn = partyState.peer.connect(hostId, {
            metadata: { profile: localUser }
        });
        
        setupGuestConnection(conn);
        
        // Listen to error on the connection itself
        conn.on("error", (err) => {
            console.warn("Connection error, retrying...", err);
            handleConnectionFailure();
        });
        
        // If connection doesn't open within 4.5 seconds, try again
        const timeoutTimer = setTimeout(() => {
            if (!partyState.inParty) {
                console.warn("Connection attempt timed out. Retrying...");
                conn.close();
                handleConnectionFailure();
            }
        }, 4500);
        
        // Clear timeout if connection succeeds
        conn.on("open", () => {
            clearTimeout(timeoutTimer);
        });
    }
    
    function handleConnectionFailure() {
        if (connectRetries < 2) {
            connectRetries++;
            showToast(`Connection handshake delayed. Retrying (${connectRetries}/3)...`);
            setTimeout(() => {
                tryConnectToHost();
            }, 1200);
        } else {
            showLoader(false);
            showToast("Could not reach Watch Party host. Check the code or connection.");
            leaveWatchParty();
        }
    }

    partyState.peer.on("call", (call) => {
        const metadata = call.metadata || {};
        if (metadata.type === "videoBroadcast") {
            call.answer();
            call.on("stream", (remoteStream) => {
                const video = document.getElementById("partyVideo");
                if (video) {
                    video.srcObject = remoteStream;
                    video.play().catch(e => console.log("Stream autoplay blocked:", e));
                    const prompt = document.getElementById("localFilePrompt");
                    if (prompt) prompt.style.display = "none";
                }
            });
            return;
        }
        
        if (partyState.localAudioStream) {
            call.answer(partyState.localAudioStream);
        } else {
            call.answer();
        }
        setupVoiceCall(call);
    });

    partyState.peer.on("error", (err) => {
        console.error("PeerJS Error", err);
        // Avoid quitting on standard connection warnings that are handled via retries
        if (err.type !== "peer-unavailable" && err.type !== "network") {
            showLoader(false);
            showToast(`Connection error: ${err.type}`);
            leaveWatchParty();
        }
    });
}

// Setup connection handlers for the Host
function setupHostConnection(conn) {
    const peerId = conn.peer;
    partyState.peerConns[peerId] = conn;

    conn.on("open", () => {
        // Register member profile from metadata
        const metadata = conn.metadata || {};
        const profile = metadata.profile || { username: `Guest-${peerId.substring(0,4)}`, avatar: "🍿", color: "#8ba2c4" };
        partyState.members[peerId] = { ...profile, isMuted: false, role: "Guest" };
        
        renderMemberList();
        addSystemMessage(`${profile.username} joined the party!`);
        
        // Sync current media state to the new client
        conn.send({
            type: "mediaSync",
            media: partyState.activeMedia
        });

        // Sync current permissions
        conn.send({
            type: "permissionsUpdate",
            allowGuestControls: partyState.allowGuestControls
        });
        
        // Sync custom video player details
        if (partyState.activeMedia.server === 5) {
            if (partyState.activeMedia.type === "youtube") {
                conn.send({
                    type: "customUrlSync",
                    url: `https://www.youtube.com/watch?v=${partyState.activeMedia.id}`
                });
                if (partyState.ytPlayer && typeof partyState.ytPlayer.getCurrentTime !== "undefined") {
                    const state = partyState.ytPlayer.getPlayerState();
                    conn.send({
                        type: "ytSync",
                        action: (state === 2 || state === 0) ? "pause" : "play",
                        time: partyState.ytPlayer.getCurrentTime()
                    });
                }
            } else {
                const video = document.getElementById("partyVideo");
                if (video) {
                    if (partyState.localFileName) {
                        conn.send({
                            type: "localFileSync",
                            fileName: partyState.localFileName,
                            fileSize: partyState.localFileSize
                        });
                        
                        // Stream video stream directly to late-joining guest
                        if (partyState.localVideoStream) {
                            const call = partyState.peer.call(peerId, partyState.localVideoStream, {
                                metadata: { type: "videoBroadcast" }
                            });
                            partyState.peerCalls[`video-${peerId}`] = call;
                        }
                    } else {
                        conn.send({
                            type: "customUrlSync",
                            url: video.src
                        });
                    }
                    conn.send({
                        type: "videoSync",
                        action: video.paused ? "pause" : "play",
                        time: video.currentTime
                    });
                }
            }
        }

        // Broadcast updated member list to everyone
        broadcastMemberList();
        
        // Relayout voice call if voice active
        if (partyState.isVoiceActive && partyState.localAudioStream) {
            initiateVoiceCallToPeer(peerId);
        }
    });

    conn.on("data", (data) => {
        handleIncomingData(peerId, data);
    });

    conn.on("close", () => {
        const profile = partyState.members[peerId] || {};
        addSystemMessage(`${profile.username || "Guest"} left the party.`);
        
        delete partyState.peerConns[peerId];
        delete partyState.members[peerId];
        
        // Close voice call
        if (partyState.peerCalls[peerId]) {
            partyState.peerCalls[peerId].close();
            delete partyState.peerCalls[peerId];
        }

        renderMemberList();
        broadcastMemberList();
    });
}

// Setup connection handlers for the Guest
function setupGuestConnection(conn) {
    partyState.hostConn = conn;
    const peerId = conn.peer;

    conn.on("open", () => {
        partyState.inParty = true;
        switchToPartyView();
        document.getElementById("partyRoomCode").innerText = partyState.roomId;
        addSystemMessage("Connected to Watch Party!");
        showLoader(false);

        // Save self to members
        const myPeerId = partyState.peer.id;
        partyState.members[myPeerId] = { ...localUser, isMuted: false, role: "Guest" };
    });

    conn.on("data", (data) => {
        handleIncomingData(peerId, data);
    });

    conn.on("close", () => {
        showToast("Watch Party host disconnected.");
        leaveWatchParty();
    });
}

// Handle incoming WebRTC data packets
function handleIncomingData(senderPeerId, data) {
    if (!data || !data.type) return;

    switch (data.type) {
        case "mediaSync":
            // Sync what is currently playing
            const oldMedia = partyState.activeMedia;
            partyState.activeMedia = data.media;
            loadPartyMedia(data.media.id, data.media.type, data.media.server, data.media.season, data.media.episode, false);
            if (oldMedia.id !== data.media.id) {
                addSystemMessage(`Now watching: ${data.media.title}`);
            }
            break;
            
        case "chat":
            // Add chat bubble
            appendChatMessage(data.sender, data.message);
            // Host relays chat message to all other clients
            if (partyState.isHost) {
                relayData(senderPeerId, data);
            }
            break;

        case "membersList":
            // Update guests with official member list from host
            partyState.members = data.members;
            renderMemberList();
            break;

        case "profileUpdate":
            // Update profile of a specific participant
            if (partyState.members[senderPeerId]) {
                const oldName = partyState.members[senderPeerId].username;
                partyState.members[senderPeerId] = {
                    ...partyState.members[senderPeerId],
                    ...data.profile
                };
                if (oldName !== data.profile.username) {
                    addSystemMessage(`"${oldName}" is now known as "${data.profile.username}"`);
                }
                renderMemberList();
                
                if (partyState.isHost) {
                    broadcastMemberList();
                }
            }
            break;

        case "muteState":
            if (partyState.members[senderPeerId]) {
                partyState.members[senderPeerId].isMuted = data.isMuted;
                renderMemberList();
                if (partyState.isHost) {
                    broadcastMemberList();
                }
            }
            break;
            
        case "permissionsUpdate":
            partyState.allowGuestControls = data.allowGuestControls;
            const chk = document.getElementById("allowGuestControls");
            if (chk) {
                chk.checked = data.allowGuestControls;
            }
            if (data.allowGuestControls) {
                addSystemMessage("Host has enabled playback control permissions for guests.");
            } else {
                addSystemMessage("Host has locked playback control permissions.");
            }
            break;
            
        case "customUrlSync":
            const promptEl = document.getElementById("localFilePrompt");
            if (promptEl) promptEl.style.display = "none";
            const customUrlInput = document.getElementById("partyCustomUrlInput");
            if (customUrlInput) {
                customUrlInput.value = data.url;
            }
            loadCustomVideoUrl(false);
            break;
            
        case "localFileSync":
            partyState.localFileName = data.fileName;
            partyState.localFileSize = data.fileSize;
            loadPartyMedia("custom", "movie", 5, 1, 1, false);
            const promptBox = document.getElementById("localFilePrompt");
            if (promptBox) {
                promptBox.style.display = "flex";
                promptBox.classList.remove("hidden");
                document.getElementById("localFilePromptText").innerHTML = `Host is playing a local file:<br><strong>${data.fileName}</strong> (${(data.fileSize / 1024 / 1024).toFixed(1)} MB).<br>Select your local copy of this file to watch in perfect sync.`;
            }
            break;
            
        case "requestHostSync":
            if (partyState.isHost) {
                const conn = partyState.peerConns[senderPeerId];
                if (conn && conn.open) {
                    conn.send({
                        type: "mediaSync",
                        media: partyState.activeMedia
                    });
                    if (partyState.activeMedia.server === 5) {
                        if (partyState.activeMedia.type === "youtube") {
                            conn.send({
                                type: "customUrlSync",
                                url: `https://www.youtube.com/watch?v=${partyState.activeMedia.id}`
                            });
                            if (partyState.ytPlayer && typeof partyState.ytPlayer.getCurrentTime !== "undefined") {
                                const state = partyState.ytPlayer.getPlayerState();
                                conn.send({
                                    type: "ytSync",
                                    action: (state === 2 || state === 0) ? "pause" : "play",
                                    time: partyState.ytPlayer.getCurrentTime()
                                });
                            }
                        } else {
                            const video = document.getElementById("partyVideo");
                            if (video) {
                                if (partyState.localFileName) {
                                    conn.send({
                                        type: "localFileSync",
                                        fileName: partyState.localFileName,
                                        fileSize: partyState.localFileSize
                                    });
                                } else {
                                    conn.send({
                                        type: "customUrlSync",
                                        url: video.src
                                    });
                                }
                                conn.send({
                                    type: "videoSync",
                                    action: video.paused ? "pause" : "play",
                                    time: video.currentTime
                                });
                            }
                        }
                    }
                }
            }
            break;
            
        case "videoSync":
            handleIncomingVideoSync(data);
            if (partyState.isHost) {
                relayData(senderPeerId, data);
            }
            break;
            
        case "ytSync":
            handleIncomingYtSync(data);
            if (partyState.isHost) {
                relayData(senderPeerId, data);
            }
            break;
            
        case "systemAlert":
            addSystemMessage(data.message);
            break;
    }
}

function sendToParty(data) {
    if (partyState.syncMode === "firebase") {
        if (partyState.dbRoomRef) {
            if (data.type === "chatMessage") {
                partyState.dbRoomRef.child("chat").push({
                    username: data.username,
                    message: data.message,
                    color: data.color,
                    avatar: data.avatar,
                    timestamp: Date.now()
                }).catch(handleFirebaseWriteError);
            } else if (data.type === "videoSync") {
                if (partyState.isHost || partyState.allowGuestControls) {
                    partyState.dbRoomRef.child("videoState").set({
                        action: data.action,
                        time: data.time,
                        paused: data.paused !== undefined ? data.paused : (data.action === "pause"),
                        timestamp: Date.now()
                    }).catch(handleFirebaseWriteError);
                }
            } else if (data.type === "mediaSync") {
                if (partyState.isHost) {
                    partyState.dbRoomRef.child("activeMedia").set(data.media).catch(handleFirebaseWriteError);
                }
            } else if (data.type === "customUrlSync") {
                if (partyState.isHost) {
                    partyState.dbRoomRef.child("customUrl").set({
                        url: data.url,
                        timestamp: Date.now()
                    }).catch(handleFirebaseWriteError);
                }
            } else if (data.type === "localFileSync") {
                if (partyState.isHost) {
                    partyState.dbRoomRef.child("localFile").set({
                        fileName: data.fileName,
                        fileSize: data.fileSize,
                        timestamp: Date.now()
                    }).catch(handleFirebaseWriteError);
                }
            } else if (data.type === "ytSync") {
                if (partyState.isHost || partyState.allowGuestControls) {
                    partyState.dbRoomRef.child("ytState").set({
                        action: data.action,
                        time: data.time,
                        timestamp: Date.now()
                    }).catch(handleFirebaseWriteError);
                }
            }
        }
        return;
    }

    if (partyState.isHost) {
        // Relays data to all active peer connections
        Object.values(partyState.peerConns).forEach(conn => {
            if (conn.open) conn.send(data);
        });
    } else if (partyState.hostConn && partyState.hostConn.open) {
        partyState.hostConn.send(data);
    }
}

// Host relays peer data to other peers
function relayData(excludePeerId, data) {
    Object.entries(partyState.peerConns).forEach(([peerId, conn]) => {
        if (peerId !== excludePeerId && conn.open) {
            conn.send(data);
        }
    });
}

function broadcastMemberList() {
    sendToParty({
        type: "membersList",
        members: partyState.members
    });
}

// --- Sync Media Functions ---

async function loadPartyMedia(mediaId, type = "movie", server = 1, season = 1, episode = 1, triggerBroadcast = false) {
    const iframe = document.getElementById("partyIframe");
    if (!iframe) return;

    partyState.activeMedia.id = mediaId;
    partyState.activeMedia.type = type;
    partyState.activeMedia.server = server;
    partyState.activeMedia.season = season;
    partyState.activeMedia.episode = episode;

    // Fetch stream details to show title and synopsis
    let details = await fetchStreamDetails(mediaId, type);
    if (!details) {
        details = { title: "Media Stream", year: "----", rating: "0.0", duration: "0h", overview: "Stream exclusive titles on WaveMirror." };
    }
    
    partyState.activeMedia.title = details.title;
    document.getElementById("partyMediaTitle").innerText = details.title;
    document.getElementById("partyMediaMeta").innerText = `${details.year} • ★ ${details.rating} • ${details.duration}`;

    // Set server active button in watch party UI
    const sButtons = document.querySelectorAll("#partyServerSwitcher .server-btn");
    sButtons.forEach((btn, idx) => {
        btn.classList.toggle("active", idx + 1 === server);
    });

    // Handle video player visibility & source mapping
    const video = document.getElementById("partyVideo");
    const customPanel = document.getElementById("partyCustomUrlPanel");
    const syncLabel = document.getElementById("partySyncStatusNotice");
    
    if (server === 5) {
        if (syncLabel) {
            syncLabel.innerText = "⚡ Real-time Playback Sync Active";
            syncLabel.style.color = "var(--primary-neon)";
        }
        if (type === "youtube") {
            iframe.style.display = "block";
            iframe.classList.remove("hidden");
            if (video) {
                video.style.display = "none";
                video.classList.add("hidden");
                video.pause();
                video.src = "";
            }
            iframe.src = `https://www.youtube.com/embed/${mediaId}?enablejsapi=1&autoplay=1&controls=1&rel=0`;
            setupYoutubePlayer();
        } else {
            iframe.style.display = "none";
            iframe.classList.add("hidden");
            if (video) {
                video.style.display = "block";
                video.classList.remove("hidden");
            }
        }
        if (customPanel) {
            customPanel.style.display = "flex";
            customPanel.classList.remove("hidden");
        }
        // TV controls are not needed for custom direct links
        document.getElementById("partyTvControls").style.display = "none";
        document.getElementById("partyTvControls").classList.add("hidden");
    } else {
        if (syncLabel) {
            syncLabel.innerText = "⚠️ Catalog Item Syncing Only (Iframe Locked)";
            syncLabel.style.color = "#ffab00";
        }
        partyState.localFileName = null;
        partyState.localFileSize = null;
        const promptEl = document.getElementById("localFilePrompt");
        if (promptEl) promptEl.style.display = "none";
        
        iframe.style.display = "block";
        iframe.classList.remove("hidden");
        if (video) {
            video.style.display = "none";
            video.classList.add("hidden");
            video.pause();
            video.src = "";
        }
        if (customPanel) {
            customPanel.style.display = "none";
            customPanel.classList.add("hidden");
        }

        const imdb = details.imdbId || mediaId;
        if (type === "tv") {
            document.getElementById("partyTvControls").style.display = "flex";
            document.getElementById("partyTvControls").classList.remove("hidden");
            
            // Populate season/episode dropdowns if host
            if (partyState.isHost) {
                setupPartyTvDropdowns(details.seasonsCount || 1, season, episode);
            }

            if (server === 1) {
                iframe.src = `https://vidlink.pro/tv/${mediaId}/${season}/${episode}`;
            } else if (server === 2) {
                iframe.src = `https://vidsrc.xyz/embed/tv/${mediaId}/${season}-${episode}`;
            } else if (server === 3) {
                iframe.src = `https://vidsrc.cc/embed/tv/${mediaId}/${season}/${episode}`;
            } else {
                iframe.src = `https://autoembed.cc/embed/tv/${mediaId}/${season}/${episode}`;
            }
        } else {
            document.getElementById("partyTvControls").style.display = "none";
            document.getElementById("partyTvControls").classList.add("hidden");

            if (server === 1) {
                iframe.src = `https://vidlink.pro/movie/${mediaId}`;
            } else if (server === 2) {
                iframe.src = `https://vidsrc.xyz/embed/movie/${imdb}`;
            } else if (server === 3) {
                iframe.src = `https://vidsrc.cc/embed/movie/${mediaId}`;
            } else {
                iframe.src = `https://autoembed.cc/embed/movie/${mediaId}`;
            }
        }
    }

    if (partyState.isHost && triggerBroadcast) {
        sendToParty({
            type: "mediaSync",
            media: partyState.activeMedia
        });
    }
}

function loadPartyServer(num, btnElement, triggerBroadcast = false) {
    if (!partyState.isHost && !partyState.allowGuestControls) {
        showToast("Only the host can switch servers!");
        return;
    }
    loadPartyMedia(partyState.activeMedia.id, partyState.activeMedia.type, num, partyState.activeMedia.season, partyState.activeMedia.episode, triggerBroadcast);
}

function setupPartyTvDropdowns(seasonsCount, currentSeason, currentEpisode) {
    const seasonSelect = document.getElementById("partySeasonSelect");
    const episodeSelect = document.getElementById("partyEpisodeSelect");
    if (!seasonSelect || !episodeSelect) return;

    seasonSelect.innerHTML = Array.from({length: seasonsCount}, (_, i) => `<option value="${i+1}">Season ${i+1}</option>`).join('');
    episodeSelect.innerHTML = Array.from({length: 24}, (_, i) => `<option value="${i+1}">Episode ${i+1}</option>`).join('');

    seasonSelect.value = currentSeason;
    episodeSelect.value = currentEpisode;
}

function updatePartyTvStream(triggerBroadcast = false) {
    if (!partyState.isHost && !partyState.allowGuestControls) {
        showToast("Only the host can change episodes!");
        return;
    }
    const s = parseInt(document.getElementById("partySeasonSelect").value) || 1;
    const e = parseInt(document.getElementById("partyEpisodeSelect").value) || 1;
    loadPartyMedia(partyState.activeMedia.id, partyState.activeMedia.type, partyState.activeMedia.server, s, e, triggerBroadcast);
}

function syncWithHost() {
    if (partyState.isHost) {
        // Host pushes sync to all peers
        sendToParty({
            type: "mediaSync",
            media: partyState.activeMedia
        });
        showToast("Pushed stream sync to all members!");
    } else {
        // Peer requests sync from host
        if (partyState.hostConn && partyState.hostConn.open) {
            showToast("Requesting sync from host...");
            // Reloader
            const oldSrc = document.getElementById("partyIframe").src;
            document.getElementById("partyIframe").src = "about:blank";
            setTimeout(() => {
                document.getElementById("partyIframe").src = oldSrc;
            }, 100);
        }
    }
}

function closePartyAdOverlay() {
    const iframe = document.getElementById("partyIframe");
    if (!iframe) return;
    const currentSrc = iframe.src;
    iframe.src = "about:blank";
    setTimeout(() => {
        iframe.src = currentSrc;
        showToast("⚡ Watch Party Player refreshed & ads cleared!");
    }, 100);
}

// --- Text Chat Logic ---

function sendPartyChatMessage(event) {
    event.preventDefault();
    const chatInput = document.getElementById("partyChatInput");
    if (!chatInput) return;
    const text = chatInput.value.trim();
    if (!text) return;

    const myPeerId = partyState.peer ? partyState.peer.id : 'me';
    
    // Append locally
    appendChatMessage(localUser, text);

    // Broadcast message
    sendToParty({
        type: "chat",
        sender: localUser,
        message: text
    });

    chatInput.value = "";
    chatInput.focus();
}

function appendChatMessage(sender, message) {
    const chatArea = document.getElementById("partyChatMessages");
    if (!chatArea) return;

    const msgItem = document.createElement("div");
    msgItem.className = "chat-message-item";
    
    const isSelf = sender.username === localUser.username;
    msgItem.style.justifyContent = isSelf ? "flex-end" : "flex-start";

    msgItem.innerHTML = `
        <div class="chat-message-bubble" style="${isSelf ? 'border-top-right-radius: 0; border-top-left-radius: 12px; background: rgba(255, 215, 0, 0.05); border-color: rgba(255, 215, 0, 0.15);' : ''}">
            <span class="chat-message-user" style="color: ${sender.color || '#fff'}">${sender.avatar} ${sender.username}</span>
            <span class="chat-message-text">${escapeHtml(message)}</span>
        </div>
    `;

    chatArea.appendChild(msgItem);
    chatArea.scrollTop = chatArea.scrollHeight;
}

function addSystemMessage(text) {
    const chatArea = document.getElementById("partyChatMessages");
    if (!chatArea) return;

    const msgItem = document.createElement("div");
    msgItem.className = "chat-message-item";
    msgItem.style.justifyContent = "center";
    msgItem.innerHTML = `<div class="chat-system-message">${text}</div>`;

    chatArea.appendChild(msgItem);
    chatArea.scrollTop = chatArea.scrollHeight;
}

// --- Voice Chat Logic ---

async function toggleVoiceChat() {
    const btn = document.getElementById("btn-toggle-voice");
    const badge = document.getElementById("voiceStatusBadge");
    
    if (partyState.isVoiceActive) {
        // Disable Voice Chat
        partyState.isVoiceActive = false;
        btn.innerText = "Join Voice Chat";
        btn.style.background = "";
        badge.innerText = "Disabled";
        badge.className = "voice-status-badge";
        
        // Stop audio tracks
        if (partyState.localAudioStream) {
            partyState.localAudioStream.getTracks().forEach(track => track.stop());
            partyState.localAudioStream = null;
        }

        // Close all voice calls
        Object.values(partyState.peerCalls).forEach(call => call.close());
        partyState.peerCalls = {};

        // Disable mute button
        document.getElementById("btn-mute-mic").disabled = true;
        document.getElementById("btn-mute-mic").innerText = "🎤";
        partyState.isMuted = false;

        // Broadcast mute state update
        sendMuteStateToParty(false);
        showToast("Voice chat left.");
    } else {
        // Request Microphone and Join Voice Chat
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            partyState.localAudioStream = stream;
            partyState.isVoiceActive = true;
            
            btn.innerText = "Leave Voice Chat";
            btn.style.background = "linear-gradient(135deg, var(--accent-red || #ff3366), #cc0033)";
            badge.innerText = "Active";
            badge.className = "voice-status-badge active";

            // Enable mute button
            document.getElementById("btn-mute-mic").disabled = false;
            
            showToast("Voice chat joined successfully!");

            // Connect voice calling
            if (partyState.isHost) {
                // Host calls all clients
                Object.keys(partyState.peerConns).forEach(peerId => {
                    initiateVoiceCallToPeer(peerId);
                });
            } else {
                // Client calls Host
                const hostId = `wm-party-${partyState.roomId.replace(/-/g, "")}`;
                const call = partyState.peer.call(hostId, stream, { metadata: { type: "voice" } });
                setupVoiceCall(call);
            }
        } catch (err) {
            console.error("Microphone capture failed", err);
            showToast("Could not access microphone. Voice chat requires mic permissions.");
        }
    }
}

function initiateVoiceCallToPeer(peerId) {
    if (!partyState.localAudioStream) return;
    const call = partyState.peer.call(peerId, partyState.localAudioStream, { metadata: { type: "voice" } });
    setupVoiceCall(call);
}

function setupVoiceCall(call) {
    const peerId = call.peer;
    partyState.peerCalls[peerId] = call;

    call.on("stream", (remoteStream) => {
        // Play remote audio
        playRemoteAudio(peerId, remoteStream);
    });

    call.on("close", () => {
        removeRemoteAudio(peerId);
        if (partyState.peerCalls[peerId]) delete partyState.peerCalls[peerId];
    });

    call.on("error", (err) => {
        console.error("Voice Call Error:", err);
    });
}

function playRemoteAudio(peerId, stream) {
    let audioEl = document.getElementById(`audio-remote-${peerId}`);
    if (!audioEl) {
        audioEl = document.createElement("audio");
        audioEl.id = `audio-remote-${peerId}`;
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
    }
    audioEl.srcObject = stream;
}

function removeRemoteAudio(peerId) {
    const audioEl = document.getElementById(`audio-remote-${peerId}`);
    if (audioEl) audioEl.remove();
}

function toggleMicMute() {
    if (!partyState.localAudioStream) return;
    
    partyState.isMuted = !partyState.isMuted;
    
    // Toggle audio track enablement
    partyState.localAudioStream.getAudioTracks().forEach(track => {
        track.enabled = !partyState.isMuted;
    });

    const muteBtn = document.getElementById("btn-mute-mic");
    muteBtn.innerText = partyState.isMuted ? "🔇" : "🎤";
    muteBtn.style.borderColor = partyState.isMuted ? "var(--accent-red || #ff3366)" : "";
    muteBtn.style.color = partyState.isMuted ? "var(--accent-red || #ff3366)" : "";

    showToast(partyState.isMuted ? "Microphone Muted" : "Microphone Active");

    // Broadcast mute state update
    sendMuteStateToParty(partyState.isMuted);

    // Update self in member list UI
    const myPeerId = partyState.peer ? partyState.peer.id : 'me';
    if (partyState.members[myPeerId]) {
        partyState.members[myPeerId].isMuted = partyState.isMuted;
        renderMemberList();
    }
}

function sendMuteStateToParty(muted) {
    sendToParty({
        type: "muteState",
        isMuted: muted
    });
}

// --- Navigation View Toggles ---

function switchToPartyView() {
    document.getElementById("homeView").style.display = "none";
    document.getElementById("homeView").classList.add("hidden");
    
    document.getElementById("partyView").style.display = "block";
    document.getElementById("partyView").classList.remove("hidden");
    
    // Enable/disable permissions check based on host status
    const chk = document.getElementById("allowGuestControls");
    if (chk) {
        chk.disabled = !partyState.isHost;
        chk.checked = partyState.allowGuestControls;
    }
    
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
}

function leaveWatchParty() {
    exitFirebaseRoom();
    partyState.inParty = false;
    
    // Clean up active streams and players
    const iframe = document.getElementById("partyIframe");
    if (iframe) iframe.src = "about:blank";
    const video = document.getElementById("partyVideo");
    if (video) {
        video.pause();
        video.src = "";
        try { video.load(); } catch(e) {}
    }
    partyState.activeMedia = {
        id: null,
        title: "",
        type: "movie",
        server: 1,
        season: 1,
        episode: 1
    };
    partyState.ytPlayer = null;

    // Stop audio
    if (partyState.localAudioStream) {
        partyState.localAudioStream.getTracks().forEach(track => track.stop());
        partyState.localAudioStream = null;
    }

    // Close PeerJS connections
    if (partyState.peer) {
        partyState.peer.destroy();
        partyState.peer = null;
    }

    // Clean voice audio elements
    const audios = document.querySelectorAll("audio[id^='audio-remote-']");
    audios.forEach(el => el.remove());

    // Reset voice buttons
    const btn = document.getElementById("btn-toggle-voice");
    if (btn) btn.innerText = "Join Voice Chat";
    const badge = document.getElementById("voiceStatusBadge");
    if (badge) {
        badge.innerText = "Disabled";
        badge.className = "voice-status-badge";
    }
    const muteBtn = document.getElementById("btn-mute-mic");
    if (muteBtn) {
        muteBtn.disabled = true;
        muteBtn.innerText = "🎤";
    }

    // Reset state map
    partyState.isHost = false;
    partyState.roomId = null;
    partyState.hostConn = null;
    partyState.peerConns = {};
    partyState.members = {};
    partyState.peerCalls = {};
    partyState.isVoiceActive = false;
    partyState.isMuted = false;

    // Reset chat
    const chatArea = document.getElementById("partyChatMessages");
    if (chatArea) {
        chatArea.innerHTML = `<div class="chat-system-message">Welcome to WaveMirror Watch Party! Share your room code to start streaming together.</div>`;
    }

    // URL cleaning
    window.history.pushState({}, document.title, window.location.pathname);

    // Switch view back to home
    document.getElementById("partyView").style.display = "none";
    document.getElementById("partyView").classList.add("hidden");
    
    document.getElementById("homeView").style.display = "block";
    document.getElementById("homeView").classList.remove("hidden");
    
    showToast("Left the Watch Party.");
}

function copyPartyLink() {
    if (!partyState.roomId) return;
    const inviteLink = `${window.location.origin}${window.location.pathname}?party=${partyState.roomId}`;
    navigator.clipboard.writeText(inviteLink);
    showToast("Watch Party invite link copied to clipboard! 🔗");
}

function renderMemberList() {
    const list = document.getElementById("partyMemberList");
    const countBadge = document.getElementById("partyCount");
    if (!list) return;

    const members = Object.entries(partyState.members);
    if (countBadge) countBadge.innerText = members.length;

    list.innerHTML = members.map(([peerId, user]) => {
        const isSelf = partyState.peer && peerId === partyState.peer.id;
        const muteIndicator = user.isMuted ? "🔇 Muted" : "🎤 On";
        const roleBadgeClass = user.role === "Host" ? "host" : "guest";

        return `
            <div class="member-card">
                <div class="member-card-left">
                    <div class="member-avatar" style="background: ${user.color || '#8ba2c4'}">${user.avatar || '🍿'}</div>
                    <div style="display: flex; flex-direction: column;">
                        <span class="member-name">${escapeHtml(user.username)} ${isSelf ? '(You)' : ''}</span>
                        <span style="font-size: 0.7rem; color: ${user.isMuted ? 'var(--accent-red || #ff3366)' : '#00e676'}">${muteIndicator}</span>
                    </div>
                </div>
                <span class="member-badge ${roleBadgeClass}">${user.role || 'Guest'}</span>
            </div>
        `;
    }).join("");
}

// --- Watch Party Catalog Explorer & Search Integration ---

function initPartyCatalog() {
    // Populate with trending items on load
    renderPartyCatalogGrid(FEATURED_MOVIES);
}

function renderPartyCatalogGrid(list) {
    const grid = document.getElementById("partyMovieGrid");
    if (!grid) return;

    if (!list || list.length === 0) {
        grid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No items found.</p>`;
        return;
    }

    grid.innerHTML = list.map(item => `
        <div class="movie-card" onclick="selectPartyMedia('${item.id}', '${item.type || 'movie'}')" style="border-radius: 8px;">
            <div class="poster-wrapper" style="aspect-ratio: 2/3;">
                <img class="poster-img" src="${item.poster}" alt="${item.title}" loading="lazy">
                <span class="card-badge-top" style="font-size: 0.65rem; padding: 1px 4px;">★ ${item.rating}</span>
            </div>
            <div class="movie-info" style="padding: 0.5rem; gap: 0.1rem;">
                <div class="movie-title" style="font-size: 0.8rem;">${item.title}</div>
                <div class="movie-subinfo" style="font-size: 0.65rem;">
                    <span>${item.year}</span>
                    <span style="text-transform: capitalize; color: var(--primary-gold);">${item.type || 'movie'}</span>
                </div>
            </div>
        </div>
    `).join('');
}

function selectPartyMedia(mediaId, type) {
    if (!partyState.isHost && !partyState.allowGuestControls) {
        showToast("Only the host can select or change what to watch!");
        return;
    }
    loadPartyMedia(mediaId, type, 1, 1, 1, true);
    showToast("Watch Party stream media updated!");
}

async function handlePartySearch(event) {
    const query = event.target.value.trim();
    if (query.length < 2) {
        renderPartyCatalogGrid(FEATURED_MOVIES);
        return;
    }
    
    // Reuse app.js search logic
    try {
        const results = await fetchLiveSearch(query);
        renderPartyCatalogGrid(results);
    } catch (e) {
        console.warn("Search inside Watch Party catalog explorer failed:", e);
        const localResults = FEATURED_MOVIES.filter(m => m.title.toLowerCase().includes(query.toLowerCase()));
        renderPartyCatalogGrid(localResults);
    }
}

async function filterPartyGenre(genre) {
    // Styling toggle
    const chips = document.querySelectorAll(".party-catalog-browser .genre-chip");
    chips.forEach(chip => {
        chip.classList.toggle("active", chip.innerText === genre || (genre === "All" && chip.innerText === "All"));
    });

    if (genre === "All") {
        renderPartyCatalogGrid(FEATURED_MOVIES);
        return;
    }

    try {
        // Anime case
        if (genre === "Animation") {
            const results = await fetchLiveTrendingSeries();
            const animeOnly = results.filter(s => s.genres && (s.genres.includes("Animation") || s.genres.includes("Anime")));
            renderPartyCatalogGrid(animeOnly.length > 0 ? animeOnly : results);
        } else {
            const results = await fetchLiveGenreMovies(genre);
            renderPartyCatalogGrid(results);
        }
    } catch (e) {
        const results = FEATURED_MOVIES.filter(m => m.genres && m.genres.includes(genre));
        renderPartyCatalogGrid(results);
    }
}

function startWatchPartyFromModal() {
    if (typeof Peer === "undefined") {
        showToast("WebRTC library loading, please try again in a second...");
        return;
    }
    if (!window.currentId) {
        showToast("Error: No movie selected");
        return;
    }
    const mediaId = window.currentId;
    const mediaType = window.currentType;
    const currentServerNum = window.currentServer || 1;
    
    // Close modal
    closePlayerModal();
    
    // Create code
    const code = generateRoomCode();
    
    if (partyState.syncMode === "firebase") {
        partyState.isHost = true;
        partyState.roomId = code;
        initFirebaseHost(code, mediaId, mediaType, currentServerNum);
        return;
    }
    
    if (typeof Peer === "undefined") {
        showToast("WebRTC library loading, please try again in a second...");
        return;
    }
    
    // Custom party creator logic to initialize with specific movie
    showLoader(true);
    partyState.isHost = true;
    partyState.roomId = code;
    
    partyState.peer = createPeerInstance(`wm-party-${code.replace(/-/g, "")}`);

    partyState.peer.on("open", (id) => {
        partyState.inParty = true;
        const myId = id;
        partyState.members[myId] = { ...localUser, isMuted: false, role: "Host" };
        
        switchToPartyView();
        document.getElementById("partyRoomCode").innerText = code;
        addSystemMessage("Watch Party created! Copy the link and share it with friends.");
        showLoader(false);
        
        // Load the movie from modal
        loadPartyMedia(mediaId, mediaType, currentServerNum, 1, 1, true);
    });

    // Reuse existing listener hooks
    partyState.peer.on("connection", (conn) => {
        setupHostConnection(conn);
    });
    partyState.peer.on("call", (call) => {
        if (partyState.isVoiceActive && partyState.localAudioStream) {
            call.answer(partyState.localAudioStream);
            setupVoiceCall(call);
        } else {
            call.answer();
        }
    });
    partyState.peer.on("error", (err) => {
        console.error("PeerJS Error", err);
        showLoader(false);
        if (err.type === "unavailable-id") {
            createWatchParty(generateRoomCode());
        } else {
            showToast(`Connection error: ${err.message}`);
        }
    });
}

// Join Party Modal Controls
function openJoinPartyModal() {
    const modal = document.getElementById("joinPartyModal");
    if (modal) {
        modal.classList.add("active");
        document.getElementById("joinRoomCode").value = "";
        document.getElementById("joinRoomCode").focus();
    }
}

function closeJoinPartyModal() {
    const modal = document.getElementById("joinPartyModal");
    if (modal) modal.classList.remove("active");
}

function submitJoinParty() {
    const codeInput = document.getElementById("joinRoomCode");
    if (!codeInput) return;
    let val = codeInput.value.trim();
    if (!val) {
        showToast("Please enter a valid room code or link!");
        return;
    }
    
    // Support pasting direct shared links
    if (val.includes("?party=")) {
        try {
            const urlParams = new URL(val).searchParams;
            val = urlParams.get("party") || val;
        } catch (e) {
            const parts = val.split("party=");
            val = parts[parts.length - 1];
        }
    } else if (val.includes("party=")) {
        const parts = val.split("party=");
        val = parts[parts.length - 1];
    }
    
    const roomCode = val.toUpperCase().trim();
    closeJoinPartyModal();
    showToast(`Joining room ${roomCode}...`);
    joinWatchParty(roomCode);
}

// Background Theme Changer
function changeThemeBg(bgHex, glowHex) {
    // Set root CSS variable values
    document.documentElement.style.setProperty("--bg-dark", bgHex);
    document.documentElement.style.setProperty("--bg-glow", glowHex);
    
    // Toggle active border selector style
    const opts = document.querySelectorAll(".theme-opt");
    opts.forEach(opt => {
        const optBg = opt.style.backgroundColor;
        // Compare values
        opt.classList.toggle("active", optBg === bgHex || rgbToHex(optBg) === bgHex);
    });
    
    showToast("Background theme color updated!");
}

// Permission controller for Host
function toggleGuestControlsPermission(allowed) {
    if (!partyState.isHost) return;
    
    partyState.allowGuestControls = allowed;
    
    // Relay updated permissions to all guests
    sendToParty({
        type: "permissionsUpdate",
        allowGuestControls: allowed
    });
    
    addSystemMessage(allowed ? "Host enabled playback controls for guests." : "Host locked guest playback controls.");
    showToast(allowed ? "Guests can now control the video" : "Guest playback controls disabled");
}

// Watchlist synchronization in watch party
function togglePartyWatchlist() {
    if (!partyState.activeMedia.id) {
        showToast("No active media to save!");
        return;
    }
    
    // Check if app.js watchlist array has item
    if (typeof watchlist === "undefined") {
        showToast("Watchlist feature not initialized yet");
        return;
    }
    
    const inWatchlist = watchlist.some(item => item.id.toString() === partyState.activeMedia.id.toString());
    const btn = document.getElementById("partyWatchlistBtn");
    
    if (inWatchlist) {
        removeFromWatchlist(partyState.activeMedia.id);
        if (btn) btn.innerText = "+ Save to Watchlist";
        showToast("Removed from Watchlist!");
    } else {
        addToWatchlist({
            id: partyState.activeMedia.id,
            title: partyState.activeMedia.title,
            type: partyState.activeMedia.type,
            poster: "9dff5f12-e1c4-4575-81f4-5184844ca983.png",
            rating: "8.5",
            year: new Date().getFullYear().toString()
        });
        if (btn) btn.innerText = "✓ Saved to Watchlist";
        showToast("Added to Watchlist!");
    }
}

// Share Modal controller functions
function openSharePartyModal() {
    if (!partyState.roomId) {
        showToast("Create or join a party first!");
        return;
    }
    
    const modal = document.getElementById("sharePartyModal");
    if (!modal) return;
    
    const inviteLink = `${window.location.origin}${window.location.pathname}?party=${partyState.roomId}`;
    
    // Update share inputs
    document.getElementById("sharePartyUrlText").innerText = inviteLink;
    
    // Update WhatsApp & Twitter share links
    const textMsg = encodeURIComponent(`Come watch ${partyState.activeMedia.title || "movies"} with me on WaveMirror! Join room: ${partyState.roomId}. Link: `);
    document.getElementById("shareWaBtn").href = `https://api.whatsapp.com/send?text=${textMsg}${encodeURIComponent(inviteLink)}`;
    document.getElementById("shareTwBtn").href = `https://twitter.com/intent/tweet?text=${textMsg}&url=${encodeURIComponent(inviteLink)}`;
    
    modal.classList.add("active");
}

function closeSharePartyModal() {
    const modal = document.getElementById("sharePartyModal");
    if (modal) modal.classList.remove("active");
}

function copyShareModalUrl() {
    const inviteLink = `${window.location.origin}${window.location.pathname}?party=${partyState.roomId}`;
    navigator.clipboard.writeText(inviteLink);
    showToast("Watch Party Link copied! 🔗");
}

// Synced HTML5 Video Player logic (Watchparty.me style)
let isSyncingVideoState = false;

function getYoutubeId(url) {
    if (!url) return null;
    try {
        if (url.includes("youtu.be/")) {
            const parts = url.split("youtu.be/");
            if (parts[1]) {
                const id = parts[1].split(/[?#]/)[0].trim();
                if (id.length === 11) return id;
            }
        }
        
        // Strip out brackets or enclosing characters if any
        url = url.trim().replace(/[<>]/g, "");
        const urlObj = new URL(url);
        if (urlObj.hostname.includes("youtube.com") || urlObj.hostname.includes("youtu.be")) {
            const v = urlObj.searchParams.get("v");
            if (v && v.trim().length === 11) return v.trim();
            
            const pathParts = urlObj.pathname.split("/");
            const embedIndex = pathParts.indexOf("embed");
            if (embedIndex !== -1 && pathParts[embedIndex + 1]) {
                const id = pathParts[embedIndex + 1].split(/[?#]/)[0].trim();
                if (id.length === 11) return id;
            }
            
            const vIndex = pathParts.indexOf("v");
            if (vIndex !== -1 && pathParts[vIndex + 1]) {
                const id = pathParts[vIndex + 1].split(/[?#]/)[0].trim();
                if (id.length === 11) return id;
            }
        }
    } catch (e) {
        console.warn("URL parsing failed for YouTube check, falling back to regex matcher...", e);
    }
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].trim().length === 11) ? match[2].trim() : null;
}

function loadCustomVideoUrl(triggerBroadcast = false) {
    const input = document.getElementById("partyCustomUrlInput");
    const video = document.getElementById("partyVideo");
    const iframe = document.getElementById("partyIframe");
    if (!input || !video || !iframe) return;

    const url = input.value.trim();
    if (!url) {
        showToast("Please enter a YouTube link or direct video URL!");
        return;
    }

    if (url === "screenshare") {
        // Display the video container and hide iframe to prepare for incoming WebRTC screenshare track
        iframe.style.display = "none";
        iframe.classList.add("hidden");
        if (video) {
            video.style.display = "block";
            video.classList.remove("hidden");
            video.src = "";
            video.srcObject = null;
        }
        
        partyState.activeMedia.id = "screenshare";
        partyState.activeMedia.type = "screenshare";
        partyState.activeMedia.title = "Host's Shared Screen";
        document.getElementById("partyMediaTitle").innerText = "Host's Shared Screen";
        document.getElementById("partyMediaMeta").innerText = "Live Screen Share";
        
        const prompt = document.getElementById("localFilePrompt");
        if (prompt) {
            prompt.style.display = "none";
            prompt.classList.add("hidden");
        }
        return;
    }

    // Automatically hide local file prompts when loading custom links
    const promptEl = document.getElementById("localFilePrompt");
    if (promptEl) {
        promptEl.style.display = "none";
        promptEl.classList.add("hidden");
    }

    const ytId = getYoutubeId(url);
    if (ytId) {
        // Toggle view: show iframe, hide native video player
        iframe.style.display = "block";
        iframe.classList.remove("hidden");
        video.style.display = "none";
        video.classList.add("hidden");
        video.pause();
        video.src = "";

        iframe.src = `https://www.youtube.com/embed/${ytId}?enablejsapi=1&autoplay=1&controls=1&rel=0`;

        partyState.activeMedia.id = ytId;
        partyState.activeMedia.type = "youtube";
        partyState.activeMedia.title = "YouTube Video Stream";
        document.getElementById("partyMediaTitle").innerText = "YouTube Video Stream";
        document.getElementById("partyMediaMeta").innerText = "YouTube Stream";

        // Setup YouTube Player bindings
        setupYoutubePlayer();

        addSystemMessage(`Loaded YouTube Video ID: ${ytId}`);
        showToast("YouTube video loaded!");

        if (triggerBroadcast) {
            sendToParty({
                type: "customUrlSync",
                url: url
            });
        }
    } else {
        // Switch back to standard native video element
        iframe.style.display = "none";
        iframe.classList.add("hidden");
        video.style.display = "block";
        video.classList.remove("hidden");

        video.src = url;
        video.load();

        partyState.activeMedia.id = "custom";
        partyState.activeMedia.type = "movie";
        partyState.activeMedia.title = "Custom Shared Video Stream";
        document.getElementById("partyMediaTitle").innerText = "Custom Shared Video Stream";
        document.getElementById("partyMediaMeta").innerText = "Custom HTML5 Stream";

        addSystemMessage(`Loaded custom video URL: ${url}`);
        showToast("Loaded custom video URL!");

        if (triggerBroadcast) {
            sendToParty({
                type: "customUrlSync",
                url: url
            });
        }
    }
}

function handleIncomingVideoSync(data) {
    const video = document.getElementById("partyVideo");
    if (!video) return;

    isSyncingVideoState = true;

    if (data.action === "play") {
        video.currentTime = data.time;
        video.play().catch(e => console.log("Play failed / blocked:", e));
    } else if (data.action === "pause") {
        video.currentTime = data.time;
        video.pause();
    } else if (data.action === "seek") {
        video.currentTime = data.time;
    } else if (data.action === "pingSync") {
        if (Math.abs(video.currentTime - data.time) > 1.5) {
            video.currentTime = data.time;
        }
        if (data.paused && !video.paused) {
            video.pause();
        } else if (!data.paused && video.paused) {
            video.play().catch(e => console.log("Play failed / blocked:", e));
        }
    }

    setTimeout(() => {
        isSyncingVideoState = false;
    }, 250);
}

function setupVideoSyncListeners() {
    const video = document.getElementById("partyVideo");
    if (!video) return;

    video.addEventListener("play", () => {
        if (isSyncingVideoState) return;
        if (partyState.isHost || partyState.allowGuestControls) {
            sendToParty({
                type: "videoSync",
                action: "play",
                time: video.currentTime
            });
        }
    });

    video.addEventListener("pause", () => {
        if (isSyncingVideoState) return;
        if (partyState.isHost || partyState.allowGuestControls) {
            sendToParty({
                type: "videoSync",
                action: "pause",
                time: video.currentTime
            });
        }
    });

    video.addEventListener("seeked", () => {
        if (isSyncingVideoState) return;
        if (partyState.isHost || partyState.allowGuestControls) {
            sendToParty({
                type: "videoSync",
                action: "seek",
                time: video.currentTime
            });
        }
    });
}

// Global periodic timer for Host status broadcast (every 4 seconds)
setInterval(() => {
    if (partyState.inParty && partyState.isHost && partyState.activeMedia.server === 5) {
        const video = document.getElementById("partyVideo");
        if (video && !video.paused && video.readyState >= 2) {
            sendToParty({
                type: "videoSync",
                action: "pingSync",
                time: video.currentTime,
                paused: video.paused
            });
        }
    }
}, 4000);

// Initialize on page load
document.addEventListener("DOMContentLoaded", () => {
    setupVideoSyncListeners();
});

// Synced Local File Player controllers (Watchparty.me style)
function handleLocalFileSelect(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    
    // Save metadata
    partyState.localFileName = file.name;
    partyState.localFileSize = file.size;
    
    // Convert to browser URL
    const objectURL = URL.createObjectURL(file);
    const video = document.getElementById("partyVideo");
    if (video) {
        video.src = objectURL;
        video.load();
        video.play().catch(e => console.log("Local autoplay blocked:", e));
    }
    
    // Update local header UI
    partyState.activeMedia.id = "local";
    partyState.activeMedia.title = `Local File: ${file.name}`;
    document.getElementById("partyMediaTitle").innerText = `Local File: ${file.name}`;
    document.getElementById("partyMediaMeta").innerText = `Local Stream • ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    
    addSystemMessage(`Loaded local file: ${file.name}`);
    showToast("Loaded local file successfully!");
    
    // Hide local file prompt overlay if host selected it
    const prompt = document.getElementById("localFilePrompt");
    if (prompt) prompt.style.display = "none";
    
    // Broadcast file sync to guests
    if (partyState.isHost) {
        sendToParty({
            type: "localFileSync",
            fileName: file.name,
            fileSize: file.size
        });
        
        // Stream the captured video/audio tracks directly to guests (WebRTC Video Broadcast)
        setTimeout(() => {
            broadcastVideoMediaStream();
        }, 800);
    }
}

function handleGuestLocalFileSelect(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    
    // Convert to browser URL
    const objectURL = URL.createObjectURL(file);
    const video = document.getElementById("partyVideo");
    if (video) {
        video.src = objectURL;
        video.load();
    }
    
    // Update guest header UI
    partyState.activeMedia.id = "local";
    partyState.activeMedia.title = `Local File: ${file.name}`;
    document.getElementById("partyMediaTitle").innerText = `Local File: ${file.name}`;
    document.getElementById("partyMediaMeta").innerText = `Local Stream • ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    
    addSystemMessage(`Loaded local copy: ${file.name}`);
    showToast("Loaded local copy!");
    
    // Hide guest prompt overlay
    const prompt = document.getElementById("localFilePrompt");
    if (prompt) prompt.style.display = "none";
    
    // Request current playhead position from host
    if (partyState.hostConn && partyState.hostConn.open) {
        partyState.hostConn.send({
            type: "requestHostSync"
        });
    }
}

// WebRTC Direct Video Stream Broadcast
function broadcastVideoMediaStream() {
    const video = document.getElementById("partyVideo");
    if (!video) return;
    
    let stream = null;
    try {
        // Capture stream from playing video element (standard modern API)
        stream = video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null);
    } catch (e) {
        console.error("Failed to capture video element stream", e);
    }
    
    if (!stream) {
        console.warn("Direct stream capture unsupported or blocked");
        return;
    }
    
    partyState.localVideoStream = stream;
    
    // Stream to all connected peers in real-time (WebRTC or Firebase mode members)
    const targets = new Set();
    Object.keys(partyState.peerConns).forEach(id => targets.add(id));
    if (partyState.members) {
        Object.values(partyState.members).forEach(m => {
            if (m.peerId && partyState.peer && m.peerId !== partyState.peer.id) {
                targets.add(m.peerId);
            }
        });
    }

    targets.forEach(peerId => {
        // Stop any old stream connection first
        if (partyState.peerCalls[`video-${peerId}`]) {
            partyState.peerCalls[`video-${peerId}`].close();
        }
        
        // Initiate connection call
        const call = partyState.peer.call(peerId, stream, {
            metadata: { type: "videoBroadcast" }
        });
        partyState.peerCalls[`video-${peerId}`] = call;
    });
    
    addSystemMessage("Video broadcast stream successfully initialized.");
    showToast("Broadcasting local video to members!");
}

// WebRTC Screen Sharing Broadcast functions
async function startScreenShareBroadcast() {
    if (!partyState.isHost && !partyState.allowGuestControls) {
        showToast("Only the host can start sharing their screen!");
        return;
    }
    
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always"
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true
            }
        });
        
        const video = document.getElementById("partyVideo");
        const iframe = document.getElementById("partyIframe");
        if (video) {
            video.srcObject = screenStream;
            video.style.display = "block";
            video.classList.remove("hidden");
            video.muted = true; // Host mutes local video to prevent audio loops
            video.play().catch(e => console.warn(e));
        }
        if (iframe) {
            iframe.style.display = "none";
            iframe.classList.add("hidden");
        }

        partyState.activeMedia.id = "screenshare";
        partyState.activeMedia.type = "screenshare";
        partyState.activeMedia.title = `${localUser.username}'s Screen`;
        document.getElementById("partyMediaTitle").innerText = `${localUser.username}'s Screen`;
        document.getElementById("partyMediaMeta").innerText = "Live Screen Share";

        // Keep local reference to stream
        partyState.localVideoStream = screenStream;

        // Auto clean up when browser screen share stopped
        screenStream.getVideoTracks()[0].onended = () => {
            stopScreenShareBroadcast();
        };

        // Broadcast to all guests
        broadcastScreenStream(screenStream);
        
        // Sync media state across Database/P2P
        if (partyState.isHost) {
            if (partyState.syncMode === "firebase") {
                partyState.dbRoomRef.child("activeMedia").set(partyState.activeMedia).catch(handleFirebaseWriteError);
                partyState.dbRoomRef.child("customUrl").set({
                    url: "screenshare",
                    timestamp: Date.now()
                }).catch(handleFirebaseWriteError);
            } else {
                sendToParty({
                    type: "mediaSync",
                    media: partyState.activeMedia
                });
                sendToParty({
                    type: "customUrlSync",
                    url: "screenshare"
                });
            }
        }

        showToast("Screen sharing started!");
        addSystemMessage("You are now sharing your screen.");

    } catch (err) {
        console.error("Screen share capture failed:", err);
        showToast("Screen sharing cancelled or permission denied.");
    }
}

function broadcastScreenStream(stream) {
    const targets = new Set();
    Object.keys(partyState.peerConns).forEach(id => targets.add(id));
    if (partyState.members) {
        Object.values(partyState.members).forEach(m => {
            if (m.peerId && partyState.peer && m.peerId !== partyState.peer.id) {
                targets.add(m.peerId);
            }
        });
    }

    targets.forEach(peerId => {
        if (partyState.peerCalls[`video-${peerId}`]) {
            try { partyState.peerCalls[`video-${peerId}`].close(); } catch(e) {}
        }
        const call = partyState.peer.call(peerId, stream, {
            metadata: { type: "videoBroadcast" }
        });
        partyState.peerCalls[`video-${peerId}`] = call;
    });
}

function stopScreenShareBroadcast() {
    if (partyState.localVideoStream) {
        partyState.localVideoStream.getTracks().forEach(track => track.stop());
        partyState.localVideoStream = null;
    }
    
    const video = document.getElementById("partyVideo");
    if (video) {
        video.srcObject = null;
        video.style.display = "none";
        video.classList.add("hidden");
    }
    
    // Fallback back to default movie catalog
    loadPartyMedia("693134", "movie", 1, 1, 1, true);
    showToast("Screen sharing stopped.");
    addSystemMessage("Screen sharing session ended.");
}

// YouTube Playback Synchronization Engine
let isSyncingYtState = false;

function setupYoutubePlayer() {
    const bindHelper = () => {
        if (typeof YT !== "undefined" && typeof YT.Player !== "undefined") {
            initializeYoutubePlayerBinding();
        } else {
            setTimeout(bindHelper, 200);
        }
    };

    // If YouTube iframe API script is not loaded, inject it
    if (typeof YT === "undefined" || typeof YT.Player === "undefined") {
        if (!document.getElementById("yt-iframe-api-script")) {
            const tag = document.createElement("script");
            tag.id = "yt-iframe-api-script";
            tag.src = "https://www.youtube.com/iframe_api";
            const firstScriptTag = document.getElementsByTagName("script")[0];
            if (firstScriptTag && firstScriptTag.parentNode) {
                firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
            } else {
                document.head.appendChild(tag);
            }
        }
    }
    
    // Bind directly using polling helper
    setTimeout(bindHelper, 100);
}

function initializeYoutubePlayerBinding() {
    if (partyState.ytPlayer) {
        try {
            partyState.ytPlayer.destroy();
        } catch (e) {
            console.warn("Error destroying previous YT player instance", e);
        }
    }
    
    // Bind to the partyIframe element and initialize video stream
    partyState.ytPlayer = new YT.Player("partyIframe", {
        videoId: partyState.activeMedia.id,
        playerVars: {
            autoplay: 1,
            controls: 1,
            rel: 0,
            enablejsapi: 1
        },
        events: {
            "onStateChange": onYoutubePlayerStateChange,
            "onReady": (event) => {
                try { event.target.playVideo(); } catch(e) {}
            }
        }
    });
}

function onYoutubePlayerStateChange(event) {
    if (isSyncingYtState) return;
    
    // Only capture state changes if allowed to control playback
    if (partyState.isHost || partyState.allowGuestControls) {
        if (event.data === YT.PlayerState.PLAYING) {
            sendToParty({
                type: "ytSync",
                action: "play",
                time: partyState.ytPlayer.getCurrentTime()
            });
        } else if (event.data === YT.PlayerState.PAUSED) {
            sendToParty({
                type: "ytSync",
                action: "pause",
                time: partyState.ytPlayer.getCurrentTime()
            });
        }
    }
}

function handleIncomingYtSync(data) {
    if (!partyState.ytPlayer || typeof partyState.ytPlayer.getPlayerState === "undefined") {
        // If YT API is still loading, retry in a moment
        setTimeout(() => handleIncomingYtSync(data), 200);
        return;
    }
    
    isSyncingYtState = true;
    
    if (data.action === "play") {
        partyState.ytPlayer.seekTo(data.time, true);
        partyState.ytPlayer.playVideo();
    } else if (data.action === "pause") {
        partyState.ytPlayer.seekTo(data.time, true);
        partyState.ytPlayer.pauseVideo();
    } else if (data.action === "pingSync") {
        const currTime = partyState.ytPlayer.getCurrentTime();
        if (Math.abs(currTime - data.time) > 1.8) {
            partyState.ytPlayer.seekTo(data.time, true);
        }
        
        const state = partyState.ytPlayer.getPlayerState();
        if (data.paused && state !== YT.PlayerState.PAUSED && state !== YT.PlayerState.ENDED) {
            partyState.ytPlayer.pauseVideo();
        } else if (!data.paused && state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.BUFFERING) {
            partyState.ytPlayer.playVideo();
        }
    }
    
    setTimeout(() => {
        isSyncingYtState = false;
    }, 300);
}

// Append a periodic YouTube sync check inside the global interval timer
setInterval(() => {
    if (partyState.inParty && partyState.isHost && partyState.activeMedia.type === "youtube") {
        if (partyState.ytPlayer && typeof partyState.ytPlayer.getPlayerState !== "undefined") {
            const state = partyState.ytPlayer.getPlayerState();
            sendToParty({
                type: "ytSync",
                action: "pingSync",
                time: partyState.ytPlayer.getCurrentTime(),
                paused: (state === YT.PlayerState.PAUSED || state === YT.PlayerState.ENDED)
            });
        }
    }
}, 4000);

// --- Firebase Real-time Database Synchronization Engine ---

async function initFirebaseHost(roomCode, initMediaId = null, initMediaType = null, initServer = null) {
    if (typeof firebase === "undefined") {
        showToast("Cloud Database API still loading, please wait...");
        return;
    }
    showLoader(true);
    partyState.roomId = roomCode.toUpperCase().trim();
    partyState.inParty = true;
    partyState.isHost = true;

    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(DEFAULT_FIREBASE_CONFIG);
        }
        partyState.db = firebase.database();
        partyState.dbRoomRef = partyState.db.ref(`rooms/${partyState.roomId}`);

        // Setup background PeerJS for WebRTC voice and streaming support
        if (typeof Peer !== "undefined") {
            partyState.peer = createPeerInstance(`wm-party-${partyState.roomId.replace(/-/g, "")}`);
            partyState.peer.on("open", (id) => {
                partyState.dbRoomRef.child("members/hostKey").update({ peerId: id });
            });
            partyState.peer.on("call", (call) => {
                const metadata = call.metadata || {};
                if (metadata.type === "voice") {
                    if (partyState.localAudioStream) {
                        call.answer(partyState.localAudioStream);
                    } else {
                        call.answer();
                    }
                    setupVoiceCall(call);
                }
            });
        }

        // Set initial room values
        await partyState.dbRoomRef.set({
            host: localUser.username,
            activeMedia: partyState.activeMedia,
            videoState: {
                action: "pause",
                time: 0,
                paused: true,
                timestamp: Date.now()
            },
            members: {
                hostKey: { ...localUser, role: "Host", isMuted: false }
            }
        });

        // Listen for new members
        partyState.dbRoomRef.child("members").on("child_added", (snapshot) => {
            const member = snapshot.val();
            if (member && member.username !== localUser.username) {
                addSystemMessage(`👋 ${member.username} joined via Cloud Database!`);
                partyState.members[snapshot.key] = member;
                renderMemberList();
            }
        });

        // Listen for member leaves/changes
        partyState.dbRoomRef.child("members").on("child_changed", (snapshot) => {
            const member = snapshot.val();
            if (member) {
                partyState.members[snapshot.key] = member;
                renderMemberList();
            }
        });

        partyState.dbRoomRef.child("members").on("child_removed", (snapshot) => {
            const member = snapshot.val();
            if (member) {
                addSystemMessage(`${member.username} left the party.`);
                delete partyState.members[snapshot.key];
                renderMemberList();
            }
        });

        switchToPartyView();
        document.getElementById("partyRoomCode").innerText = roomCode;
        addSystemMessage("Watch Party created on Cloud Database! Share the link to sync.");
        showLoader(false);

        // Load correct media
        if (initMediaId) {
            loadPartyMedia(initMediaId, initMediaType, initServer, 1, 1, true);
        } else {
            loadPartyMedia("693134", "movie", 1, 1, 1, true); // Dune 2
        }
    } catch (e) {
        console.error("Firebase Host Init Failed", e);
        showLoader(false);
        showToast("Firebase Cloud Database connection failed.");
    }
}

async function initFirebaseGuest(roomCode) {
    if (typeof firebase === "undefined") {
        showToast("Cloud Database API still loading, please wait...");
        return;
    }
    showLoader(true);
    partyState.roomId = roomCode.toUpperCase().trim();
    partyState.isHost = false;

    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(DEFAULT_FIREBASE_CONFIG);
        }
        partyState.db = firebase.database();
        partyState.dbRoomRef = partyState.db.ref(`rooms/${partyState.roomId}`);

        // Check if room exists
        const snapshot = await partyState.dbRoomRef.once("value");
        if (!snapshot.exists()) {
            showLoader(false);
            showToast("Watch Party room code not found on Cloud Database!");
            return;
        }

        partyState.inParty = true;

        // Listen to members
        partyState.dbRoomRef.child("members").on("value", (snap) => {
            const list = snap.val();
            if (list) {
                partyState.members = list;
                renderMemberList();
            }
        });

        // Add self
        const myKey = `guest_${Math.random().toString(36).substring(2, 8)}`;
        partyState.myGuestKey = myKey;
        await partyState.dbRoomRef.child(`members/${myKey}`).set({
            ...localUser,
            role: "Guest",
            isMuted: false
        });

        // Setup background PeerJS for WebRTC voice and streaming support
        if (typeof Peer !== "undefined") {
            partyState.peer = createPeerInstance();
            partyState.peer.on("open", (id) => {
                partyState.dbRoomRef.child(`members/${myKey}`).update({ peerId: id });
            });
            partyState.peer.on("call", (call) => {
                const metadata = call.metadata || {};
                if (metadata.type === "videoBroadcast") {
                    call.answer();
                    call.on("stream", (remoteStream) => {
                        const video = document.getElementById("partyVideo");
                        if (video) {
                            video.srcObject = remoteStream;
                            video.play().catch(e => console.log("Stream autoplay blocked:", e));
                            const prompt = document.getElementById("localFilePrompt");
                            if (prompt) prompt.style.display = "none";
                        }
                    });
                    return;
                }
                if (metadata.type === "voice") {
                    if (partyState.localAudioStream) {
                        call.answer(partyState.localAudioStream);
                    } else {
                        call.answer();
                    }
                    setupVoiceCall(call);
                }
            });
        }

        // Sync active media selection
        partyState.dbRoomRef.child("activeMedia").on("value", (snap) => {
            const media = snap.val();
            if (media) {
                const isDifferent = media.id !== partyState.activeMedia.id ||
                                    media.server !== partyState.activeMedia.server ||
                                    media.season !== partyState.activeMedia.season ||
                                    media.episode !== partyState.activeMedia.episode ||
                                    media.type !== partyState.activeMedia.type;
                if (isDifferent) {
                    loadPartyMedia(media.id, media.type, media.server, media.season, media.episode, false);
                }
            }
        });

        // Sync video playback state
        let lastVideoTimestamp = 0;
        partyState.dbRoomRef.child("videoState").on("value", (snap) => {
            const state = snap.val();
            if (state && state.timestamp > lastVideoTimestamp) {
                lastVideoTimestamp = state.timestamp;
                handleIncomingVideoSync({
                    action: state.action,
                    time: state.time,
                    paused: state.paused
                });
            }
        });

        // Sync custom URL loads
        let lastUrlTimestamp = 0;
        partyState.dbRoomRef.child("customUrl").on("value", (snap) => {
            const data = snap.val();
            if (data && data.timestamp > lastUrlTimestamp) {
                lastUrlTimestamp = data.timestamp;
                const customUrlInput = document.getElementById("partyCustomUrlInput");
                if (customUrlInput) {
                    customUrlInput.value = data.url;
                }
                loadCustomVideoUrl(false);
            }
        });

        // Sync local files picker overlay trigger
        let lastFileTimestamp = 0;
        partyState.dbRoomRef.child("localFile").on("value", (snap) => {
            const data = snap.val();
            if (data && data.timestamp > lastFileTimestamp) {
                lastFileTimestamp = data.timestamp;
                partyState.localFileName = data.fileName;
                partyState.localFileSize = data.fileSize;
                loadPartyMedia("custom", "movie", 5, 1, 1, false);
                const promptBox = document.getElementById("localFilePrompt");
                if (promptBox) {
                    promptBox.style.display = "flex";
                    promptBox.classList.remove("hidden");
                    document.getElementById("localFilePromptText").innerHTML = `Host is playing a local file:<br><strong>${data.fileName}</strong> (${(data.fileSize / 1024 / 1024).toFixed(1)} MB).<br>Select your local copy of this file to watch in perfect sync.`;
                }
            }
        });

        // Sync YouTube state
        let lastYtTimestamp = 0;
        partyState.dbRoomRef.child("ytState").on("value", (snap) => {
            const state = snap.val();
            if (state && state.timestamp > lastYtTimestamp) {
                lastYtTimestamp = state.timestamp;
                handleIncomingYtSync({
                    action: state.action,
                    time: state.time
                });
            }
        });

        // Sync Chat Messages
        partyState.dbRoomRef.child("chat").on("child_added", (snap) => {
            const msg = snap.val();
            if (msg && msg.username !== localUser.username) {
                appendPartyChatMessage(msg.username, msg.message, msg.color, msg.avatar);
            }
        });

        // On window close/unload, remove self from database
        window.addEventListener("beforeunload", exitFirebaseRoom);

        switchToPartyView();
        document.getElementById("partyRoomCode").innerText = roomCode;
        addSystemMessage("Connected to Watch Party via Cloud Database!");
        showLoader(false);
    } catch (e) {
        console.error("Firebase Guest Init Failed", e);
        showLoader(false);
        showToast("Firebase Cloud Database connection failed.");
    }
}

function exitFirebaseRoom() {
    if (partyState.syncMode === "firebase" && partyState.dbRoomRef) {
        if (partyState.isHost) {
            partyState.dbRoomRef.remove();
        } else if (partyState.myGuestKey) {
            partyState.dbRoomRef.child(`members/${partyState.myGuestKey}`).remove();
        }
        window.removeEventListener("beforeunload", exitFirebaseRoom);
        partyState.dbRoomRef = null;
    }
}

function handleFirebaseWriteError(err) {
    console.error("Firebase database write error:", err);
    if (err && err.message && err.message.includes("Permission denied")) {
        showToast("Database Permission Denied! Update your Firebase rules to read/write: true.");
    }
}
