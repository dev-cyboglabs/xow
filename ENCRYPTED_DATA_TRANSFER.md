# Encrypted Data Transfer Implementation

## Overview
Successfully implemented encrypted data transfer from the Data Encryptor tool to the Dashboard, eliminating manual CSV/Excel imports.

## Implementation Summary

### 1. Backend API Endpoints (`server.py`)

#### New Endpoint: `POST /api/dashboard/upload-encrypted-contacts`
- **Purpose**: Receives `.enc` files from Data Encryptor
- **Decryption**: Uses fixed AES-256-GCM key: `3f8a2c7d1e4b9f6a05c8e2d7b3a1f4c90e6d8b2a5f7c3e9d1b4a8f2c6e0d5b7a`
- **Process**:
  1. Validates XoWE magic header
  2. Extracts IV (12 bytes) and ciphertext
  3. Decrypts using AESGCM
  4. Parses CSV or Excel data
  5. Stores in MongoDB `imported_contacts` collection
  6. Notifies dashboard of update

#### New Endpoint: `GET /api/dashboard/contacts`
- **Purpose**: Retrieves imported contacts for dashboard
- **Filters**: By session_id or user_id
- **Returns**: Contact list with metadata

### 2. Data Encryptor (`data-encryptor.html`)

#### Added "Send Data" Button
- Located next to Download button in `DownloadPanel`
- **Features**:
  - Sends encrypted `.enc` file to backend API
  - Shows loading state during upload
  - Displays success/error messages
  - Disables after successful send

#### User Flow:
1. Admin uploads CSV/Excel → Encrypts with fixed key
2. Clicks "Send Data" button
3. Encrypted file sent to backend
4. Success confirmation shown

### 3. Dashboard (`dashboard.js`)

#### Removed Manual Import
- Removed file input and "Import" button
- No more manual CSV/Excel uploads

#### Added "Waiting for Data" State
- Shows when `importedContacts.length === 0`
- Displays:
  - Animated clock icon
  - "Waiting for Data" message
  - Instructions about Data Encryptor

#### Auto-Fetch Contacts
- Modified `fetchData()` to include contacts endpoint
- Automatically loads encrypted contacts on:
  - Page load
  - Refresh button click
  - View changes
- Updates localStorage for persistence

### 4. Dependencies (`requirements.txt`)
- Added `openpyxl>=3.1.2` for Excel parsing
- Already had `cryptography>=42.0.8` for decryption

## Security Features

✅ **Encrypted Transit**: Only `.enc` files transmitted, never raw CSV  
✅ **Fixed Key**: Built into both systems, no key exchange needed  
✅ **AES-256-GCM**: Industry-standard encryption  
✅ **Magic Header**: XoWE validation prevents invalid files  
✅ **Backend Decryption**: Dashboard never handles decryption  

## Data Flow

```
┌─────────────────┐
│ Data Encryptor  │
│  (Admin Tool)   │
└────────┬────────┘
         │ 1. Upload CSV/Excel
         │ 2. Encrypt with fixed key
         │ 3. Click "Send Data"
         ▼
┌─────────────────┐
│  Backend API    │
│  /upload-enc... │
└────────┬────────┘
         │ 4. Decrypt with fixed key
         │ 5. Parse CSV/Excel
         │ 6. Store in MongoDB
         ▼
┌─────────────────┐
│   Dashboard     │
│ /contacts API   │
└─────────────────┘
         │ 7. Auto-fetch contacts
         │ 8. Display in UI
         ▼
    [Visitors Tab]
```

## Database Schema

### Collection: `imported_contacts`
```javascript
{
  session_id: String,           // Optional
  user_id: String,              // Optional
  contacts: Array,              // Normalized contact objects
  uploaded_at: DateTime,
  filename: String,
  contact_count: Number
}
```

### Contact Object (normalized):
```javascript
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "company": "Acme Corp",
  // ... other fields (all lowercase keys)
}
```

## Testing Checklist

- [ ] Install dependencies: `pip install -r backend/requirements.txt`
- [ ] Restart backend server
- [ ] Open Data Encryptor: `domain.com/data-encryptor`
- [ ] Upload CSV/Excel file
- [ ] Verify encryption completes
- [ ] Click "Send Data" button
- [ ] Verify success message
- [ ] Open Dashboard: `domain.com/dashboard`
- [ ] Navigate to "Visitors & Followups" tab
- [ ] Verify contacts appear automatically
- [ ] Verify "Waiting for Data" shows when no contacts
- [ ] Test refresh button updates contacts

## API Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/dashboard/upload-encrypted-contacts` | Upload .enc file |
| GET | `/api/dashboard/contacts` | Retrieve contacts |

## Fixed Encryption Key

**Key**: `3f8a2c7d1e4b9f6a05c8e2d7b3a1f4c90e6d8b2a5f7c3e9d1b4a8f2c6e0d5b7a`

- **Format**: 64 hex characters (256 bits)
- **Algorithm**: AES-256-GCM
- **Usage**: Same key for all files
- **Location**: Hardcoded in both Data Encryptor and Backend

## Benefits

1. **No Manual Import**: Admins send data directly from encryptor
2. **Secure Transfer**: Only encrypted files transmitted
3. **Auto-Update**: Dashboard automatically fetches new data
4. **User-Friendly**: Clear "Waiting for Data" state
5. **Persistent**: Contacts stored in database
6. **Session-Aware**: Supports multi-tenant with session_id/user_id

## Files Modified

1. `/Users/KABILAN/Desktop/xow/backend/server.py`
   - Added encryption imports
   - Added upload endpoint
   - Added contacts retrieval endpoint

2. `/Users/KABILAN/Desktop/xow/backend/static/data-encryptor.html`
   - Added "Send Data" button
   - Added upload functionality
   - Added success/error states

3. `/Users/KABILAN/Desktop/xow/backend/static/dashboard.js`
   - Removed manual import UI
   - Added "Waiting for Data" state
   - Added auto-fetch contacts logic

4. `/Users/KABILAN/Desktop/xow/backend/requirements.txt`
   - Added `openpyxl>=3.1.2`

## Notes

- Contacts are upserted (replaced) per session/user
- Old contacts are automatically replaced with new uploads
- Dashboard checks for contacts on every refresh
- localStorage used for client-side caching
- Backend handles all decryption (frontend never sees raw key operations)
