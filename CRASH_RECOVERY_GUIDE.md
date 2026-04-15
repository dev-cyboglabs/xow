# Crash Recovery & Auto-Save Feature

## Overview

The XoW recorder now automatically saves video chunks **every 1 minute** during recording. This ensures that if the app crashes, the device shuts down, or the battery dies, **you only lose the last minute of recording** instead of the entire video.

## How It Works

### Automatic Chunk Saving

When you start recording:
1. **Chunk 0 starts** - Recording begins
2. **After 1 minute** - Chunk 0 is automatically saved to storage, Chunk 1 starts
3. **After 2 minutes** - Chunk 1 is saved, Chunk 2 starts
4. **And so on...** - Every minute, the current chunk is saved and a new one begins

### Example Scenarios

#### Scenario 1: 4-Minute Recording, Crash at 4:02
- **Saved:** Chunks 0, 1, 2, 3 (4 complete minutes)
- **Lost:** Only 2 seconds of the current chunk
- **Result:** You have a 4-minute video saved ✅

#### Scenario 2: 12-Minute Recording, Device Shutdown
- **Saved:** Chunks 0-11 (12 complete minutes)
- **Lost:** Only the partial current chunk (< 1 minute)
- **Result:** You have a 12-minute video saved ✅

#### Scenario 3: 30-Second Recording, App Crash
- **Saved:** Nothing (first chunk not yet complete)
- **Lost:** 30 seconds
- **Result:** No video saved ❌ (recording was too short)

## Technical Details

### Storage Location

Chunks are saved to persistent storage (not cache):
- **Internal Storage:** `/Android/data/com.devcyboglabs.xowrecorder/files/XoW/Videos/`
- **External Storage (SD Card):** `/storage/XXXX-XXXX/XoW/Videos/` (if SD card is inserted)

### File Naming

```
chunk_session_1234567890_0.mp4  (Chunk 0 - first minute)
chunk_session_1234567890_1.mp4  (Chunk 1 - second minute)
chunk_session_1234567890_2.mp4  (Chunk 2 - third minute)
...
```

### Metadata Tracking

Each recording session has metadata stored in AsyncStorage:
```json
{
  "sessionId": "session_1234567890_abc123",
  "chunks": [
    {
      "chunkIndex": 0,
      "filePath": "/path/to/chunk_0.mp4",
      "duration": 60,
      "fileSize": 10485760
    },
    // ... more chunks
  ],
  "totalDuration": 240,
  "isComplete": true,
  "audioPath": "/path/to/audio.m4a",
  "barcodeScansList": [...]
}
```

## Upload & Processing

### Automatic Upload (if enabled)

When you stop recording:
1. All chunks are uploaded sequentially to the backend
2. Backend automatically concatenates chunks into a single video
3. AI analysis processes the complete merged video
4. You see the full video in the gallery (chunks are invisible to you)

### Manual Upload

If auto-upload is disabled:
1. Chunks are stored locally
2. When you upload from the gallery, all chunks are sent
3. Backend merges them into one video
4. Processing happens normally

## Recovery After Crash

### What Happens Automatically

1. **Chunks are preserved** - All saved chunks remain in storage
2. **Metadata is intact** - Session information is saved in AsyncStorage
3. **Old sessions cleanup** - Incomplete sessions older than 24 hours are automatically deleted

### How to Access Recovered Video

1. **Restart the app** after crash/shutdown
2. **Go to Gallery** - Your partial recording will appear
3. **Upload it** - The backend will merge all saved chunks
4. **View the video** - You'll see the complete recording up to the crash point

## Configuration

### Chunk Duration

Currently set to **1 minute** (60 seconds) in `@/Users/KABILAN/Desktop/xow/frontend/app/utils/chunkRecording.ts:4`

You can adjust this by changing:
```typescript
const CHUNK_DURATION_MS = 1 * 60 * 1000; // 1 minute per chunk
```

**Trade-offs:**
- **Shorter chunks (30s):** Less data loss, more files to manage
- **Longer chunks (5min):** More data loss on crash, fewer files
- **Recommended:** 1 minute (good balance)

### Cleanup Policy

Incomplete sessions are cleaned up after **24 hours** to prevent storage bloat.

## Benefits

### ✅ Crash Protection
- App crash during recording? Only lose < 1 minute
- Battery dies? Only lose < 1 minute
- System freeze? Only lose < 1 minute

### ✅ No User Action Required
- Chunks save automatically in the background
- No need to manually save during recording
- Seamless experience - you don't even notice it's happening

### ✅ Storage Efficient
- Old incomplete sessions auto-deleted
- Chunks removed after successful upload
- No manual cleanup needed

### ✅ Reliable Upload
- Each chunk uploaded separately
- If one chunk fails, others still succeed
- Automatic retry logic in backend

## Console Logs to Monitor

When recording, you'll see these logs:

```
📹 Chunked recording session started: session_1234567890_abc123
🔄 Rotating to chunk 1...
✓ Chunk 0 saved: 10.50MB
Starting chunk 1 recording...
🔄 Rotating to chunk 2...
✓ Chunk 1 saved: 10.48MB
Starting chunk 2 recording...
...
✅ Session complete: 12 chunks, 720s total
```

## Testing

### Test Crash Recovery

1. **Start recording** for 4 minutes
2. **Force close the app** (swipe away from recent apps)
3. **Reopen the app**
4. **Check gallery** - You should see a 4-minute recording
5. **Upload it** - Backend will merge the 4 chunks

### Test Battery Failure

1. **Start recording** for 10 minutes
2. **Simulate battery death** (turn off device)
3. **Turn on device** and open app
4. **Check gallery** - You should see a 10-minute recording

### Test Normal Recording

1. **Start recording** for 5 minutes
2. **Stop recording normally**
3. **Check gallery** - You should see a 5-minute recording with 5 chunks
4. **Upload** - Backend merges into single video

## Troubleshooting

### Chunks Not Saving

**Check:**
- Storage permissions granted?
- Enough storage space available?
- Check console logs for errors

### Chunks Not Appearing in Gallery

**Check:**
- Session marked as complete in metadata?
- Chunks exist in storage directory?
- AsyncStorage not corrupted?

### Upload Failing

**Check:**
- Backend server running?
- Network connection stable?
- All chunks present in storage?

## Future Enhancements

- [ ] Real-time chunk upload during recording
- [ ] Adaptive chunk size based on available storage
- [ ] Client-side chunk concatenation for preview
- [ ] Chunk compression to reduce storage
- [ ] Checksum validation for data integrity

## Summary

With 1-minute chunk saving, you can record for hours without worrying about crashes or battery failures. The system automatically saves your progress every minute, ensuring maximum data protection with minimal overhead.

**Maximum data loss:** 1 minute  
**User action required:** None  
**Works with:** Crashes, battery failures, system freezes, force closes  
