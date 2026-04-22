# Troubleshooting: Contacts Not Showing

## Your Current Issue

You're seeing:
```
[Dashboard] Contacts response: Object
[Dashboard] ⏳ No contacts available yet
```

This means the API is responding, but returning an empty contacts array.

## Step-by-Step Debugging

### Step 1: Check What's in Database

Run this command:
```bash
cd backend
python check_contacts.py
```

**Expected Output:**
```
✅ FOUND 1 CONTACT DOCUMENT(S)

--- Document 1 ---
Session ID: None (Global)
User ID: None
Contact Count: 10
Filename: contacts.csv.enc
Uploaded At: 2026-04-22 09:42:15.123456
```

**If you see "NO CONTACTS FOUND":**
- Data was never uploaded successfully
- Go to Step 2

**If you see contacts:**
- Data is in database
- Go to Step 3

---

### Step 2: Upload Data Again

1. **Restart Backend Server**
   ```bash
   cd backend
   python run_server.py
   ```

2. **Open Data Encryptor**
   - Go to: `http://localhost:8000/data-encryptor`
   - Or your domain: `https://yourdomain.com/data-encryptor`

3. **Upload CSV/Excel File**
   - Click "Choose File"
   - Select a CSV or Excel file with contacts
   - Wait for encryption to complete

4. **Click "Send Data" Button**
   - Should show: ✅ "Data sent to dashboard successfully!"
   - If error: Check browser console and backend logs

5. **Check Backend Logs**
   Look for this message:
   ```
   [Encrypted Contacts] Uploaded X contacts for session_id=None, user_id=None
   ```

6. **Run Database Check Again**
   ```bash
   python check_contacts.py
   ```

---

### Step 3: Check API Response

1. **Open Browser Console** (F12)

2. **Go to Network Tab**

3. **Refresh Dashboard**

4. **Find Request:** `/api/dashboard/contacts`

5. **Check Response:**
   ```json
   {
     "contacts": [...],
     "contact_count": 10,
     "uploaded_at": "2026-04-22T09:42:15.123456Z",
     "filename": "contacts.csv.enc"
   }
   ```

**If `contacts` is empty array `[]`:**
- Backend can't find the data
- Check backend logs for query details
- See Step 4

---

### Step 4: Check Backend Logs

**Restart backend with verbose logging:**
```bash
cd backend
python run_server.py
```

**When dashboard loads, look for:**
```
[Contacts] Checking session_id=abc123: Not found
[Contacts] Checking user_id=None: Not found
[Contacts] Checking global contacts: Found
[Contacts] Returning 10 contacts
```

**Common Issues:**

❌ **All checks say "Not found"**
- No data in database
- Upload data from Data Encryptor

❌ **"Checking session_id=abc123: Not found" but data is global**
- Dashboard is looking for session-specific data
- But upload was global (no session_id)
- **This is OK** - backend now falls back to global

❌ **"Checking global contacts: Found" but returns 0**
- Data exists but contacts array is empty
- Re-upload from Data Encryptor

---

### Step 5: Test API Directly

**Test with curl:**
```bash
# Test global contacts
curl http://localhost:8000/api/dashboard/contacts

# Test with session_id (if you have one)
curl "http://localhost:8000/api/dashboard/contacts?session_id=YOUR_SESSION_ID"
```

**Expected Response:**
```json
{
  "contacts": [
    {
      "name": "John Doe",
      "email": "john@example.com",
      "phone": "+1234567890",
      "company": "Acme Corp"
    }
  ],
  "contact_count": 1,
  "uploaded_at": "2026-04-22T09:42:15.123456Z",
  "filename": "contacts.csv.enc"
}
```

---

### Step 6: Check Frontend Console

**Refresh dashboard and check console:**

**Good Output:**
```
[Dashboard] Contacts response: {contacts: Array(10), contact_count: 10, ...}
[Dashboard] Contact count: 10 Array length: 10
[Dashboard] ✅ Loaded 10 contacts from encrypted data
```

**Bad Output:**
```
[Dashboard] Contacts response: {contacts: Array(0), contact_count: 0, ...}
[Dashboard] Contact count: 0 Array length: 0
[Dashboard] ⏳ No contacts available yet (response: {"contacts":[],...})
```

---

## Quick Fixes

### Fix 1: Clear Everything and Start Fresh

```bash
# 1. Stop backend
# Press Ctrl+C

# 2. Clear localStorage in browser
# Open console (F12) and run:
localStorage.clear();

# 3. Restart backend
cd backend
python run_server.py

# 4. Upload data from Data Encryptor
# Go to /data-encryptor
# Upload CSV/Excel
# Click "Send Data"

# 5. Refresh dashboard
# Go to /dashboard
# Click "Visitors & Followups"
# Wait 5 seconds
```

### Fix 2: Manual Database Insert (Testing Only)

If you want to test with sample data:

```python
# Run this in Python shell or create test_upload.py
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timezone
import os
from dotenv import load_dotenv

load_dotenv()

async def insert_test_contacts():
    client = AsyncIOMotorClient(os.environ['MONGO_URL'])
    db = client[os.environ['DB_NAME']]
    
    test_contacts = [
        {"name": "John Doe", "email": "john@test.com", "phone": "+1234567890"},
        {"name": "Jane Smith", "email": "jane@test.com", "phone": "+0987654321"},
    ]
    
    await db.imported_contacts.update_one(
        {"session_id": None, "user_id": None},
        {"$set": {
            "contacts": test_contacts,
            "contact_count": len(test_contacts),
            "uploaded_at": datetime.now(timezone.utc),
            "filename": "test.csv"
        }},
        upsert=True
    )
    
    print("✅ Test contacts inserted!")
    client.close()

asyncio.run(insert_test_contacts())
```

---

## Common Error Messages

### "CORS error"
**Cause:** Frontend and backend on different domains
**Fix:** Check CORS settings in `server.py`

### "404 Not Found on /api/dashboard/contacts"
**Cause:** Backend not running or endpoint not registered
**Fix:** Restart backend server

### "Network error"
**Cause:** Backend server not accessible
**Fix:** Check backend is running on correct port

### "Invalid encrypted file format"
**Cause:** File is not a valid .enc file
**Fix:** Re-encrypt from Data Encryptor

---

## Verification Checklist

After fixing, verify:

- [ ] Backend server running
- [ ] `python check_contacts.py` shows contacts
- [ ] `/api/dashboard/contacts` returns data
- [ ] Browser console shows: `✅ Loaded X contacts`
- [ ] Dashboard Visitors tab shows contact count badge
- [ ] Contact list populated (not "Waiting for Data")
- [ ] Manual refresh button (↻) works

---

## Still Not Working?

**Collect this information:**

1. **Backend logs** (last 50 lines)
2. **Browser console** (all messages)
3. **Network tab** (response from `/api/dashboard/contacts`)
4. **Database check output** (`python check_contacts.py`)
5. **Data Encryptor** (success message screenshot)

**Then check:**
- Is MongoDB running?
- Is backend server running?
- Are you using the correct URL?
- Is the CSV file formatted correctly?

---

## Sample CSV for Testing

Create `test_contacts.csv`:
```csv
name,email,phone,company,role
John Doe,john@example.com,+1234567890,Acme Corp,CEO
Jane Smith,jane@example.com,+0987654321,Tech Inc,CTO
Bob Johnson,bob@example.com,+1122334455,StartupXYZ,Founder
```

Upload this file to test the complete flow.
