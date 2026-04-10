# XoW Frontend Dashboard - Deployment Guide

## 📦 What's Included

This folder contains your XoW web dashboard:
- `index.html` - Landing page with login/signup
- `dashboard.html` - Main dashboard (sessions, analytics, wishlist, devices)
- `dashboard.js` - All JavaScript functionality (embedded in HTML)
- `conversation-info-modal.html` - Modal component for conversation details
- `sample_contacts_with_id.csv` - Sample contacts file
- `.htaccess` - Apache configuration for proper routing

## 🔧 Configuration

**Backend API**: `https://cyboglabs.work/eight/api`

All API calls are already configured to point to your production backend.

## 🚀 Deploy to Web Hosting (GoDaddy/cPanel/Other)

### Method 1: Using cPanel File Manager (Easiest)

1. **Login to cPanel**
   - Go to your hosting provider's control panel
   - Login → Web Hosting → Manage → cPanel Admin

2. **Navigate to File Manager**
   - In cPanel, find "Files" section
   - Click "File Manager"
   - Navigate to `public_html` folder

3. **Upload Files**
   - Click "Upload" button
   - Drag and drop all files from `backend/static/` folder:
     - `index.html`
     - `dashboard.html`
     - `conversation-info-modal.html`
     - `sample_contacts_with_id.csv`
     - `.htaccess`

4. **Set Permissions**
   - Select all uploaded files
   - Click "Permissions" → Set to `644`

5. **Done!**
   - Your dashboard is now live at `https://yourdomain.com`
   - Login page: `https://yourdomain.com/index.html`
   - Dashboard: `https://yourdomain.com/dashboard.html`

### Method 2: Using FTP (FileZilla)

1. **Get FTP Credentials**
   - In cPanel → "Files" → "FTP Accounts"
   - Note your FTP hostname, username, and password

2. **Connect with FileZilla**
   - Download FileZilla: https://filezilla-project.org
   - Host: `ftp.yourdomain.com`
   - Username: Your FTP username
   - Password: Your FTP password
   - Port: `21`

3. **Upload Files**
   - Navigate to `public_html` folder on remote side
   - Drag all files from `backend/static/` to `public_html/`

4. **Done!**
   - Your dashboard is live at `https://yourdomain.com`

## 🔐 SSL Certificate (HTTPS)

Most hosting providers offer free SSL. To enable:

1. In cPanel → "Security" → "SSL/TLS Status"
2. Click "Run AutoSSL" for your domain
3. Wait 5-10 minutes for certificate to activate
4. Your site will be accessible via `https://yourdomain.com`

## 📱 Mobile App Configuration

Your mobile app's `.env` file should point to:

```bash
EXPO_PUBLIC_BACKEND_URL=https://cyboglabs.work/eight
```

## ✅ Verify Deployment

1. **Test Landing Page**: `https://yourdomain.com/index.html`
2. **Test Login**: Click "Log In" and enter email
3. **Test Dashboard**: After login, you should see the dashboard
4. **Test API Connection**: Check browser console (F12) for any errors

## 🔧 Troubleshooting

### Issue: "Cannot connect to API"
- **Solution**: Check that backend is running at `https://cyboglabs.work/eight/`
- Test: Open `https://cyboglabs.work/eight/api/health` in browser
- Should return: `{"status":"healthy","timestamp":"..."}`

### Issue: "404 Not Found"
- **Solution**: Make sure files are in `public_html` folder, not a subfolder
- Files should be at: `public_html/index.html`, `public_html/dashboard.html`

### Issue: "CORS Error"
- **Solution**: Your backend needs to allow your domain
- Check `backend/server.py` CORS configuration includes your domain

### Issue: "Mixed Content Warning"
- **Solution**: Ensure both frontend and backend use HTTPS
- Backend: `https://cyboglabs.work/eight/`
- Frontend: `https://yourdomain.com`

### Issue: MongoDB Connection Error (500 errors)
- **Solution**: Whitelist your backend server IP in Digital Ocean MongoDB
- Go to Digital Ocean → Databases → db-mongodb-nyc3-572 → Settings → Trusted Sources
- Add your backend server IP or allow all IPs temporarily

## 📊 File Structure on Server

```
public_html/
├── index.html                      (Landing page)
├── dashboard.html                  (Main dashboard)
├── conversation-info-modal.html    (Modal component)
├── sample_contacts_with_id.csv     (Sample data)
└── .htaccess                       (Apache config)
```

## 🔄 Updating the Dashboard

To update after making changes:

1. Edit files locally in `backend/static/`
2. Upload changed files via cPanel or FTP
3. Clear browser cache (Ctrl+Shift+R)

## 🎯 Deployment Checklist

- [ ] Backend deployed and running at `https://cyboglabs.work/eight/`
- [ ] MongoDB connected (whitelist backend IP in Digital Ocean)
- [ ] Test health endpoint: `https://cyboglabs.work/eight/api/health`
- [ ] Upload all files from `backend/static/` to web hosting
- [ ] Enable SSL certificate (HTTPS)
- [ ] Test login and dashboard functionality
- [ ] Update mobile app `.env` with production backend URL
- [ ] Build and test mobile APK

## 📞 Support

If you encounter issues:
- Check browser console for errors (F12)
- Verify backend is accessible: `https://cyboglabs.work/eight/api/health`
- Ensure SSL is enabled on both frontend and backend
- Check MongoDB connection in backend logs: `pm2 logs xow-backend`
