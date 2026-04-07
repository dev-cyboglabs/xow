# Dashboard Not Showing Video - Debug Guide

## Status: Recording Successfully Uploaded ✅

Your recording **IS in the database**:
- Recording ID: `69d36dc70978fb9c38861e33`
- Device: `xow-5db5-d1fb` (Booth-04)
- Video: ✅ Uploaded (51MB, video_file_id present)
- Audio: ❌ Failed (audio recording error in Expo Go)
- Status: `completed`
- Barcode scans: 8 scans present

## Why Dashboard Shows Empty

The dashboard fetches data correctly, but you might not see it because:

### Issue 1: Not Paired/Logged In
The dashboard filters recordings by session. If you're not logged in or haven't paired your device, you won't see any recordings.

### Issue 2: Sample Data Override
The dashboard has sample data defined at the top that might be showing instead of real data.

## Solution: Access Dashboard

### Option 1: Direct URL (No Login Required)
Open this URL to see ALL recordings without session filter:
```
https://cyboglabs.work/eight/dashboard.html
```

Then click the **refresh button** (circular arrow icon) to load real data.

### Option 2: Pair Your Device
1. Open dashboard: https://cyboglabs.work/eight/dashboard.html
2. You'll see a pairing overlay
3. On your mobile app, go to Settings
4. Generate a pairing code
5. Enter the 6-digit code in the dashboard
6. Click "Pair Device"

### Option 3: Check Browser Console
1. Open dashboard
2. Press F12 (or Cmd+Option+I on Mac)
3. Go to Console tab
4. Look for any errors
5. Check if data is being fetched:
   ```javascript
   // In console, run:
   fetch('https://cyboglabs.work/eight/api/dashboard/recordings')
     .then(r => r.json())
     .then(d => console.log('Recordings:', d))
   ```

## Video Playback

Once you see the recording in the dashboard:

1. **Click on the session card** to expand it
2. You should see video player
3. Video URL: `https://cyboglabs.work/eight/api/recordings/69d36dc70978fb9c38861e33/video`

### If Video Doesn't Play
The video is stored in GridFS and should stream correctly. If it doesn't play:

1. Check browser console for errors
2. Try direct video URL in new tab
3. Check video codec compatibility

## Audio Issue

Audio recording failed with:
```
java.lang.RuntimeException: start failed
```

This is an **Expo Go limitation**. Audio recording in Expo Go is unreliable.

**Solution**: Create development build (not Expo Go) for reliable audio recording.

## Quick Test Commands

```bash
# Check if recording exists
curl -s "https://cyboglabs.work/eight/api/dashboard/recordings" | grep -A 20 "69d36dc70978fb9c38861e33"

# Check video file
curl -I "https://cyboglabs.work/eight/api/recordings/69d36dc70978fb9c38861e33/video"

# Get recording details
curl -s "https://cyboglabs.work/eight/api/recordings/69d36dc70978fb9c38861e33" | python3 -m json.tool
```

## Expected Dashboard View

When working correctly, you should see:

```
Sessions
├─ Booth-04
   ├─ Apr 6, 2026 • 2m 9s • 8 scanned visitors
   ├─ Status: completed
   ├─ Video: ✅ Available
   ├─ Audio: ❌ Not available
   └─ Scanned Visitors:
      ├─ BV98761 (Rajesh Kumar)
      ├─ BV98764 (Amit Patel)
      └─ ... (6 more)
```

## Next Steps

1. **Open dashboard**: https://cyboglabs.work/eight/dashboard.html
2. **Click refresh button** (top right)
3. **Check if recording appears**
4. **If not, check browser console** for errors
5. **Try pairing device** if needed

## For Future Recordings

To get **both video AND audio**:

1. Stop using Expo Go
2. Build development build:
   ```bash
   cd /Users/KABILAN/Desktop/xow/frontend
   npx expo run:android
   ```
3. This will enable:
   - ✅ Reliable video recording
   - ✅ Reliable audio recording
   - ✅ External camera support
   - ✅ All native features
