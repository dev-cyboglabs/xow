# Chunked Video Recording Implementation

## Overview

The XoW application now implements **chunked video recording** to prevent data loss from crashes, battery failures, or app interruptions. Videos are automatically split into 5-minute segments that are saved immediately during recording.

## How It Works

### 1. **Automatic Chunk Rotation (Every 5 Minutes)**

- Recording starts with chunk 0
- Every 5 minutes, the current chunk is automatically saved and a new chunk starts
- Each chunk is saved immediately to persistent storage
- Metadata tracks all chunks for each recording session

### 2. **Crash Recovery**

If the app crashes or battery dies:
- ✅ All previously saved chunks are preserved
- ✅ Only the current chunk (< 5 minutes) is lost
- ✅ Metadata allows recovery of partial recordings
- ✅ Old incomplete sessions are automatically cleaned up after 24 hours

### 3. **Seamless Upload & Processing**

- Chunks are uploaded sequentially to the backend
- Backend automatically concatenates chunks into a single video
- AI analysis processes the complete merged video
- Preview shows the full recording (chunks are transparent to the user)

## Technical Implementation

### Frontend (`/Users/KABILAN/Desktop/xow/frontend`)

#### New Files

**`app/utils/chunkRecording.ts`** - Chunk management utilities
- `saveChunkMetadata()` - Saves session metadata to AsyncStorage
- `getSessionMetadata()` - Retrieves metadata for a session
- `saveChunkFile()` - Copies chunk to persistent storage
- `markSessionComplete()` - Marks recording as complete
- `cleanupOldSessions()` - Removes incomplete sessions > 24 hours old
- `CHUNK_CONFIG` - Configuration (5 minutes per chunk)

#### Modified Files

**`app/recorder.tsx`** - Main recording screen

**New State Variables:**
```typescript
const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
const [recordingChunks, setRecordingChunks] = useState<ChunkType[]>([]);
const currentSessionIdRef = useRef<string | null>(null);
const chunkStartTimeRef = useRef<number>(0);
const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

**New Interfaces:**
```typescript
interface VideoChunk {
  chunkIndex: number;
  filePath: string;
  duration: number;
  startTime: number;
  endTime: number;
  fileSize: number;
}

interface RecordingMetadata {
  sessionId: string;
  chunks: VideoChunk[];
  totalDuration: number;
  createdAt: string;
  isComplete: boolean;
  audioPath: string | null;
  barcodeScansList: BarcodeData[];
}
```

**Updated LocalRecording:**
```typescript
interface LocalRecording {
  // ... existing fields
  videoChunks?: VideoChunk[];  // Array of chunk metadata
  isChunked?: boolean;          // Flag for chunked recording
}
```

**Key Functions:**

1. **`rotateVideoChunk()`** - Called every 5 minutes
   - Stops current recording
   - Saves completed chunk to storage
   - Updates metadata with chunk info
   - Starts new chunk recording

2. **`startRecording()`** - Modified
   - Creates unique session ID
   - Initializes chunk metadata
   - Sets up 5-minute rotation timer
   - Records first chunk with maxDuration = 300 seconds

3. **`stopRecording()`** - Modified
   - Saves final chunk
   - Updates metadata with all chunks
   - Marks session as complete
   - Cleans up old incomplete sessions

4. **`uploadRecordingToCloud()`** - Modified
   - Detects chunked recordings
   - Uploads each chunk sequentially
   - Sends chunk metadata (index, total, duration, size)
   - Falls back to legacy single-file upload for old recordings

### Backend (`/Users/KABILAN/Desktop/xow/backend`)

#### Existing Support (Already Implemented!)

**`server.py`** - Already handles chunked uploads

**`upload_video()` endpoint:**
- Accepts `chunk_index` and `total_chunks` parameters
- Stores each chunk in GridFS
- Tracks chunks in `video_chunk_refs` collection
- Triggers concatenation when all chunks received

**`merge_chunks_and_process()` function:**
- Streams chunks from GridFS sequentially
- Concatenates into single temp file
- Runs full video processing pipeline
- Cleans up chunk files after merging
- Handles AI analysis on complete video

## Storage Structure

### Chunk Files
```
/storage/chunks/
  ├── chunk_session_123_0.mp4  (5 minutes)
  ├── chunk_session_123_1.mp4  (5 minutes)
  ├── chunk_session_123_2.mp4  (5 minutes)
  └── chunk_session_123_3.mp4  (2 minutes - final chunk)
```

### Metadata (AsyncStorage)
```json
{
  "session_123": {
    "sessionId": "session_123",
    "chunks": [
      {
        "chunkIndex": 0,
        "filePath": "/storage/chunks/chunk_session_123_0.mp4",
        "duration": 300,
        "startTime": 1234567890000,
        "endTime": 1234568190000,
        "fileSize": 52428800
      },
      // ... more chunks
    ],
    "totalDuration": 1020,
    "createdAt": "2024-01-01T12:00:00Z",
    "isComplete": true,
    "audioPath": "/storage/audio_123.m4a",
    "barcodeScansList": [...]
  }
}
```

## Configuration

**Chunk Duration:** 5 minutes (300 seconds)
- Configurable in `CHUNK_CONFIG.DURATION_MS`
- Balance between data loss risk and file management overhead

**Cleanup Policy:** 24 hours
- Incomplete sessions older than 24 hours are automatically deleted
- Prevents storage bloat from abandoned recordings

## Benefits

### ✅ Data Loss Prevention
- **Before:** Crash = entire recording lost (could be hours)
- **After:** Crash = only current chunk lost (max 5 minutes)

### ✅ Battery Failure Protection
- Chunks saved continuously during recording
- No need to "stop recording" to save data

### ✅ Storage Efficiency
- Old incomplete sessions auto-cleaned
- Chunks deleted after successful upload

### ✅ Seamless User Experience
- Chunk rotation happens in background
- User sees continuous recording
- Preview shows complete video
- Upload handles chunks automatically

### ✅ Backend Compatibility
- Backend already supports chunk concatenation
- AI analysis works on merged video
- No changes needed to existing processing pipeline

## Testing Checklist

- [ ] Start recording and verify chunks are created every 5 minutes
- [ ] Force-close app during recording and verify chunks are preserved
- [ ] Resume and check that partial recording can be uploaded
- [ ] Verify backend concatenates chunks correctly
- [ ] Test AI analysis on chunked recordings
- [ ] Verify preview shows complete video
- [ ] Test cleanup of old incomplete sessions
- [ ] Verify upload progress for multi-chunk recordings
- [ ] Test with different recording durations (< 5 min, > 5 min, > 30 min)
- [ ] Verify barcode scans are preserved across chunks

## Build Instructions

```bash
cd /Users/KABILAN/Desktop/xow/frontend

# Clean build artifacts
rm -rf android/app/.cxx android/app/build

# Regenerate Android project
npx expo prebuild --clean --platform android

# Build release APK
cd android && ./gradlew assembleRelease
```

**APK Location:**
```
/Users/KABILAN/Desktop/xow/frontend/android/app/build/outputs/apk/release/app-release.apk
```

## Monitoring & Logs

**Console logs to watch:**
- `📹 Chunked recording session started: session_xxx`
- `🔄 Rotating to chunk N...`
- `✓ Chunk N saved: XX.XX MB`
- `✅ Session complete: N chunks, XXXs total`
- `Uploading N video chunks...`
- `✓ All chunks uploaded successfully`

**Backend logs:**
- `Chunk N/M received for recording xxx`
- `Merged N chunks for recording xxx: XXX bytes`

## Future Enhancements

1. **FFmpeg Integration** - For client-side preview concatenation
2. **Adaptive Chunk Size** - Adjust based on available storage
3. **Chunk Compression** - Reduce storage footprint
4. **Background Upload** - Upload chunks while recording continues
5. **Chunk Verification** - Checksum validation for data integrity

## Notes

- Chunks are stored in persistent storage (not cache)
- Each chunk is a valid MP4 file that can be played independently
- Backend concatenation is lossless (no re-encoding)
- Metadata is stored in AsyncStorage for fast access
- Session IDs are unique timestamps + random strings
