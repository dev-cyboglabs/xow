# Testing Encrypted Contact Transfer

## Issue Fixed
Dashboard was not showing contacts after "Send Data" was clicked because:
1. Dashboard wasn't polling for new contacts
2. No real-time refresh when data was uploaded

## Solution Implemented
✅ Added auto-polling every 5 seconds when on Visitors tab
✅ Added manual refresh button in contacts header
✅ Improved error handling and logging
✅ Contacts now auto-update without page refresh

## Testing Steps

### 1. Install Dependencies
```bash
cd backend
pip install -r requirements.txt
```

### 2. Restart Backend Server
```bash
# Stop current server (Ctrl+C)
# Start again
python run_server.py
```

### 3. Test Data Encryptor
1. Open browser: `http://localhost:8000/data-encryptor` (or your domain)
2. Upload a CSV/Excel file with contact data
3. Wait for encryption to complete
4. Click **"Send Data"** button
5. You should see: ✅ "Data sent to dashboard successfully!"

### 4. Test Dashboard
1. Open browser: `http://localhost:8000/dashboard` (or your domain)
2. Click **"Visitors & Followups"** tab
3. Look at the Contacts panel on the left

**Expected Behavior:**
- If no data sent yet: Shows "Waiting for Data" with animated clock
- After sending data: Contacts appear automatically within 5 seconds
- Manual refresh button (↻) in header to force check

### 5. Check Browser Console
Open Developer Tools (F12) → Console tab

**Look for these logs:**

When sending data:
```
[Encrypted Contacts] Uploaded X contacts for session_id=...
```

When dashboard loads:
```
[Dashboard] Contacts response: {contacts: Array(X), ...}
[Dashboard] ✅ Loaded X contacts from encrypted data
```

When polling:
```
[Contacts Poll] Updated: X contacts
```

If no contacts:
```
[Dashboard] ⏳ No contacts available yet
```

### 6. Debugging Tips

**If contacts don't appear:**

1. **Check backend logs** - Look for upload success message
2. **Check browser console** - Look for API errors
3. **Click manual refresh button** (↻) in contacts header
4. **Check Network tab** - Look for `/api/dashboard/contacts` request
5. **Verify API response** - Should return `{contacts: [...], contact_count: X}`

**Common Issues:**

❌ **404 on /api/dashboard/contacts**
- Backend not restarted after code changes
- Solution: Restart backend server

❌ **Empty contacts array**
- Data not uploaded yet
- Wrong session_id/user_id
- Solution: Send data again from encryptor

❌ **CORS errors**
- Frontend/backend on different domains
- Solution: Check CORS settings in server.py

## Sample CSV Format

Create a test file `contacts.csv`:

```csv
name,email,phone,company,role
John Doe,john@example.com,+1234567890,Acme Corp,CEO
Jane Smith,jane@example.com,+0987654321,Tech Inc,CTO
Bob Johnson,bob@example.com,+1122334455,StartupXYZ,Founder
```

## API Endpoints to Test

### Upload Encrypted Contacts
```bash
# This is done automatically by the "Send Data" button
# But you can test manually:

curl -X POST http://localhost:8000/api/dashboard/upload-encrypted-contacts \
  -F "file=@contacts.csv.enc"
```

### Get Contacts
```bash
curl http://localhost:8000/api/dashboard/contacts
```

## Expected Flow

```
1. Admin uploads CSV to Data Encryptor
   ↓
2. File encrypted with fixed key
   ↓
3. Admin clicks "Send Data"
   ↓
4. Encrypted file sent to backend API
   ↓
5. Backend decrypts and stores in MongoDB
   ↓
6. Dashboard polls every 5 seconds
   ↓
7. Contacts appear automatically!
```

## Polling Behavior

- **When on Visitors tab**: Auto-polls every 5 seconds
- **When switching to other tabs**: Polling stops
- **On page refresh**: Fetches contacts immediately
- **Manual refresh button**: Forces immediate check

## Success Indicators

✅ "Send Data" button shows "Sent!" after upload
✅ Console shows upload success message
✅ Dashboard shows contact count badge
✅ Contacts list populates automatically
✅ "Encrypted data received" text appears in header
✅ No "Waiting for Data" message

## Troubleshooting Commands

### Check MongoDB for contacts
```javascript
// In MongoDB shell or Compass
db.imported_contacts.find().pretty()
```

### Check backend logs
```bash
# Look for these messages:
[Encrypted Contacts] Uploaded X contacts for session_id=...
[Notification] Triggering update for session_id: ...
```

### Clear localStorage (if needed)
```javascript
// In browser console
localStorage.removeItem('xow_contacts');
location.reload();
```

## Performance Notes

- Polling interval: 5 seconds (configurable in `startContactsPolling`)
- Only re-renders if contact count changes
- Contacts cached in localStorage for faster loads
- Polling automatically stops when leaving Visitors tab

## Next Steps After Testing

If everything works:
1. ✅ Contacts appear after sending data
2. ✅ Auto-refresh works
3. ✅ Manual refresh button works
4. ✅ No console errors

You're ready to deploy! 🚀
