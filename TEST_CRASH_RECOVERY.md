# Crash Recovery Testing Guide

## Quick Test (5 Minutes)

### Test 1: Normal Recording with Chunks
**Duration:** 3 minutes  
**Expected Result:** 3 chunks saved

1. Open the app and start recording
2. Wait for 3 minutes (watch console logs)
3. Stop recording normally
4. **Expected logs:**
   ```
   📹 Chunked recording session started: session_xxx
   🔄 Rotating to chunk 1...
   ✓ Chunk 0 saved: XX.XXMB
   🔄 Rotating to chunk 2...
   ✓ Chunk 1 saved: XX.XXMB
   🔄 Rotating to chunk 3...
   ✓ Chunk 2 saved: XX.XXMB
   ✅ Session complete: 3 chunks, 180s total
   ```
5. **Verify:** Check gallery - should show 3-minute video
6. **Verify:** Upload works and backend merges chunks

---

### Test 2: App Crash During Recording
**Duration:** 4 minutes + crash  
**Expected Result:** 4 chunks saved, 2 seconds lost

1. Start recording
2. Wait for 4 minutes and 2 seconds
3. **Force close the app** (swipe from recent apps)
4. Reopen the app
5. Go to gallery
6. **Expected:** Recording shows ~4 minutes (not 4:02)
7. Upload the recording
8. **Expected:** Backend successfully merges 4 chunks

---

### Test 3: Device Shutdown During Recording
**Duration:** 2 minutes + shutdown  
**Expected Result:** 2 chunks saved

1. Start recording
2. Wait for 2 minutes and 30 seconds
3. **Turn off the device** (power button → Power off)
4. Turn on the device
5. Open the app
6. Go to gallery
7. **Expected:** Recording shows ~2 minutes (not 2:30)
8. Upload the recording
9. **Expected:** Backend successfully merges 2 chunks

---

### Test 4: Short Recording (< 1 Minute)
**Duration:** 30 seconds + crash  
**Expected Result:** No chunks saved

1. Start recording
2. Wait for 30 seconds
3. Force close the app
4. Reopen the app
5. Go to gallery
6. **Expected:** No recording appears (chunk not yet saved)
7. **This is expected behavior** - first chunk saves at 1-minute mark

---

### Test 5: Long Recording (12 Minutes)
**Duration:** 12 minutes  
**Expected Result:** 12 chunks saved

1. Start recording
2. Wait for 12 minutes
3. Stop recording normally
4. **Expected logs:**
   ```
   ✅ Session complete: 12 chunks, 720s total
   ```
5. **Verify:** Gallery shows 12-minute video
6. **Verify:** Upload works (12 chunks uploaded sequentially)
7. **Verify:** Backend merges into single video

---

## Console Log Verification

### What to Look For

**During Recording (every 1 minute):**
```
🔄 Rotating to chunk N...
✓ Chunk N saved: XX.XXMB
Starting chunk N+1 recording...
```

**On Stop Recording:**
```
✅ Session complete: N chunks, XXXs total
```

**On Upload:**
```
Uploading N video chunks...
Uploading chunk 1/N...
Uploading chunk 2/N...
...
✓ All chunks uploaded successfully
```

**Backend Logs:**
```
Chunk 0/N received for recording xxx
Chunk 1/N received for recording xxx
...
Merged N chunks for recording xxx: XXX bytes
```

---

## File System Verification

### Check Chunk Files Exist

**Internal Storage:**
```bash
# On Android device via ADB
adb shell ls -lh /storage/emulated/0/Android/data/com.devcyboglabs.xowrecorder/files/XoW/Videos/
```

**Expected Output:**
```
chunk_session_1234567890_0.mp4  (10-15MB)
chunk_session_1234567890_1.mp4  (10-15MB)
chunk_session_1234567890_2.mp4  (10-15MB)
...
```

### Check Metadata

**Via React Native Debugger:**
```javascript
AsyncStorage.getItem('xow_recording_metadata').then(data => {
  console.log(JSON.parse(data));
});
```

**Expected Output:**
```json
{
  "session_1234567890_abc123": {
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
    "isComplete": true
  }
}
```

---

## Performance Verification

### Check for Lag During Chunk Rotation

**What to Monitor:**
- Recording should continue smoothly during chunk rotation
- No visible freeze or stutter in the UI
- FPS should remain stable (30 FPS)
- Barcode scanning should work during rotation

**How to Test:**
1. Start recording
2. Wait for chunk rotation (at 1-minute mark)
3. Scan a barcode immediately after rotation
4. **Expected:** Barcode scans successfully, no lag

---

## Storage Space Verification

### Calculate Storage Usage

**For 1-hour recording:**
- Chunks: 60 chunks × ~12MB = ~720MB
- Audio: ~50MB
- **Total:** ~770MB

**For 4-hour recording:**
- Chunks: 240 chunks × ~12MB = ~2.9GB
- Audio: ~200MB
- **Total:** ~3.1GB

**Recommendation:** Ensure device has at least 5GB free space for long recordings.

---

## Error Scenarios

### Test 1: Storage Full During Recording

1. Fill device storage to < 100MB free
2. Start recording
3. **Expected:** Recording stops gracefully when storage full
4. **Expected:** Saved chunks are preserved

### Test 2: SD Card Removed During Recording

1. Start recording to SD card
2. Remove SD card during recording
3. **Expected:** Recording fails gracefully
4. **Expected:** App switches to internal storage

### Test 3: Network Loss During Upload

1. Record a 5-minute video (5 chunks)
2. Start upload
3. Disable network after 2 chunks uploaded
4. **Expected:** Upload pauses/fails gracefully
5. Re-enable network
6. **Expected:** Upload resumes from where it stopped

---

## Success Criteria

✅ **Chunks save every 1 minute automatically**  
✅ **App crash loses < 1 minute of recording**  
✅ **Device shutdown preserves all saved chunks**  
✅ **Upload works for multi-chunk recordings**  
✅ **Backend successfully merges chunks**  
✅ **No UI lag during chunk rotation**  
✅ **Barcode scanning works during rotation**  
✅ **Old incomplete sessions cleaned up after 24 hours**  

---

## Troubleshooting

### Chunks Not Saving

**Symptoms:** Console shows rotation logs but no chunks in storage

**Check:**
1. Storage permissions granted?
2. Enough storage space?
3. File path correct?
4. Native copy function working?

**Fix:**
```bash
# Grant storage permissions
adb shell pm grant com.devcyboglabs.xowrecorder android.permission.WRITE_EXTERNAL_STORAGE
adb shell pm grant com.devcyboglabs.xowrecorder android.permission.READ_EXTERNAL_STORAGE
```

### Chunks Not Uploading

**Symptoms:** Upload starts but fails

**Check:**
1. Backend server running?
2. Network connection stable?
3. All chunks exist in storage?
4. Backend has enough disk space?

**Fix:**
- Check backend logs for errors
- Verify chunk files exist
- Test with smaller recording first

### Metadata Corrupted

**Symptoms:** App crashes on startup or gallery shows no recordings

**Check:**
```javascript
AsyncStorage.getItem('xow_recording_metadata').then(data => {
  try {
    JSON.parse(data);
    console.log('Metadata valid');
  } catch (e) {
    console.log('Metadata corrupted:', e);
  }
});
```

**Fix:**
```javascript
// Clear corrupted metadata
AsyncStorage.removeItem('xow_recording_metadata');
```

---

## Automated Testing Script

```bash
#!/bin/bash
# test_crash_recovery.sh

echo "Starting crash recovery test..."

# Test 1: 3-minute recording
echo "Test 1: Normal 3-minute recording"
adb shell am start -n com.devcyboglabs.xowrecorder/.MainActivity
sleep 5
# Manually start recording
sleep 180
# Manually stop recording
echo "✓ Test 1 complete"

# Test 2: Crash at 2:30
echo "Test 2: Crash at 2:30"
adb shell am start -n com.devcyboglabs.xowrecorder/.MainActivity
sleep 5
# Manually start recording
sleep 150
adb shell am force-stop com.devcyboglabs.xowrecorder
echo "✓ Test 2 complete - check gallery for 2-minute video"

# Test 3: Long recording
echo "Test 3: 10-minute recording"
adb shell am start -n com.devcyboglabs.xowrecorder/.MainActivity
sleep 5
# Manually start recording
sleep 600
# Manually stop recording
echo "✓ Test 3 complete"

echo "All tests complete!"
```

---

## Final Checklist

Before deploying to production:

- [ ] Test normal recording (3 minutes)
- [ ] Test app crash during recording (4 minutes + crash)
- [ ] Test device shutdown during recording (2 minutes + shutdown)
- [ ] Test short recording < 1 minute (expected: no chunks saved)
- [ ] Test long recording (12+ minutes)
- [ ] Test upload of multi-chunk recording
- [ ] Verify backend merges chunks correctly
- [ ] Test barcode scanning during chunk rotation
- [ ] Verify no UI lag during rotation
- [ ] Test storage full scenario
- [ ] Test SD card removal scenario
- [ ] Verify old sessions cleanup after 24 hours
- [ ] Test with different chunk durations (30s, 1min, 5min)
- [ ] Performance test: 1-hour recording
- [ ] Stress test: 4-hour recording

---

## Build and Deploy

After testing, build the release APK:

```bash
cd /Users/KABILAN/Desktop/xow/frontend

# Clean build
rm -rf android/app/.cxx android/app/build

# Prebuild
npx expo prebuild --clean --platform android

# Build release
cd android && ./gradlew assembleRelease

# APK location
# android/app/build/outputs/apk/release/app-release.apk
```

Install on device:
```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

---

## Monitoring in Production

### Key Metrics to Track

1. **Average chunks per recording** - Should match duration in minutes
2. **Chunk save failures** - Should be near zero
3. **Upload success rate** - Should be > 95%
4. **Storage usage** - Monitor for bloat
5. **Crash recovery success rate** - % of recordings recovered after crash

### Logging

Enable verbose logging in production:
```typescript
// In recorder.tsx
console.log(`📊 Chunk stats: ${chunks.length} chunks, ${totalSize}MB, ${duration}s`);
```

### Analytics Events

Track these events:
- `chunk_saved` - Every time a chunk is saved
- `chunk_rotation_failed` - When rotation fails
- `session_recovered` - When incomplete session is recovered
- `upload_chunk_success` - Each chunk uploaded
- `upload_chunk_failed` - Upload failure

---

## Summary

With 1-minute chunk saving, the XoW recorder is now **crash-resistant** and **battery-failure-proof**. Maximum data loss is limited to 1 minute, making it safe for long recordings in production environments.
