# Visitor ID Matching System

## Overview

The XoW system now supports **Unique Visitor ID** matching as the primary method for identifying visitors from QR code scans. This replaces the previous phone number-based matching system.

## QR Code Format

### New Format (Recommended): JSON with Visitor ID

```json
{
  "visitor_id": "BV98761",
  "name": "Rajesh Kumar",
  "company": "Tech Solutions Pvt Ltd",
  "email": "rajesh@techsol.com",
  "phone": "919876543210"
}
```

### Simple Format: Just the ID

```
BV98761
```

The system will automatically detect if the QR code contains just a visitor ID (alphanumeric, 3-20 characters).

### Legacy Format: Phone Number (Still Supported)

```json
{
  "name": "Rajesh Kumar",
  "phone": "919876543210"
}
```

Phone number matching is still supported as a fallback when visitor_id is not present.

## CSV Contact File Format

### Required Column

Your CSV file **must** include a `visitor_id` column:

```csv
visitor_id,name,company,email,phone,designation
BV98761,Rajesh Kumar,Tech Solutions Pvt Ltd,rajesh@techsol.com,919876543210,Sales Manager
BV98762,Priya Sharma,Digital Innovations,priya@digitalinno.com,919765432109,Marketing Head
BV98763,Amit Patel,Cloud Systems Inc,amit@cloudsys.com,919654321098,CTO
```

### Alternative Column Names

The system recognizes these column names for visitor ID:
- `visitor_id` (recommended)
- `visitorid`
- `id`
- `visitor id`
- `badge_id`
- `badgeid`
- `badge id`
- `unique_id`
- `uniqueid`

### Sample CSV File

A sample CSV file with visitor IDs is available at:
`/Users/KABILAN/Desktop/xow/backend/static/sample_contacts_with_id.csv`

## Matching Priority

The system uses a 3-tier matching priority:

1. **Priority 1: Visitor ID** (Primary)
   - Fastest and most accurate
   - Case-insensitive matching
   - Example: `BV98761` matches `bv98761`

2. **Priority 2: Phone Number** (Fallback)
   - Used when visitor_id is not available
   - Supports partial matching
   - Example: `919876543210` matches `9876543210`

3. **Priority 3: Name** (Last Resort)
   - Used when neither ID nor phone is available
   - Exact or partial name matching
   - Example: "Rajesh Kumar" matches "rajesh kumar"

## How It Works

### 1. Import Contacts

1. Go to **Visitors** tab in the dashboard
2. Click **Import** button
3. Select your CSV file with `visitor_id` column
4. System will load all contacts

### 2. Generate QR Codes

Create QR codes with visitor IDs in JSON format:

```json
{
  "visitor_id": "BV98761",
  "name": "Rajesh Kumar",
  "company": "Tech Solutions Pvt Ltd",
  "email": "rajesh@techsol.com",
  "phone": "919876543210"
}
```

Or simply use the visitor ID:
```
BV98761
```

### 3. Scan During Recording

When you scan a QR code during recording:
1. System extracts the `visitor_id` from the QR code
2. Looks up the visitor in imported contacts by ID
3. Displays full contact information (name, company, email, phone)
4. Associates the conversation with the matched contact

### 4. View Results

In the dashboard:
- **Session tab**: Shows visitor badges with matched contact names
- **Analytics tab**: Shows conversation summaries with contact details
- **Wishlist tab**: Shows saved conversations with contact information

## Benefits of Visitor ID System

✅ **Faster Matching**: Direct ID lookup is faster than phone number parsing  
✅ **More Accurate**: No ambiguity with phone number formats  
✅ **Privacy Friendly**: ID doesn't expose personal phone numbers  
✅ **Flexible**: Works with any ID format (alphanumeric)  
✅ **Scalable**: Easy to manage large contact databases  

## Migration from Phone Number System

If you're currently using phone numbers:

1. **Add visitor_id column** to your existing CSV
2. **Generate unique IDs** for each contact (e.g., BV00001, BV00002, etc.)
3. **Update QR codes** to include visitor_id field
4. **Keep phone numbers** - they still work as fallback!

Example migration:

**Old CSV:**
```csv
name,phone,company
Rajesh Kumar,919876543210,Tech Solutions
```

**New CSV:**
```csv
visitor_id,name,phone,company
BV98761,Rajesh Kumar,919876543210,Tech Solutions
```

## Troubleshooting

### Visitor Not Matching

**Check:**
1. Is `visitor_id` column present in CSV?
2. Does the QR code contain the correct visitor_id?
3. Are IDs matching exactly (case-insensitive)?

**Debug in Console:**
1. Open browser console (F12)
2. Scan QR code
3. Look for `[extractVisitorId]` logs
4. Check if ID is being extracted correctly

### Phone Number Fallback

If visitor_id matching fails, the system will:
1. Try to match by phone number
2. Try to match by name
3. Show as "Visitor 1", "Visitor 2", etc.

## Example Workflow

1. **Prepare Contacts**
   ```csv
   visitor_id,name,company,email,phone
   BV98761,Rajesh Kumar,Tech Solutions,rajesh@tech.com,919876543210
   BV98762,Priya Sharma,Digital Innovations,priya@digital.com,919765432109
   ```

2. **Generate QR Codes**
   - Create QR code with: `{"visitor_id": "BV98761", "name": "Rajesh Kumar"}`
   - Create QR code with: `{"visitor_id": "BV98762", "name": "Priya Sharma"}`

3. **Import to Dashboard**
   - Upload CSV file in Visitors tab

4. **Record & Scan**
   - Start recording
   - Scan visitor QR codes
   - System automatically matches and displays contact info

5. **Review Results**
   - View matched conversations in Session tab
   - See full contact details in conversation info modal

## Technical Details

### Frontend Changes
- Added `extractVisitorId()` function to parse visitor IDs from QR codes
- Added `findContactById()` function for ID-based contact lookup
- Updated all contact matching logic to prioritize visitor_id

### Backend Changes
- Added visitor_id extraction in barcode scan processing
- Store visitor_id in `barcode_data` object
- Force visitor_id to uppercase for consistent matching

### Database Schema
```javascript
barcode_data: {
  visitor_id: "BV98761",  // Primary identifier
  name: "Rajesh Kumar",
  phone: "919876543210",
  company: "Tech Solutions Pvt Ltd",
  email: "rajesh@techsol.com"
}
```

## Support

For issues or questions, check the console logs for detailed matching information.
