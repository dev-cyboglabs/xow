# XoW Download System - Deployment Steps

## ✅ Files Already Added
- `XoW-Play.exe` (Windows)
- `XoW-Play.dmg` (macOS)
- `XoW-Play.AppImage` (Linux)

Location: `/backend/static/downloads/`

## Step 1: Update Nginx Configuration

Edit your Nginx config file:
```bash
sudo nano /etc/nginx/sites-available/cyboglabs.work
```

Add this **AFTER** the `/eight/` location block (around line 145):

```nginx
# Serve download files
location /eight/downloads/ {
    alias /path/to/xow/backend/static/downloads/;
    autoindex off;
    
    # Force download
    add_header Content-Disposition 'attachment';
    add_header X-Content-Type-Options nosniff;
    
    # CORS headers
    add_header Access-Control-Allow-Origin '*';
    add_header Access-Control-Allow-Methods 'GET, OPTIONS';
    
    # Cache for 7 days
    expires 7d;
    add_header Cache-Control "public, immutable";
    
    # Handle large files
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
}
```

**IMPORTANT**: Replace `/path/to/xow/` with your actual path. Examples:
- `/home/ubuntu/xow/backend/static/downloads/`
- `/var/www/xow/backend/static/downloads/`
- `/root/xow/backend/static/downloads/`

To find your path, run:
```bash
cd /path/to/your/xow/backend/static/downloads
pwd
```

## Step 2: Test Nginx Configuration

```bash
sudo nginx -t
```

You should see:
```
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

## Step 3: Reload Nginx

```bash
sudo systemctl reload nginx
```

## Step 4: Verify File Permissions

Make sure Nginx can read your download files:

```bash
# Navigate to your downloads directory
cd /path/to/xow/backend/static/downloads/

# Check permissions
ls -la

# Should show something like:
# -rw-r--r-- 1 user user 123456 Apr 24 09:00 XoW-Play.exe
# -rw-r--r-- 1 user user 234567 Apr 24 09:00 XoW-Play.dmg
# -rw-r--r-- 1 user user 345678 Apr 24 09:00 XoW-Play.AppImage

# If permissions are wrong, fix them:
chmod 644 XoW-Play.exe XoW-Play.dmg XoW-Play.AppImage
```

## Step 5: Restart Your XoW Backend

```bash
# If using systemd
sudo systemctl restart xow-backend

# Or if running with PM2
pm2 restart xow-backend

# Or if running manually
# Kill the process and restart it
```

## Step 6: Test the Download Flow

### Test 1: Direct File Access
Open your browser and try:
```
https://cyboglabs.work/eight/downloads/XoW-Play.exe
https://cyboglabs.work/eight/downloads/XoW-Play.dmg
https://cyboglabs.work/eight/downloads/XoW-Play.AppImage
```

Each should trigger a download.

### Test 2: Download Page
1. Go to: `https://cyboglabs.work/eight/`
2. Scroll to the download card (below Features)
3. Click "Download Now"
4. Should navigate to: `https://cyboglabs.work/eight/download`
5. Click on your OS download button
6. File should download

### Test 3: Check Logs
```bash
# Nginx access logs
sudo tail -f /var/log/nginx/access.log

# Nginx error logs
sudo tail -f /var/log/nginx/error.log

# XoW backend logs (if using systemd)
sudo journalctl -u xow-backend -f
```

## Troubleshooting

### Issue: 404 Not Found on downloads
**Solution**: Check the `alias` path in Nginx config
```bash
# Verify the path exists
ls -la /path/to/xow/backend/static/downloads/

# Update Nginx config with correct path
sudo nano /etc/nginx/sites-available/cyboglabs.work
```

### Issue: 403 Forbidden
**Solution**: Fix file permissions
```bash
cd /path/to/xow/backend/static/downloads/
chmod 644 *.exe *.dmg *.AppImage
chmod 755 .
```

### Issue: Files not downloading
**Solution**: Check Nginx error logs
```bash
sudo tail -50 /var/log/nginx/error.log
```

### Issue: Download page not loading
**Solution**: Check if route is registered
```bash
# Test the route
curl https://cyboglabs.work/eight/download

# Should return HTML content
```

## Complete Nginx Server Block Example

Here's how your server block should look with the downloads location added:

```nginx
server {
    listen 443 ssl;
    server_name cyboglabs.work www.cyboglabs.work;

    # SSL configuration
    ssl_certificate /etc/letsencrypt/live/cyboglabs.work/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cyboglabs.work/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # ... other location blocks ...

    # XoW backend (port 8016)
    location /eight/ {
        rewrite ^/eight/(.*)$ /$1 break;
        proxy_pass http://localhost:8016;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;

        client_max_body_size 0;
        proxy_buffering off;
    }

    # XoW Downloads - ADD THIS
    location /eight/downloads/ {
        alias /path/to/xow/backend/static/downloads/;
        autoindex off;
        add_header Content-Disposition 'attachment';
        add_header X-Content-Type-Options nosniff;
        add_header Access-Control-Allow-Origin '*';
        add_header Access-Control-Allow-Methods 'GET, OPTIONS';
        expires 7d;
        add_header Cache-Control "public, immutable";
        sendfile on;
        tcp_nopush on;
        tcp_nodelay on;
    }
}
```

## Quick Commands Reference

```bash
# Edit Nginx config
sudo nano /etc/nginx/sites-available/cyboglabs.work

# Test Nginx config
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx

# Restart Nginx (if reload doesn't work)
sudo systemctl restart nginx

# Check Nginx status
sudo systemctl status nginx

# View access logs
sudo tail -f /var/log/nginx/access.log

# View error logs
sudo tail -f /var/log/nginx/error.log

# Find your XoW path
cd /path/to/xow && pwd

# Check file permissions
ls -la backend/static/downloads/

# Fix permissions
chmod 644 backend/static/downloads/*.{exe,dmg,AppImage}
```

## Verification Checklist

- [ ] Files exist in `/backend/static/downloads/`
- [ ] Nginx config updated with correct path
- [ ] Nginx config test passed (`sudo nginx -t`)
- [ ] Nginx reloaded successfully
- [ ] File permissions are correct (644)
- [ ] Direct download URLs work
- [ ] Homepage download card appears
- [ ] Download page loads at `/eight/download`
- [ ] OS detection highlights correct platform
- [ ] Download buttons trigger file downloads
- [ ] "Downloading..." state shows correctly

## URLs to Test

1. **Homepage**: `https://cyboglabs.work/eight/`
2. **Download Page**: `https://cyboglabs.work/eight/download`
3. **Windows File**: `https://cyboglabs.work/eight/downloads/XoW-Play.exe`
4. **macOS File**: `https://cyboglabs.work/eight/downloads/XoW-Play.dmg`
5. **Linux File**: `https://cyboglabs.work/eight/downloads/XoW-Play.AppImage`

---

**Status**: Ready to deploy
**Next Step**: Update Nginx configuration and test
