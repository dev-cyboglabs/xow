# Downloads Directory

This directory should contain your desktop application installers.

## Required Files

Place your compiled desktop application files here with the following names:

- `xow-windows.exe` - Windows installer
- `xow-macos.dmg` - macOS disk image
- `xow-linux.AppImage` - Linux AppImage

## File Naming Convention

The download page expects these exact filenames. If you use different names, update the `fileUrls` object in `/backend/static/download.html`:

```javascript
const fileUrls = {
    'windows': '/downloads/xow-windows.exe',
    'mac': '/downloads/xow-macos.dmg',
    'linux': '/downloads/xow-linux.AppImage'
};
```

## Nginx Configuration

To serve these files from your DigitalOcean server, ensure your Nginx configuration includes:

```nginx
location /downloads/ {
    alias /path/to/xow/backend/static/downloads/;
    autoindex off;
    
    # Optional: Add headers for better download experience
    add_header Content-Disposition 'attachment';
    add_header X-Content-Type-Options nosniff;
}
```

## File Size Recommendations

- Keep installer sizes reasonable (< 500MB recommended)
- Consider compression for faster downloads
- Test download speeds from your server

## Security Notes

- Only place official release builds in this directory
- Regularly scan files for malware
- Consider code signing for Windows and macOS installers
- Use HTTPS for all downloads (already configured in your setup)
