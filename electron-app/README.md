# XoW Video Player

A fully **offline** Windows desktop application for reading visitor badge data from SD cards or USB drives and playing back recorded video from the exact moment each visitor was scanned.

---

## Features

- **100% Offline** — No internet required. All network requests are blocked at the Electron level.
- **SD Card / USB Detection** — Auto-detects removable drives and scans for XoW recordings.
- **Visitor Badge Grid** — Displays every scanned visitor as a card with name, company, and scan time.
- **Timestamp Playback** — Click **Play** on any badge card to open the video at that exact scan moment.
- **Visitor Info Modal** — Click **Info** to view full visitor details; copy to clipboard or print.
- **Multi-Chunk Video** — Seamlessly plays through multiple 10-minute MP4 chunks as one continuous video.
- **CSV Export** — Export the full visitor list to CSV with one click.
- **Dark Theme** — Professional dark UI designed for low-light environments.

---

## Requirements

- Windows 10 or Windows 11 (x64)
- No installation required (portable `.exe`)

---

## Usage

### Running the Portable Executable

1. Copy `XoW-Video-Player-Portable.exe` to any location (including a USB drive).
2. Double-click to launch — no installation needed.
3. Insert the SD card or USB drive containing your XoW recordings.
4. Click **Refresh** if the drive is not detected automatically.
5. Select the drive from the dropdown.
6. Click **Open Recording** on any recording.
7. Click **Play** on a visitor badge card to watch the video from that scan moment.
8. Click **Info** to view and copy full visitor details.

### Expected SD Card Structure

```
SD Card (e.g. E:\)
└── XoW\
    ├── Videos\
    │   ├── chunk_<sessionId>_0.mp4
    │   ├── chunk_<sessionId>_1.mp4
    │   └── ...
    ├── Audio\
    │   └── XoW_<timestamp>.m4a
    └── metadata_<sessionId>.json
```

---

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- npm v9 or higher

### Install Dependencies

```bash
cd electron-app
npm install
```

### Development Mode

```bash
# Terminal 1 — start Vite dev server
npm run dev

# Terminal 2 — launch Electron (with hot-reload)
ELECTRON_DEV=true npm start
```

### Build Portable Executable

```bash
npm run build
```

Output: `dist-electron/XoW-Video-Player-Portable.exe`

### Build Installer

```bash
npm run build:installer
```

Output: `dist-electron/XoW-Video-Player-Setup.exe`

---

## Offline Guarantee

The application enforces offline operation at two levels:

1. **Electron `webRequest` blocker** — All `http://` and `https://` requests are cancelled before leaving the process. Only `file://` and `data:` protocols are permitted.
2. **No external dependencies at runtime** — All libraries (React, Tailwind CSS, icons) are bundled inside the executable via Vite and electron-builder's `asar` packaging.

The app will work on air-gapped and isolated systems with no network adapter.

---

## Keyboard Shortcuts

| Action | Key |
|--------|-----|
| Close modal | `Escape` |
| Toggle play/pause | Click video |

---

## Troubleshooting

**Drive not detected**
- Click the **Refresh** button after inserting the drive.
- Make sure the drive has a `XoW` folder at its root.

**"XoW folder not found"**
- Transfer recordings from the Android app first.
- The `XoW` folder must be at the root of the drive (e.g. `E:\XoW\`).

**Video won't play**
- Ensure the `.mp4` chunk files are present in `XoW\Videos\`.
- The video player uses the browser's native H.264 decoder included with Electron.
