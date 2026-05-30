<div align="center">

# 🎬 SyncTogether

**Watch local videos together in perfect sync — no uploads, no streaming, just synchronized playback.**

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5.x-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8-010101?style=flat-square&logo=socket.io&logoColor=white)](https://socket.io)
[![Vanilla JS](https://img.shields.io/badge/Vanilla_JS-ES_Modules-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![License](https://img.shields.io/badge/License-ISC-blue?style=flat-square)](LICENSE)

[Features](#-features) · [Architecture](#-architecture) · [Quick Start](#-quick-start) · [How It Works](#-how-it-works) · [Tech Stack](#-tech-stack)

</div>

---

## 📋 Overview

SyncTogether is a real-time collaborative video watching platform. Each user loads their own local video file — **no media is ever uploaded to a server**. Only playback events and timestamps are transmitted via WebSocket, keeping bandwidth near zero while maintaining frame-accurate synchronization across all participants.

The server acts as the **single source of truth** for room state, playback authority, and synchronization — making this a backend-heavy systems project, not just a frontend UI.

---

## ✨ Features

### Core Synchronization
- **Play / Pause / Seek sync** — instant cross-client playback coordination
- **Heartbeat drift correction** — 2-second interval monitoring with adaptive ±3% playback rate adjustment
- **Hard-seek correction** — direct time jump for drift exceeding 2 seconds
- **Cooldown system** — 3-second debounce prevents over-correction oscillation
- **Event loop prevention** — ignore-flag architecture prevents play→pause→play feedback loops

### Room System
- **Instant rooms** — random 6-character codes, shareable URLs (`/watch/:roomId`)
- **Live participant list** — real-time roster with role badges (👑 Host · 🎮 Controller · Viewer)
- **Host transfer** — automatic promotion when host disconnects
- **Reconnection** — 30-second grace window with session restoration via persistent guest ID
- **Permission system** — server-validated playback authority, host can grant/revoke controller access

### Media Compatibility
- **Smart matching** — filename comparison + duration analysis with confidence scoring
- **Confidence levels** — High / Medium / Low / Incompatible
- **Sync gating** — incompatible media blocks synchronization entirely

### Playback Offset System
- **Time translation** — per-user offsets for different video editions (intros, extended cuts)
- **Formula**: `localTime = hostTime + userOffset`
- **Boundary protection** — handles before-start and after-end edge cases

### Embedded Subtitle Extraction
- **MKV (Matroska)** — custom EBML parser, zero dependencies, 1MB sliding-window I/O
- **MP4 / MOV / M4V** — custom ISO BMFF parser, sample table resolution, direct sample seeking
- **External upload** — `.srt` (auto-converted to VTT) and `.vtt` files
- **Multi-track support** — dropdown selector for switching between embedded tracks

### Chat & UI
- **Real-time chat** — Socket.IO-powered messaging with timestamps
- **Custom video player** — play/pause, ±10s skip, seek bar, volume, speed (0.5x–2.0x), fullscreen
- **Keyboard shortcuts** — Space (play/pause), ←→ (seek), ↑↓ (volume), M (mute), F (fullscreen)
- **Ambient lighting** — canvas-sampled 8×8 color extraction from live video frames
- **Dark glassmorphism UI** — `backdrop-filter`, layered transparency, breathing glow animation

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                        │
│                                                                 │
│  ┌──────────┐   ┌──────────────┐   ┌────────────────────────┐  │
│  │ room.js  │──▶│ videosync.js │──▶│ subtitles-manager.js   │  │
│  │ Room     │   │ Sync Engine  │   │  ├─ mkv-subtitle-parser │  │
│  │ Mgmt     │   │ Drift Algo   │   │  └─ mp4-subtitle-parser │  │
│  └──────────┘   └──────┬───────┘   └────────────────────────┘  │
│                         │                                       │
│  ┌──────────────────────┘                                      │
│  │  room-ui.js — UI Enhancement Layer (ambient, pills, chat)   │
│  └─────────────────────────────────────────────────────────────│
│                         │                                       │
│                    Socket.IO                                    │
└─────────────────────────┬───────────────────────────────────────┘
                          │  play/pause/seek/heartbeat/rate
                          │  ~2KB/s per room
┌─────────────────────────┴───────────────────────────────────────┐
│                      SERVER (Node.js)                           │
│                                                                 │
│  server.js — Single Source of Truth                             │
│  ├─ Room lifecycle (create/join/leave/cleanup)                  │
│  ├─ Playback authority validation                               │
│  ├─ Playback state synchronization                              │
│  ├─ Heartbeat relay + state persistence                         │
│  ├─ Permission management (host/controller/viewer)              │
│  └─ Reconnect handling (30s grace window)                       │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| **No media upload** | Zero server storage, zero bandwidth — only metadata flows |
| **Server-authoritative** | All playback mutations validated server-side before broadcast |
| **Client-side subtitle parsing** | Binary parsers run in-browser — server stays lightweight |
| **Heartbeat-based drift** | Continuous correction instead of one-time sync |
| **Ignore-flag pattern** | Prevents infinite event loops during synchronized state changes |

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org) 18+

### Run Locally

```bash
# Clone the repository
git clone https://github.com/divyanshag01/sync-together.git
cd sync-together

# Install dependencies
npm install

# Start the server
npm start
```

Open `http://localhost:8080` — create a room, share the link, and load the same video on both browsers.

### Development Mode

```bash
npm run dev    # auto-restart on file changes (nodemon)
```

---

## 🔧 How It Works

### Synchronization Flow

```
Host presses Play
       │
       ▼
videosync.js emits "video-play" ──▶ server.js validates permission
                                           │
                                    ✅ Authorized
                                           │
                                    Updates playbackState
                                           │
                                    Broadcasts to room
                                           │
                                           ▼
                              All clients receive "video-play"
                                           │
                                    Set ignorePlayEvent = true
                                    Apply time + offset translation
                                    video.play()
```

### Drift Correction Algorithm

```
Every 2 seconds (heartbeat):
  │
  ├─ drift = expectedTime - actualTime
  │
  ├─ |drift| < 0.35s  →  ✅ Synced (reset correction)
  │
  ├─ 0.35s ≤ |drift| < 2s  →  ⚡ Rate adjustment
  │     Behind? → playbackRate × 1.03 (speed up 3%)
  │     Ahead?  → playbackRate × 0.97 (slow down 3%)
  │     (3-second cooldown between corrections)
  │
  └─ |drift| ≥ 2s  →  🎯 Hard seek to correct position
```

### Subtitle Extraction Pipeline

```
User selects .mkv / .mp4 file
       │
       ▼
subtitles-manager.js routes by extension
       │
       ├─ .mkv → EBML parser (1MB sliding window)
       │         Parse Tracks → Find subtitle TrackEntries
       │         Scan Clusters → Extract SimpleBlock/BlockGroup cues
       │         Convert ASS/SRT/VTT → WebVTT string
       │
       └─ .mp4 → ISO BMFF parser (1MB sliding window)
                  Scan top-level boxes → Find moov
                  Parse trak → hdlr → stbl → sample tables
                  Seek to subtitle samples → Decode tx3g/wvtt/stpp
                  Build WebVTT string
       │
       ▼
Blob URL created → <track> element attached → Browser renders subtitles
```

---

## 🛠 Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Runtime** | Node.js | Event-driven, non-blocking I/O for real-time apps |
| **Server** | Express 5 | Minimal HTTP server + static file serving |
| **Real-Time** | Socket.IO 4.8 | WebSocket with automatic fallback transport |
| **Frontend** | Vanilla JS (ES Modules) | Zero framework overhead, full control |
| **Styling** | Custom CSS | Glassmorphism design system, no utility frameworks |
| **Typography** | Inter (Google Fonts) | Clean, professional variable font |
| **Subtitle Parsing** | Custom EBML + ISO BMFF | Zero-dependency binary format parsers |

---

## 📁 Project Structure

```
sync-together/
├── server.js                    # Express + Socket.IO server (source of truth)
├── package.json
├── .env                         # PORT configuration
├── .gitignore
│
├── public/
│   ├── index.html               # Landing page
│   ├── index.css                # Landing page styles
│   ├── room.html                # Watch room page
│   ├── room.css                 # Room page styles (~1150 lines)
│   ├── styles.css               # Shared design system
│   ├── main.js                  # Landing page logic
│   ├── room.js                  # Room management + chat + permissions
│   ├── room-ui.js               # UI enhancement layer (ambient, pills, controls)
│   ├── videosync.js             # Synchronization engine (~800 lines)
│   ├── utils.js                 # Shared utilities
│   │
│   └── subtitles/
│       ├── subtitles-manager.js # Parser router (lazy-loads by extension)
│       ├── mkv-subtitle-parser.js  # EBML/Matroska parser (~650 lines)
│       └── mp4-subtitle-parser.js  # ISO BMFF parser (~540 lines)
│
└── project-context/             # Architecture & design documentation
    ├── ARCHITECTURE.md
    ├── SOCKET_EVENTS.md
    ├── MEDIA_SYNC.md
    ├── ROOM_FLOW.md
    ├── SUBTITLE_SYSTEM.md
    └── ...
```

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `←` | Rewind 10 seconds |
| `→` | Forward 10 seconds |
| `↑` | Volume up (5%) |
| `↓` | Volume down (5%) |
| `M` | Toggle mute |
| `F` | Toggle fullscreen |

---

## 🔒 Security Model

- **Server-side validation** — all playback events verified before broadcast
- **Permission hierarchy** — Host → Controller → Viewer, enforced server-side
- **No media exposure** — video files never leave the user's browser
- **Session isolation** — guest IDs scoped to localStorage per browser

---

## 📊 Project Scale

| Metric | Value |
|---|---|
| Server logic | ~310 lines |
| Sync engine | ~820 lines |
| UI layer | ~570 lines |
| MKV parser | ~650 lines |
| MP4 parser | ~540 lines |
| CSS | ~1,570 lines |
| **Total hand-written code** | **~5,000+ lines** |
| Dependencies | 3 (express, socket.io, nodemon) |

---

## 🗺 Roadmap

- [ ] Room user limits
- [ ] Reconnect hardening
- [ ] Blob URL memory cleanup
- [ ] WebRTC media streaming
- [ ] Authentication system
- [ ] Database persistence
- [ ] Horizontal scaling

---

## 📄 License

ISC

---

<div align="center">

**Built with ❤️ using Node.js, Socket.IO, and Vanilla JavaScript**

</div>
