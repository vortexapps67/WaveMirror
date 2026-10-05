/* ================================================================
   WAVEMIRROR 3D THEATRE - Scene
   ---------------------------------------------------------------
   Responsibilities:
     - build the auditorium (raked floor, walls, ceiling, screen,
       curtains, instanced seats, cafe counter)
     - drive a constrained first-person camera (walk + look)
     - project the video onto the screen via VideoTexture
     - own the render loop, including pausing when not visible

   Where to change things:
     - VIDEO SOURCE   -> resolveVideoSource() at the bottom, plus the
                         SERVER list in theatre-screen.js
     - SEAT LAYOUT    -> SEAT_LAYOUT below, and cafe in _buildCafe().
     - QUALITY TIERS  -> pickQualityTier().
     - REALTIME       -> theatre-party.js, not this file.
   ================================================================ */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ScreenSurface, SERVERS, embedUrlFor } from "./theatre-screen.js";

/* ---------------------------------------------------------------
   SEAT LAYOUT
   Two lettered rows of five wide recliners: A on the main floor, B
   on a raised platform so the back row has a clean sightline over the
   front. Seats are addressed as A1..A5 / B1..B5.
   Adding a row = adding an entry. Spacing and elevation are metres.
   --------------------------------------------------------------- */
const SEAT_LAYOUT = {
    rows: [
        { id: "A", label: "main floor",     z: -0.5,  y: 0.0, seats: 5, spacing: 1.2 },
        { id: "B", label: "raised platform",z: 2.0,  y: 0.5, seats: 5, spacing: 1.2 }
    ]
};

/* Every seat, addressed by its label. Built once so the UI, the
   camera and the party all agree on what "B3" means. */
const SEATS = SEAT_LAYOUT.rows.flatMap((row, ri) =>
    Array.from({ length: row.seats }, (_, i) => ({
        id: `${row.id}${i + 1}`,
        row: row.id,
        rowLabel: row.label,
        number: i + 1,
        x: (i - (row.seats - 1) / 2) * row.spacing,
        y: row.y,
        z: row.z,
        rowIndex: ri
    }))
);

/* Curated copy for the seat picker, so choosing a seat tells you
   something instead of just moving you. New seat ids need an entry
   here or the picker will show an empty blurb. */
const SEAT_NOTES = {
    A1: "Front left corner. An angle on the left third.",
    A2: "Front row, left of centre.",
    A3: "Front row, left of centre.",
    A4: "Dead centre. A classic choice.",
    A5: "Front row, right of centre.",
    B1: "Middle row, far left.",
    B2: "Middle row, left of centre.",
    B3: "Middle row, left of centre.",
    B4: "Middle row, dead centre.",
    B5: "Middle row, right of centre."
};

/* Room envelope, metres. */
const ROOM = {
    width: 12.92,       // x extent, walls at +/-6.46
    frontZ: -7.38,      // screen wall
    backZ: 7.38,        // rear entrance wall
    ceiling: 5.6,
    screenW: 7.8,
    screenH: 4.3875,    // 16:9
    screenY: 2.6,
    stageZ: -6.4        // front edge of the stage platform
};

const EYE_HEIGHT = 1.66;    // standing eye level
const SEATED_EYE = 1.18;   // drop into a recliner
const WALK_SPEED = 2.5;    // m/s - a cinema aisle, not a corridor
const RUN_MULT = 1.7;

/* Colour palette, pulled from the site tokens so the theatre matches. */
const C = {
    wall: 0x14151b,
    wallDeep: 0x0c0d12,
    ceiling: 0x0a0b0f,
    floor: 0x1b1a20,
    carpet: 0x2a1418,
    seat: 0x6d1418,
    seatAlt: 0x4a1013,
    curtain: 0x511016,
    curtainDeep: 0x2c080c,
    screenFrame: 0x05050a,
    brass: 0xc9a227,
    wood: 0x3a2a1e,
    woodDark: 0x241a12,
    cafe: 0x1a1512,
    counter: 0x2b2018,
    neon: 0x6366f1
};

function pickQualityTier() {
    const px = window.innerWidth * window.innerHeight;
    const mem = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (coarse || mem <= 2 || cores <= 2) return "low";
    if (px > 4_500_000 && cores <= 4) return "mid";
    return "high";
}

export class TheatreScene {
    constructor(canvas, opts = {}) {
        this.canvas = canvas;
        this.tier = opts.tier || pickQualityTier();
        this.onVideoEvent = opts.onVideoEvent || (() => {});
        this.onProgress = opts.onProgress || (() => {});

        this.disposed = false;
        this.running = false;
        this.clock = new THREE.Clock();

        /* Walk state */
        this.yaw = 0;
        this.pitch = 0;
        this.targetYaw = 0;
        this.targetPitch = 0;
        /* You arrive at the rear entrance, facing the screen. */
        this.position = new THREE.Vector3(0, EYE_HEIGHT, ROOM.backZ - 2.4);
        this.entrance = new THREE.Vector3(0, EYE_HEIGHT, ROOM.backZ - 2.4);
        this.velocity = new THREE.Vector3();
        this.keys = new Set();
        this.dragging = false;
        this.moveVec = new THREE.Vector2();   // touch joystick

        this._initRenderer();
        this._initScene();
        this._buildRoom();
        this._buildScreen();
        this._buildSeats();
        this._buildCafe();
        this._buildLighting();
        this._initVideo(opts.src || "");
        this._bindInput();
        this._onResize = () => this.resize();
        window.addEventListener("resize", this._onResize);
        this.resize();
    }

    /* ---------------- renderer / scene ---------------- */

    _initRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: this.tier === "high",
            powerPreference: "high-performance",
            alpha: false
        });
        const dpr = this.tier === "high" ? 2 : this.tier === "mid" ? 1.5 : 1;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dpr));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.shadowMap.enabled = this.tier === "high";
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
    }

    _initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x030305);
        this.scene.fog = new THREE.Fog(0x05050a, 16, 42);

        this.camera = new THREE.PerspectiveCamera(
            this.tier === "low" ? 68 : 62,
            1, 0.1, 140
        );
        this.camera.position.copy(this.position);
    }

    /* ---------------- geometry ---------------- */

    _buildRoom() {
        const group = new THREE.Group();
        group.name = "room";

        const halfW = ROOM.width / 2;
        const depth = ROOM.backZ - ROOM.frontZ;

        /* Floor: raked plane. Vertices are displaced by the same function
           the walker uses, so the camera never floats or sinks. */
        const floorGeo = new THREE.PlaneGeometry(ROOM.width, depth, 24, 64);
        floorGeo.rotateX(-Math.PI / 2);
        const pos = floorGeo.attributes.position;
        const halfDepth = depth / 2;
        for (let i = 0; i < pos.count; i++) {
            const z = pos.getZ(i);
            const worldZ = z + (ROOM.backZ + ROOM.frontZ) / 2;
            pos.setY(i, this._floorHeight(worldZ));
        }
        floorGeo.computeVertexNormals();
        const floor = new THREE.Mesh(
            floorGeo,
            new THREE.MeshStandardMaterial({ color: C.floor, roughness: 0.94, metalness: 0.02 })
        );
        floor.position.z = (ROOM.backZ + ROOM.frontZ) / 2;
        floor.receiveShadow = this.tier === "high";
        group.add(floor);

        /* Carpet runner down the centre aisle and one per side aisle. */
        const runnerMat = new THREE.MeshStandardMaterial({ color: C.carpet, roughness: 0.99 });
        for (const x of [0, -halfW + 1.5, halfW - 1.5]) {
            const w = x === 0 ? 2.6 : 1.5;
            const rGeo = new THREE.PlaneGeometry(w, depth, 1, 48);
            rGeo.rotateX(-Math.PI / 2);
            const rp = rGeo.attributes.position;
            for (let i = 0; i < rp.count; i++) {
                const worldZ = rp.getZ(i) + (ROOM.backZ + ROOM.frontZ) / 2;
                rp.setY(i, this._floorHeight(worldZ) + 0.012);
            }
            rGeo.computeVertexNormals();
            const runner = new THREE.Mesh(rGeo, runnerMat);
            runner.position.set(x, 0, (ROOM.backZ + ROOM.frontZ) / 2);
            group.add(runner);
        }

        /* Side walls with acoustic panel rhythm. */
        const wallMat = new THREE.MeshStandardMaterial({ color: C.wall, roughness: 0.92, side: THREE.DoubleSide });
        for (const sx of [-1, 1]) {
            const wall = new THREE.Mesh(new THREE.PlaneGeometry(depth, ROOM.ceiling), wallMat);
            wall.rotation.y = sx * -Math.PI / 2;
            wall.position.set(sx * halfW, ROOM.ceiling / 2, (ROOM.backZ + ROOM.frontZ) / 2);
            group.add(wall);

            /* Vertical acoustic battens - cheap depth without textures. */
            const battenCount = this.tier === "low" ? 10 : 26;
            const battenGeo = new THREE.BoxGeometry(0.16, ROOM.ceiling * 0.82, 0.1);
            const battenMat = new THREE.MeshStandardMaterial({ color: C.wallDeep, roughness: 0.95 });
            const battens = new THREE.InstancedMesh(battenGeo, battenMat, battenCount);
            const m = new THREE.Matrix4();
            for (let i = 0; i < battenCount; i++) {
                const t = (i + 0.5) / battenCount;
                const z = ROOM.frontZ + 1 + t * (depth - 2);
                m.makeTranslation(sx * (halfW - 0.08), ROOM.ceiling * 0.48, z);
                battens.setMatrixAt(i, m);
            }
            battens.instanceMatrix.needsUpdate = true;
            group.add(battens);
        }

        /* Ceiling with coffered beams. */
        const ceiling = new THREE.Mesh(
            new THREE.PlaneGeometry(ROOM.width, depth),
            new THREE.MeshStandardMaterial({ color: C.ceiling, roughness: 1 })
        );
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.set(0, ROOM.ceiling, (ROOM.backZ + ROOM.frontZ) / 2);
        group.add(ceiling);

        const beamCount = this.tier === "low" ? 8 : 18;
        const beamGeo = new THREE.BoxGeometry(ROOM.width, 0.34, 0.4);
        const beamMat = new THREE.MeshStandardMaterial({ color: C.wallDeep, roughness: 1 });
        const beams = new THREE.InstancedMesh(beamGeo, beamMat, beamCount);
        const bm = new THREE.Matrix4();
        for (let i = 0; i < beamCount; i++) {
            const z = ROOM.frontZ + 1.5 + (i / (beamCount - 1)) * (depth - 3);
            bm.makeTranslation(0, ROOM.ceiling - 0.2, z);
            beams.setMatrixAt(i, bm);
        }
        beams.instanceMatrix.needsUpdate = true;
        group.add(beams);

        /* Back wall behind the cafe. */
        const back = new THREE.Mesh(
            new THREE.PlaneGeometry(ROOM.width, ROOM.ceiling),
            new THREE.MeshStandardMaterial({ color: C.wallDeep, roughness: 0.95 })
        );
        back.position.set(0, ROOM.ceiling / 2, ROOM.backZ);
        back.rotation.y = Math.PI;
        group.add(back);

        /* Stage platform under the screen. */
        const stageDepth = ROOM.frontZ - ROOM.stageZ;
        const stage = new THREE.Mesh(
            new THREE.BoxGeometry(ROOM.width * 0.8, 0.55, stageDepth),
            new THREE.MeshStandardMaterial({ color: C.woodDark, roughness: 0.85 })
        );
        stage.position.set(0, 0.275, ROOM.stageZ + stageDepth / 2);
        stage.receiveShadow = this.tier === "high";
        group.add(stage);

        /* Stage apron trim in brass. */
        const trim = new THREE.Mesh(
            new THREE.BoxGeometry(ROOM.width * 0.8, 0.06, 0.1),
            new THREE.MeshStandardMaterial({ color: C.brass, roughness: 0.35, metalness: 0.85 })
        );
        trim.position.set(0, 0.58, ROOM.stageZ + 0.05);
        group.add(trim);

        this.scene.add(group);
    }

    /* Curtains: pleated cylinders either side of the screen plus a valance. */
    _buildCurtains() {
        const group = new THREE.Group();
        const screenTop = ROOM.screenY + ROOM.screenH / 2;
        const pleats = this.tier === "low" ? 8 : 16;

        const makeDrape = (width, height, color) => {
            const geo = new THREE.CylinderGeometry(width * 0.5, width * 0.56, height, pleats, 1, true, 0, Math.PI);
            const mat = new THREE.MeshStandardMaterial({
                color, roughness: 0.96, metalness: 0.0, side: THREE.DoubleSide
            });
            return new THREE.Mesh(geo, mat);
        };

        const curtainW = 3.2;
        const curtainH = screenTop + 0.5;
        for (const sx of [-1, 1]) {
            const d = makeDrape(curtainW, curtainH, C.curtain);
            d.position.set(sx * (ROOM.screenW / 2 + curtainW * 0.42), curtainH / 2, ROOM.frontZ + 0.85);
            d.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
            group.add(d);
        }

        /* Valance across the top. */
        const valance = new THREE.Mesh(
            new THREE.BoxGeometry(ROOM.screenW + curtainW * 2, 1.1, 0.5),
            new THREE.MeshStandardMaterial({ color: C.curtainDeep, roughness: 0.97 })
        );
        valance.position.set(0, screenTop + 0.55, ROOM.frontZ + 0.7);
        group.add(valance);

        this.scene.add(group);
    }

    _buildScreen() {
        this._buildCurtains();

        /* Bezel. */
        const bezel = new THREE.Mesh(
            new THREE.BoxGeometry(ROOM.screenW + 0.5, ROOM.screenH + 0.5, 0.28),
            new THREE.MeshStandardMaterial({ color: C.screenFrame, roughness: 0.55, metalness: 0.3 })
        );
        bezel.position.set(0, ROOM.screenY, ROOM.frontZ + 0.45);
        this.scene.add(bezel);

        /* The actual screen surface. VideoTexture is assigned in _initVideo. */
        this.screenMaterial = new THREE.MeshStandardMaterial({
            color: 0x0a0a10,
            roughness: 0.62,
            metalness: 0.0,
            emissive: 0xffffff,
            emissiveIntensity: 0.0
        });
        this.screen = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.screenW, ROOM.screenH), this.screenMaterial);
        this.screen.position.set(0, ROOM.screenY, ROOM.frontZ + 0.6);
        this.scene.add(this.screen);

        /* Poster plane, revealed when there is no playable video. */
        this.posterMaterial = new THREE.MeshBasicMaterial({
            transparent: true, opacity: 0, depthWrite: false
        });
        this.poster = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.screenW, ROOM.screenH), this.posterMaterial);
        this.poster.position.set(0, ROOM.screenY, ROOM.frontZ + 0.62);
        this.scene.add(this.poster);
    }

    _buildSeats() {
        /* One seat = base + back + two arms, merged so the whole row set
           is a single InstancedMesh draw call. */
        const base = new THREE.BoxGeometry(0.62, 0.12, 0.52);
        const backRest = new THREE.BoxGeometry(0.62, 0.7, 0.12);
        const armL = new THREE.BoxGeometry(0.09, 0.1, 0.5);
        const armR = armL.clone();

        /* The seat faces the screen, which is down -z. The backrest goes on
           the +z side so an audience member's shoulders are behind them. */
        const merged = mergeGeometries([
            base.translate(0, 0.44, 0),
            backRest.translate(0, 0.84, 0.22),
            armL.translate(-0.33, 0.54, 0),
            armR.translate(0.33, 0.54, 0)
        ], false);

        const total = SEATS.length;

        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.05 });
        this.seats = new THREE.InstancedMesh(merged, mat, total);
        this.seats.castShadow = this.tier === "high";
        this.seats.receiveShadow = this.tier === "high";
        this.seats.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3);

        /* Seat anchors let us teleport the camera to a real seat. */
        this.seatAnchors = [];

        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const s = new THREE.Vector3(1, 1, 1);
        const col = new THREE.Color();
        const p = new THREE.Vector3();

        SEATS.forEach((seat, i) => {
            m.compose(p.set(seat.x, seat.y, seat.z), q, s);
            this.seats.setMatrixAt(i, m);
            /* Alternate rows a shade darker so the rake reads. */
            col.setHex(seat.rowIndex % 2 === 0 ? C.seat : C.seatAlt);
            this.seats.setColorAt(i, col);
            this.seatAnchors.push(new THREE.Vector3(seat.x, seat.y, seat.z));
        });
        this.seats.instanceMatrix.needsUpdate = true;
        if (this.seats.instanceColor) this.seats.instanceColor.needsUpdate = true;
        this.scene.add(this.seats);

        /* Row-end standards with a small warm lamp, repeating the rhythm. */
        const lampMat = new THREE.MeshStandardMaterial({
            color: 0xffd9a0, emissive: 0xffb347, emissiveIntensity: 1.4, roughness: 0.6
        });
        const postGeo = new THREE.CylinderGeometry(0.05, 0.07, 1.1, 8);
        const postMat = new THREE.MeshStandardMaterial({ color: C.brass, roughness: 0.4, metalness: 0.8 });
        const lampGeo = new THREE.SphereGeometry(0.13, 10, 8);
        for (const row of SEAT_LAYOUT.rows) {
            const span = (row.seats - 1) * row.spacing;
            for (const sx of [-1, 1]) {
                const post = new THREE.Mesh(postGeo, postMat);
                post.position.set(sx * (span / 2 + 0.9), row.y + 0.55, row.z);
                this.scene.add(post);
                const lamp = new THREE.Mesh(lampGeo, lampMat);
                lamp.position.set(sx * (span / 2 + 0.9), row.y + 1.16, row.z);
                this.scene.add(lamp);
            }
        }
    }

    /* ---------------- cafe ----------------
       A small concession counter at the back of the auditorium: counter,
       stools, two tables, pendant lamps and a neon sign. Kept low-poly so
       it costs nothing to render. To change it, edit this method only. */
    _buildCafe() {
        const group = new THREE.Group();
        group.name = "cafe";
        /* The counter sits hard against the rear wall, behind row B, so the
           auditorium itself stays clear. */
        const zc = ROOM.backZ - 1.35;

        const woodMat = new THREE.MeshStandardMaterial({ color: C.wood, roughness: 0.72 });
        const darkMat = new THREE.MeshStandardMaterial({ color: C.woodDark, roughness: 0.8 });
        const topMat = new THREE.MeshStandardMaterial({ color: C.counter, roughness: 0.35, metalness: 0.12 });

        /* Counter body + top. */
        const body = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.05, 0.62), woodMat);
        body.position.set(0, 0.52, zc);
        group.add(body);
        const top = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.09, 0.78), topMat);
        top.position.set(0, 1.09, zc);
        group.add(top);

        /* Brass foot rail. */
        const rail = new THREE.Mesh(
            new THREE.CylinderGeometry(0.035, 0.035, 5.2, 8),
            new THREE.MeshStandardMaterial({ color: C.brass, roughness: 0.3, metalness: 0.9 })
        );
        rail.rotation.z = Math.PI / 2;
        rail.position.set(0, 0.24, zc - 0.55);
        group.add(rail);

        /* Espresso machine + grinder, so the counter reads as a cafe. */
        const machine = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.5, 0.4), topMat);
        machine.position.set(-1.6, 1.38, zc);
        group.add(machine);
        const machineLight = new THREE.Mesh(
            new THREE.BoxGeometry(0.68, 0.05, 0.04),
            new THREE.MeshStandardMaterial({ color: 0xffe0b0, emissive: 0xffb347, emissiveIntensity: 2 })
        );
        machineLight.position.set(-1.6, 1.53, zc - 0.21);
        group.add(machineLight);
        const grinder = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.56, 10), darkMat);
        grinder.position.set(-0.65, 1.37, zc);
        group.add(grinder);

        /* Back bar shelving with cups. */
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.07, 0.28), darkMat);
        shelf.position.set(0, 1.85, zc + 0.24);
        group.add(shelf);
        const cupGeo = new THREE.CylinderGeometry(0.05, 0.04, 0.09, 8);
        const cupMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.7 });
        const cups = new THREE.InstancedMesh(cupGeo, cupMat, 20);
        const cm = new THREE.Matrix4();
        for (let i = 0; i < 20; i++) {
            cm.makeTranslation(-2.2 + (i % 10) * 0.48, 1.94, zc + 0.24);
            cups.setMatrixAt(i, cm);
        }
        cups.instanceMatrix.needsUpdate = true;
        group.add(cups);

        /* Stools along the counter. */
        const stoolSeat = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.08, 12), darkMat);
        const stoolStem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.72, 8), topMat);
        for (let i = 0; i < 5; i++) {
            const x = -2.2 + i * 1.1;
            const st = stoolSeat.clone();
            st.position.set(x, 0.78, zc - 0.82);
            group.add(st);
            const st2 = stoolStem.clone();
            st2.position.set(x, 0.37, zc - 0.82);
            group.add(st2);
        }

        /* Two small tables, tucked into the back corners. */
        for (const tx of [-4.6, 4.6]) {
            const tt = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 16), woodMat);
            tt.position.set(tx, 0.78, zc - 1.0);
            group.add(tt);
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.76, 10), topMat);
            leg.position.set(tx, 0.38, zc - 1.0);
            group.add(leg);
            /* A cup on each table. */
            const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.09, 8), cupMat);
            cup.position.set(tx + 0.14, 0.85, zc - 1.07);
            group.add(cup);
        }

        /* Pendant lamps over the counter. */
        const shadeGeo = new THREE.ConeGeometry(0.28, 0.3, 12, 1, true);
        const shadeMat = new THREE.MeshStandardMaterial({ color: C.brass, roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide });
        const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffc46b, emissiveIntensity: 2.6 });
        const cordMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 1 });
        for (const px of [-2.0, 0, 2.0]) {
            const shade = new THREE.Mesh(shadeGeo, shadeMat);
            shade.position.set(px, 2.5, zc - 0.25);
            group.add(shade);
            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), bulbMat);
            bulb.position.set(px, 2.39, zc - 0.25);
            group.add(bulb);
            const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.85, 5), cordMat);
            cord.position.set(px, 3.0, zc - 0.25);
            group.add(cord);
            const lamp = new THREE.PointLight(0xffb347, 6, 7, 2);
            lamp.position.set(px, 2.34, zc - 0.25);
            group.add(lamp);
        }

        /* Neon sign on the back wall. */
        const neonMat = new THREE.MeshBasicMaterial({ color: C.neon, transparent: true, opacity: 0.9 });
        const neon = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.055, 8, 40), neonMat);
        neon.position.set(0, 3.4, ROOM.backZ - 0.12);
        group.add(neon);
        const cafeSign = new THREE.Mesh(
            new THREE.BoxGeometry(2.0, 0.4, 0.06),
            new THREE.MeshStandardMaterial({ color: 0x14151b, roughness: 0.8 })
        );
        cafeSign.position.set(0, 3.4, ROOM.backZ - 0.16);
        group.add(cafeSign);
        const cafeGlow = new THREE.PointLight(C.neon, 5, 8, 2);
        cafeGlow.position.set(0, 3.4, ROOM.backZ - 1.0);
        group.add(cafeGlow);

        this.scene.add(group);
        this.cafeAnchor = new THREE.Vector3(0, 0, zc - 2.6);
    }

    /* A minimal 3D audience character. The body is a capsule, the head a
       sphere, and the head wears a little cap so you can tell yourself from
       an empty seat. It follows the walker and bobs when you walk. */
    _buildAvatar() {
        const g = new THREE.Group();

        const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd2691e, roughness: 0.85 });
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.62, 4, 8), bodyMat);
        body.position.y = 0.5;
        g.add(body);

        const headMat = new THREE.MeshStandardMaterial({ color: 0xf2c8a8, roughness: 0.75 });
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), headMat);
        head.position.y = 1.02;
        g.add(head);

        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.07, 10), new THREE.MeshStandardMaterial({ color: 0x1d2235, roughness: 0.6 }));
        cap.position.y = 1.13;
        g.add(cap);

        /* Glow ring under your feet so you can find yourself in the dark. */
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.14, 0.2, 16),
            new THREE.MeshBasicMaterial({ color: 0xf28b4a, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.012;
        g.add(ring);

        this.avatar = g;
        this._avatarBob = 0;
        this.scene.add(g);
    }

    _buildLighting() {
        /* Very low ambient: a cinema is dark, the screen does the work. */
        this.ambient = new THREE.AmbientLight(0x2a2c3a, 0.5);
        this.scene.add(this.ambient);

        /* A simple low-poly stand-in for the audience member. It is a small
           capsule with a head, centred where you stand; you see its head and
           shoulders when you look down, and it bobs when you walk. */
        this._buildAvatar();

        /* Screen wash. Two spotlights fanning into the room, kept dim so
           faces are lit by the film, which is what sells the illusion. */
        this.screenWash = new THREE.SpotLight(0xbcd0ff, 26, 34, Math.PI / 3.2, 0.7, 1.6);
        this.screenWash.position.set(0, ROOM.screenY, ROOM.frontZ + 1.0);
        this.screenWash.target.position.set(0, 1.2, 5);
        this.scene.add(this.screenWash);
        this.scene.add(this.screenWash.target);

        this.fill = new THREE.PointLight(0x6b7cff, 5, 22, 2);
        this.fill.position.set(0, 3.4, 2);
        this.scene.add(this.fill);

        /* House lights, off by default - you enter a dark auditorium. */
        this.houseLights = new THREE.Group();
        for (const z of [-5, -1, 3, 6]) {
            const l = new THREE.PointLight(0xffd9b0, 0, 12, 2);
            l.position.set(0, ROOM.ceiling - 0.9, z);
            this.houseLights.add(l);
        }
        this.scene.add(this.houseLights);
    }

    /* Dim the room when seated; restored whenever you stand up or reset. */
    setDim(on) {
        this._dim = !!on;
        this.ambient.intensity = on ? 0.14 : 0.5;
        this.fill.intensity = on ? 1.4 : 5;
        this.screenWash.intensity = on ? 34 : 26;
        if (on) {
            this._houseOn = false;
            this.houseLights.children.forEach(l => l.intensity = 0);
        }
    }

    /* Telephoto zoom as the audience's screen zoom. */
    setScreenZoom(on) {
        this._zoom = !!on;
        const base = this.tier === "low" ? 68 : 62;
        this.camera.fov = on ? base - 14 : base;
        this.camera.updateProjectionMatrix();
    }

    /* Performance mode favours a high frame rate over crisp shadows and a
       high pixel ratio, which is where the FPS actually goes. */
    setPerformanceMode(on) {
        this.performanceMode = !!on;
        const dpr = this.tier === "high" ? 2 : this.tier === "mid" ? 1.5 : 1;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, on ? 1 : dpr));
        try { this.renderer.shadowMap.enabled = !on; } catch (e) {}
        this.seats.castShadow = !on && this.tier === "high";
        /* Shadow map toggle needs materials to recompile. */
        this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    }

    /* ---------------- video ----------------
       Two mutually exclusive surfaces own the screen:
         - the WebGL mesh + VideoTexture, for sources we hold directly
           (a local file, or a plain https video link)
         - a CSS3D quad carrying a cross-origin <iframe>, for catalogue
           embeds, which no amount of CORS can turn into a texture
       See theatre-screen.js for why. ScreenSurface hides whichever
       surface is not in use. */

    _initVideo(src) {
        /* Built after _buildScreen so the anchor mesh exists. */
        this.surface = new ScreenSurface({
            anchor: this.screen,
            worldWidth: ROOM.screenW,
            worldHeight: ROOM.screenH,
            parentScene: this.scene,
            parentCamera: this.camera,
            host: document.body,
            onStatus: (s) => this.onVideoEvent(Object.assign(this.snapshot(), { providerStatus: s }))
        });
        this.surface.listenForProviderErrors();

        const video = document.createElement("video");
        video.crossOrigin = "anonymous";
        video.playsInline = true;
        video.preload = "auto";
        video.loop = false;
        /* Kept out of the layout flow; the texture is what you see. */
        video.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px;";
        document.body.appendChild(video);
        this.video = video;

        this.videoTexture = new THREE.VideoTexture(video);
        /* Video textures are non-power-of-two in practice; mipmaps break. */
        this.videoTexture.minFilter = THREE.LinearFilter;
        this.videoTexture.magFilter = THREE.LinearFilter;
        this.videoTexture.generateMipmaps = false;
        this.videoTexture.colorSpace = THREE.SRGBColorSpace;
        this.screenMaterial.map = this.videoTexture;
        this.screenMaterial.emissiveMap = this.videoTexture;
        this.screenMaterial.emissive = new THREE.Color(0xffffff);
        this.screenMaterial.emissiveIntensity = 0;
        this.screenMaterial.needsUpdate = true;

        ["play", "pause", "ended", "timeupdate", "durationchange", "volumechange", "waiting", "canplay", "loadeddata", "error"]
            .forEach(ev => video.addEventListener(ev, () => this.onVideoEvent(this.snapshot())));

        if (src) this.setSource(src);
    }

    /* Direct media we own: goes on the WebGL screen as a texture. */
    setSource(src) {
        if (!src) return;
        this.surface.clearEmbed();
        this.surface.setMode("texture");
        this.video.src = src;
        this.video.load();
        this.hasVideo = true;
        this.onVideoEvent(this.snapshot());
    }

    /* A catalogue pick: goes on the CSS3D quad as a real iframe, because
       an <iframe> cannot be a VideoTexture. */
    setEmbed(media) {
        this.video.pause();
        this.hasVideo = false;
        const ok = this.surface.showEmbed(media);
        if (ok) {
            this.posterMaterial.opacity = 0;
            this.onVideoEvent(Object.assign(this.snapshot(), { providerStatus: "opening" }));
        }
        return ok;
    }

    /* Move the same title to a different provider server. */
    useServer(serverKey, media) {
        const ok = this.surface.useServer(serverKey, media);
        if (ok) this.onVideoEvent(Object.assign(this.snapshot(), { providerStatus: "opening" }));
        return ok;
    }

    reloadSource() { this.surface.reload(); }

    setPoster(url) {
        if (!url) return;
        if (!this.posterTexture) {
            this.posterTexture = new THREE.TextureLoader();
            this.posterTexture.crossOrigin = "anonymous";
        }
        this.posterTexture.load(url, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            this.posterMaterial.map = tex;
            this.posterMaterial.opacity = 1;
            this.posterMaterial.needsUpdate = true;
        }, undefined, () => { /* poster missing is not fatal */ });
    }

    /* A quiet idle frame so the screen is never pure black before playback. */
    _idleGlow() {
        if (!this.idleTexture) {
            const c = document.createElement("canvas");
            c.width = 64; c.height = 36;
            const ctx = c.getContext("2d");
            const g = ctx.createLinearGradient(0, 0, 0, 36);
            g.addColorStop(0, "#101218");
            g.addColorStop(1, "#05060a");
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 64, 36);
            ctx.fillStyle = "rgba(255,255,255,0.06)";
            ctx.font = "9px sans-serif";
            ctx.fillText("WAVEMIRROR", 8, 21);
            this.idleTexture = new THREE.CanvasTexture(c);
            this.idleTexture.colorSpace = THREE.SRGBColorSpace;
            this.posterMaterial.map = this.idleTexture;
            this.posterMaterial.opacity = 1;
            this.posterMaterial.needsUpdate = true;
        }
    }

    /* One shape for both surfaces. When an iframe owns the screen the
       transport fields are meaningless, so the UI reads `mode` and
       hides them rather than showing a seek bar that does nothing. */
    snapshot() {
        const v = this.video;
        return {
            mode: this.surface ? this.surface.mode : "texture",
            providerStatus: this.surface ? this.surface.status : "idle",
            time: v ? v.currentTime : 0,
            duration: v && isFinite(v.duration) ? v.duration : 0,
            paused: v ? v.paused : true,
            muted: v ? v.muted : true,
            volume: v ? v.volume : 1,
            hasVideo: !!this.hasVideo
        };
    }

    play() {
        if (!this.video || !this.video.src) return;
        const p = this.video.play();
        if (p && p.catch) p.catch(() => this.onVideoEvent(this.snapshot()));
    }
    pause() { if (this.video) this.video.pause(); }
    seek(t) {
        if (!this.video || !isFinite(t)) return;
        /* Nudge off the exact boundary so a 'seeked' handler can't loop. */
        this.video.currentTime = Math.max(0, Math.min(t, (this.video.duration || t) - 0.05));
    }
    setMuted(m) { if (this.video) this.video.muted = m; }
    setVolume(v) { if (this.video) this.video.volume = Math.max(0, Math.min(1, v)); }
    toggleHouseLights() {
        const on = this._houseOn = !this._houseOn;
        this.houseLights.children.forEach(l => l.intensity = on ? 9 : 0);
        return on;
    }

    /* ---------------- movement ---------------- */

    /* Floor height at a given z. Derived from SEAT_LAYOUT so the rake and
       the seats can never drift apart: flat in front of the first row,
       a constant rise per metre through the rows, then level again for
       the cafe at the back. If you change SEAT_LAYOUT this follows. */
    _floorHeight(z) {
        const rows = SEAT_LAYOUT.rows;
        const first = rows[0];
        const last = rows[rows.length - 1];
        if (z <= first.z) return first.y;
        if (z >= last.z) return last.y;
        const perMetre = (last.y - first.y) / (last.z - first.z);
        return first.y + (z - first.z) * perMetre;
    }

    /* The walker is kept out of the seats and the counter: the auditorium
       floor is the row-A strip, the raised platform is row B, and the
       rear aisle in between is where you actually stand. */
    _walkable() {
        return {
            minX: -ROOM.width / 2 + 0.9,
            maxX: ROOM.width / 2 - 0.9,
            minZ: ROOM.frontZ + 1.6,
            maxZ: ROOM.backZ - 2.4,
            minY: 0.35,
            maxY: ROOM.ceiling - 0.6
        };
    }

    /* Sit in a seat: the eye goes to the seat's own height, which for row B
       means it rises onto the platform. */
    sitAt(seat) {
        const target = typeof seat === "object"
            ? seat
            : SEATS[((seat | 0) % SEATS.length + SEATS.length) % SEATS.length];
        if (!target) return null;
        this.seated = target.id;
        this.position.set(target.x, target.y + SEATED_EYE, target.z + 0.1);
        this.targetYaw = this.yaw = 0;      // face the screen
        this.targetPitch = this.pitch = 0;
        this.velocity.set(0, 0, 0);
        /* Sitting cues the room: house lights out, ambient drops. */
        this.setDim(true);
        return target;
    }

    /* Stand up and return to the rear entrance. */
    resetView() {
        this.seated = null;
        this.position.copy(this.entrance);
        this.targetYaw = this.yaw = 0;
        this.targetPitch = this.pitch = 0;
        this.velocity.set(0, 0, 0);
        this.setDim(false);
    }

    /* Leaving the seat puts you back in the aisle you came from. */
    /* E key toggles sitting: if standing, take the nearest seat; if seated,
       stand. */
    toggleSitNearest() {
        if (this.seated) {
            this.standUp();
            return null;
        }
        let best = null;
        let bestD = Infinity;
        const lookZ = this.position.z; // rows nearer the screen than player
        for (const seat of SEATS) {
            if (seat.z > lookZ + 0.2) continue;   // in front of / at shoulder
            const dx = seat.x - this.position.x;
            const dz = seat.z - this.position.z;
            const d = dx * dx + dz * dz;
            if (d < bestD) { bestD = d; best = seat; }
        }
        if (!best) {
            /* Fallback: absolute nearest seat. */
            for (const seat of SEATS) {
                const dx = seat.x - this.position.x;
                const dz = seat.z - this.position.z;
                const d = dx * dx + dz * dz;
                if (d < bestD) { bestD = d; best = seat; }
            }
        }
        return best ? this.sitAt(best) : null;
    }

    standUp() {
        if (!this.seated) return;
        const seat = SEATS.find(s => s.id === this.seated);
        this.seated = null;
        const z = seat && seat.z > 2 ? seat.z - 0.9 : seat ? seat.z + 1.1 : 2;
        this.position.set(seat ? seat.x : 0, this._floorHeight(z) + EYE_HEIGHT, z);
        this.velocity.set(0, 0, 0);
        this.setDim(false);
    }

    _bindInput() {
        const canvas = this.canvas;

        const onPointerDown = (e) => {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            this.dragging = true;
            canvas.classList.add("is-dragging");
            canvas.setPointerCapture?.(e.pointerId);
            this._lastX = e.clientX;
            this._lastY = e.clientY;
        };
        const onPointerMove = (e) => {
            if (!this.dragging) return;
            const dx = e.clientX - this._lastX;
            const dy = e.clientY - this._lastY;
            this._lastX = e.clientX;
            this._lastY = e.clientY;
            const sensitivity = this.tier === "low" ? 0.0042 : 0.0032;
            this.targetYaw -= dx * sensitivity;
            /* Clamp pitch: never look at the ceiling void or under the floor. */
            this.targetPitch = Math.max(-0.55, Math.min(0.62, this.targetPitch - dy * sensitivity));
        };
        const onPointerUp = (e) => {
            this.dragging = false;
            canvas.classList.remove("is-dragging");
            canvas.releasePointerCapture?.(e.pointerId);
        };

        canvas.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove, { passive: true });
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);

        this._onKeyDown = (e) => {
            this.keys.add(e.code);
        };
        this._onKeyUp = (e) => {
            this.keys.delete(e.code);
        };
        window.addEventListener("keydown", this._onKeyDown);
        window.addEventListener("keyup", this._onKeyUp);

        /* Touch joystick drives movement; supplied by the route. */
        this.setMoveVector = (x, y) => this.moveVec.set(x, y);
    }

    _updateMovement(dt) {
        /* Keyboard + touch vector, combined. */
        let fwd = 0;
        let strafe = 0;
        if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) fwd += 1;
        if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) fwd -= 1;
        if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) strafe -= 1;
        if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) strafe += 1;
        fwd += -this.moveVec.y;
        strafe += this.moveVec.x;

        const len = Math.hypot(fwd, strafe);
        if (len > 1) { fwd /= len; strafe /= len; }

        const speed = WALK_SPEED * (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? RUN_MULT : 1);

        /* Seated, you cannot walk - only stand up. Movement input while seated
           is dropped rather than queued, so releasing W does not slide
           you across the row when you stand. */
        let dx = 0, dz = 0;
        if (this.seated) {
            this.velocity.x = 0;
            this.velocity.z = 0;
        } else {
            /* Movement is relative to where you're facing. yaw 0 faces the
               screen, which is -z, so forward is -z. */
            const sin = Math.sin(this.yaw);
            const cos = Math.cos(this.yaw);
            dx = (-sin * fwd + cos * strafe) * speed;
            dz = (-cos * fwd - sin * strafe) * speed;
            this.velocity.x += (dx - this.velocity.x) * Math.min(1, dt * 12);
            this.velocity.z += (dz - this.velocity.z) * Math.min(1, dt * 12);
        }

        const w = this._walkable();
        this.position.x = Math.max(w.minX, Math.min(w.maxX, this.position.x + this.velocity.x * dt));
        this.position.z = Math.max(w.minZ, Math.min(w.maxZ, this.position.z + this.velocity.z * dt));
        /* Ride the rake instead of clipping through it - unless you are
           seated, in which case the seat's own height wins. */
        if (!this.seated) {
            this.position.y = this._floorHeight(this.position.z) + EYE_HEIGHT;
        }

        /* Eased look so drags feel weighted rather than twitchy. */
        this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 14);
        this.pitch += (this.targetPitch - this.pitch) * Math.min(1, dt * 14);

        this.camera.position.copy(this.position);
        this.camera.rotation.set(0, 0, 0);
        this.camera.rotateY(this.yaw);
        this.camera.rotateX(this.pitch);
    }

    /* ---------------- loop ---------------- */

    start() {
        if (this.running || this.disposed) return;
        this.running = true;
        this.clock.getDelta();
        this._tick();
    }

    stop() {
        this.running = false;
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = null;
    }

    _tick = () => {
        if (!this.running) return;
        this._raf = requestAnimationFrame(this._tick);
        const dt = Math.min(this.clock.getDelta(), 0.05);

        this._updateMovement(dt);

        /* The audience avatar stands where you stand; while you are seated it
           hides in the seat in front of you so it does not block the screen. */
        if (this.avatar) {
            const walking = Math.abs(this.velocity.x) + Math.abs(this.velocity.z) > 0.04;
            if (walking) {
                this._avatarBob = Math.min(1, this._avatarBob + dt * 4);
            } else {
                this._avatarBob = Math.max(0, this._avatarBob - dt * 4);
            }
            const t = performance.now() * 0.008;
            const bobY = Math.sin(t) * 0.035 * this._avatarBob;
            this.avatar.visible = !this.seated;
            if (!this.seated) {
                const floorY = this._floorHeight(this.position.z);
                this.avatar.position.set(this.position.x, floorY + bobY, this.position.z);
                const targetYaw = this.yaw;
                this.avatar.rotation.y += (targetYaw - this.avatar.rotation.y) * Math.min(1, dt * 8);
            }
        }

        /* Screen brightness tracks playback so a paused film dims the room,
           the way a real projector gate does. */
        const snap = this.snapshot();
        const playing = snap.hasVideo && !snap.paused && this.video.readyState >= 2;
        const targetGlow = playing ? 1.0 : 0.35;
        this.screenMaterial.emissiveIntensity +=
            (targetGlow - this.screenMaterial.emissiveIntensity) * Math.min(1, dt * 4);
        const targetWash = playing ? (this._dim ? 34 : 26) : (this._dim ? 20 : 7);
        this.screenWash.intensity +=
            (targetWash - this.screenWash.intensity) * Math.min(1, dt * 4);
        if (this.posterMaterial.opacity > 0) {
            this.posterMaterial.opacity = Math.max(0, this.posterMaterial.opacity - dt * 1.6);
        }

        this.renderer.render(this.scene, this.camera);
        /* The CSS3D quad only needs a render pass while an iframe is on
           the screen; otherwise it costs a style write per frame for nothing. */
        if (this.surface && this.surface.mode === "iframe") this.surface.render();
    };

    resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h, false);
        this.surface?.resize(w, h);
    }

    /* Release GPU resources. Called when leaving the theatre. */
    dispose() {
        this.disposed = true;
        this.stop();
        window.removeEventListener("resize", this._onResize);
        window.removeEventListener("keydown", this._onKeyDown);
        window.removeEventListener("keyup", this._onKeyUp);
        try { this.video.pause(); } catch (e) {}
        this.scene.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose?.();
            if (obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach(m => {
                    Object.values(m).forEach(v => { if (v && v.isTexture) v.dispose(); });
                    m.dispose?.();
                });
            }
        });
        this.videoTexture?.dispose();
        this.surface?.dispose();
        this.renderer.dispose();
        this.video?.remove();
    }
}

/* ================================================================
   VIDEO SOURCE RESOLUTION  <-- edit here
   ---------------------------------------------------------------
   Work out what should be on the screen when the page loads, and
   return it as a typed descriptor. Two kinds:

     { kind: "embed",  media, server }  a TMDB title played through a
                                       provider iframe on the CSS3D quad
     { kind: "file",   src }            media we hold directly, shown as
                                       a VideoTexture on the WebGL screen

   The distinction matters and is not a preference. A cross-origin
   <iframe> cannot be a VideoTexture at any point: VideoTexture needs
   media bytes, and one document may not read another's <video>. So
   catalogue titles go through the CSS3D quad and only sources we own
   can be a texture. See theatre-screen.js.

   Order of resolution:
     1. ?id=&type=        a TMDB title, straight from the site catalogue
     2. ?src=             a direct .mp4 / .webm link
     3. saved preference 'wavemirror_theatre_src'
     4. null              -> poster + idle glow, and the UI prompts
   ================================================================ */
export function resolveVideoSource(params) {
    const id = params.get("id");
    const type = params.get("type") === "tv" ? "tv" : "movie";
    if (id && /^\d+$/.test(id)) {
        return {
            kind: "embed",
            server: params.get("server") || SERVERS[0].key,
            media: {
                id,
                type,
                season: parseInt(params.get("season") || "1", 10) || 1,
                episode: parseInt(params.get("episode") || "1", 10) || 1,
                title: params.get("title") || "",
                url: embedUrlFor({ id, type },
                    parseInt(params.get("season") || "1", 10) || 1,
                    parseInt(params.get("episode") || "1", 10) || 1)
            }
        };
    }

    const direct = params.get("src");
    if (direct) return { kind: "file", src: direct };

    try {
        const saved = localStorage.getItem("wavemirror_theatre_src");
        if (saved) return { kind: "file", src: saved };
    } catch (e) { /* private mode */ }
    return null;
}

export { ROOM, SEAT_LAYOUT, SEATS, SEAT_NOTES, SERVERS, pickQualityTier };