# Metadata JSON Format for Windows Electron Player

## Overview
When a recording is saved to external storage (SD card/USB drive), a `metadata_[sessionId].json` file is automatically created alongside the video and audio files. This JSON file contains all the information needed for the Windows Electron player app to display visitor badges and play videos from specific timestamps.

## File Location
All files for a recording session are stored in the same directory on external storage:
```
/storage/emulated/0/XOW_Recordings/  (or USB/SD card path)
├── chunk_rec_1713612345678_0.mp4
├── chunk_rec_1713612345678_1.mp4
├── audio_rec_1713612345678.m4a
└── metadata_rec_1713612345678.json  ← This file
```

## JSON Structure

```json
{
  "sessionId": "rec_1713612345678",
  "createdAt": "2026-04-20T09:15:45.678Z",
  "totalDuration": 300,
  "isComplete": true,
  "videoChunks": [
    {
      "chunkIndex": 0,
      "fileName": "chunk_rec_1713612345678_0.mp4",
      "duration": 60,
      "startTime": 0,
      "endTime": 60,
      "fileSize": 45678901
    },
    {
      "chunkIndex": 1,
      "fileName": "chunk_rec_1713612345678_1.mp4",
      "duration": 60,
      "startTime": 60,
      "endTime": 120,
      "fileSize": 46123456
    }
  ],
  "audioFileName": "audio_rec_1713612345678.m4a",
  "barcodeScans": [
    {
      "barcode": "BADGE001",
      "timestamp": 40,
      "visitorName": "John Doe",
      "company": "Acme Corp",
      "email": "john@acme.com",
      "phone": "+1-555-0123"
    },
    {
      "barcode": "BADGE002",
      "timestamp": 129,
      "visitorName": "Jane Smith",
      "company": "Tech Inc",
      "email": "jane@tech.com",
      "phone": "+1-555-0456"
    }
  ],
  "exportedAt": "2026-04-20T09:20:45.678Z",
  "version": "1.0"
}
```

## Field Descriptions

### Root Level
- **sessionId** (string): Unique identifier for this recording session
- **createdAt** (ISO 8601 string): When the recording started
- **totalDuration** (number): Total recording duration in seconds
- **isComplete** (boolean): Whether the recording finished successfully
- **videoChunks** (array): List of video chunk files (10-minute segments)
- **audioFileName** (string|null): Name of the audio file, or null if no audio
- **barcodeScans** (array): List of visitor badge scans with timestamps
- **exportedAt** (ISO 8601 string): When this JSON was exported
- **version** (string): Metadata format version

### videoChunks[] Object
- **chunkIndex** (number): Sequential index (0, 1, 2, ...)
- **fileName** (string): Video file name (relative to metadata JSON)
- **duration** (number): Chunk duration in seconds
- **startTime** (number): Start time in the overall recording (seconds)
- **endTime** (number): End time in the overall recording (seconds)
- **fileSize** (number): File size in bytes

### barcodeScans[] Object
- **barcode** (string): Scanned barcode/badge ID
- **timestamp** (number): When the scan occurred (seconds from recording start)
- **visitorName** (string): Visitor's name (may be empty)
- **company** (string): Visitor's company (may be empty)
- **email** (string): Visitor's email (may be empty)
- **phone** (string): Visitor's phone (may be empty)

## Usage in Windows Electron App

### 1. Detect External Storage
```javascript
// Scan for removable drives
const drives = await detectRemovableDrives();
// Look for metadata_*.json files
```

### 2. Parse Metadata
```javascript
const metadata = JSON.parse(fs.readFileSync('E:/metadata_rec_123.json', 'utf8'));
```

### 3. Display Visitor Badges
```javascript
metadata.barcodeScans.forEach(scan => {
  createBadgeCard({
    name: scan.visitorName || 'Unknown',
    company: scan.company,
    timestamp: formatTime(scan.timestamp), // e.g., "0:40"
    onClick: () => playFromTimestamp(scan.timestamp)
  });
});
```

### 4. Video Playback
```javascript
// Concatenate video chunks or play sequentially
const videoFiles = metadata.videoChunks
  .sort((a, b) => a.chunkIndex - b.chunkIndex)
  .map(chunk => path.join(driveRoot, chunk.fileName));

// Seek to specific timestamp
function playFromTimestamp(seconds) {
  // Find which chunk contains this timestamp
  const chunk = metadata.videoChunks.find(
    c => seconds >= c.startTime && seconds < c.endTime
  );
  
  if (chunk) {
    const offsetInChunk = seconds - chunk.startTime;
    videoPlayer.loadChunk(chunk.fileName);
    videoPlayer.seekTo(offsetInChunk);
  }
}
```

### 5. Timeline Display
```javascript
// Create timeline with scan markers
const timeline = createTimeline({
  duration: metadata.totalDuration,
  markers: metadata.barcodeScans.map(scan => ({
    position: scan.timestamp,
    label: scan.visitorName
  }))
});
```

## Example Use Cases

### Use Case 1: Quick Badge Review
User inserts SD card → App shows all visitor badges → Click badge → Video plays from that moment

### Use Case 2: Export Visitor List
Parse all `barcodeScans` → Generate CSV/Excel with visitor names, companies, timestamps

### Use Case 3: Highlight Reel
Find all scan timestamps → Create video segments → Export compilation

## Notes
- All file paths in the JSON are **relative** (just filenames)
- The Windows app should look for files in the **same directory** as the JSON
- Video chunks are in **chronological order** by `chunkIndex`
- Timestamps are in **seconds** from the start of the recording
- The `version` field allows for future format changes

## Support
For questions about the metadata format or Windows player development, contact the XOW development team.
