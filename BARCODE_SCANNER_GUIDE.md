# Barcode Scanner Integration Guide

## Overview
The XoW dashboard now supports real-time barcode scanning to automatically create visitor contexts during video recording. When a visitor's badge is scanned, the system captures their information and links it to the recording timestamp, creating a separate video segment for that visitor.

## How It Works

### 1. Continuous Recording
- Video records continuously at your booth/event
- The dashboard tracks the active recording and its timestamp

### 2. Barcode Scanning
- Scan visitor badges using your external USB barcode scanner
- The scanner acts as a "keyboard wedge" - it types the barcode data automatically
- System detects rapid typing (< 100ms between characters) to distinguish scanner input from manual typing

### 3. Automatic Context Creation
- Visitor information is extracted from the barcode JSON
- A new visitor context is created with:
  - Start time: Exact timestamp when barcode was scanned
  - End time: Set when next barcode is scanned OR when AI detects conversation end/silence gap
  - Visitor details: Name, phone, company, email

### 4. Dashboard Display
- Visitor appears in Sessions tab with special "SCANNED" badge
- Green border and barcode icon indicate barcode-linked visitor
- Company name displayed alongside visitor name
- Click info button to see full visitor details

## Barcode JSON Format

Your barcode must contain visitor data in JSON format:

```json
{
  "name": "John Doe",
  "phone": "+1234567890",
  "company": "Acme Corp",
  "email": "john.doe@acme.com"
}
```

### Required Fields
- `name` (string) - Visitor's full name

### Optional Fields
- `phone` (string) - Phone number
- `company` (string) - Company name
- `email` (string) - Email address

## Setup Instructions

### 1. Connect Barcode Scanner
- Connect your USB barcode scanner to the computer running the dashboard
- Most USB barcode scanners work as "keyboard wedge" devices (no special drivers needed)
- Configure scanner to output data with Enter key at the end

### 2. Start Recording
- Begin video recording on your device
- The dashboard will automatically detect the active recording
- "Barcode Scanner Active" indicator appears in top-right corner

### 3. Scan Visitor Badges
- When a visitor arrives, scan their badge
- System will:
  - Show "Barcode Scanned" notification with visitor name
  - Create visitor context at current timestamp
  - Display success toast message
  - Refresh dashboard to show new visitor

### 4. View Results
- Go to Sessions tab
- Barcode-scanned visitors show with:
  - Green background and border
  - Barcode icon (instead of chat icon)
  - "SCANNED" badge
  - Company name in subtitle
  - Video segment linked to their conversation

## Testing Without Physical Scanner

For testing purposes, you can simulate barcode scans:

1. **Manual Test Function** (in browser console):
```javascript
// Simulate scanning a visitor badge
testBarcodeScan({
  name: "Jane Smith",
  phone: "+1987654321",
  company: "Tech Innovations",
  email: "jane@techinnovations.com"
});
```

2. **Set Active Recording** (required before testing):
```javascript
// Set a recording as active for testing
setActiveRecording('your-recording-id-here');
```

## API Endpoint

### POST `/api/barcodes/scan`

Creates a visitor context from barcode scan data.

**Request Body:**
```json
{
  "recording_id": "string",
  "barcode_json": "{\"name\":\"John Doe\",\"phone\":\"+1234567890\",\"company\":\"Acme Corp\"}",
  "video_timestamp": 120.5
}
```

**Response:**
```json
{
  "_id": "visitor-badge-id",
  "badge_id": "uuid",
  "recording_id": "recording-id",
  "visitor_label": "John Doe",
  "start_time": 120.5,
  "end_time": null,
  "is_barcode_linked": true,
  "barcode_data": {
    "name": "John Doe",
    "phone": "+1234567890",
    "company": "Acme Corp",
    "email": ""
  },
  "summary": "Conversation with John Doe",
  "topics": [],
  "questions_asked": [],
  "sentiment": "neutral"
}
```

## Video Segmentation Logic

### Start Time
- Set to exact timestamp when barcode is scanned
- Example: If scanned at 00:05:30, visitor's video segment starts at 00:05:30

### End Time
Two ways to determine end time:

1. **Next Scan** (automatic)
   - When next visitor's barcode is scanned
   - Previous visitor's `end_time` is set to new scan timestamp
   - Example: Visitor A scanned at 00:05:30, Visitor B scanned at 00:08:45
   - Visitor A's segment: 00:05:30 to 00:08:45

2. **AI Detection** (future enhancement)
   - AI analyzes audio for silence gaps or conversation end
   - Automatically sets `end_time` when conversation concludes
   - Useful for last visitor or when no next scan occurs

## Troubleshooting

### Scanner Not Working
- **Check USB connection**: Ensure scanner is properly connected
- **Test in text editor**: Open notepad and scan - should type the barcode data
- **Verify JSON format**: Barcode must output valid JSON
- **Check Enter key**: Scanner should send Enter after barcode data

### "No active recording" Error
- Start a recording first before scanning
- Dashboard must be connected to a recording device
- Check that recording is in progress

### Barcode Data Not Parsed
- Verify JSON format is correct (use JSON validator)
- Ensure `name` field is present (required)
- Check for special characters that might break JSON

### Visitor Not Appearing in Dashboard
- Refresh the dashboard (data auto-refreshes after scan)
- Check browser console for errors
- Verify API endpoint is accessible

## Best Practices

1. **Badge Design**
   - Use QR codes for better reliability
   - Include all visitor data in JSON format
   - Test barcode readability before event

2. **Scanning Workflow**
   - Scan badge as visitor arrives at booth
   - Engage in conversation immediately after scan
   - System automatically links conversation to visitor

3. **Data Quality**
   - Ensure visitor data is accurate in badge system
   - Use consistent field names (name, phone, company, email)
   - Validate JSON format before printing badges

4. **Recording Management**
   - Keep recording running continuously
   - Don't stop/start recording between visitors
   - System handles segmentation automatically

## Features

✅ **Real-time scanning** - Instant visitor context creation  
✅ **Automatic segmentation** - Video split by visitor  
✅ **Visitor tracking** - Full contact details captured  
✅ **Visual indicators** - Easy identification of scanned visitors  
✅ **Timestamp accuracy** - Precise video segment linking  
✅ **No manual entry** - Fully automated workflow  

## Future Enhancements

- AI-powered conversation end detection
- Automatic visitor follow-up suggestions
- Export visitor list with video timestamps
- Integration with CRM systems
- Multi-language barcode support
