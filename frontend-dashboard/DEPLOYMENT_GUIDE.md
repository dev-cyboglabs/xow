# XoW Frontend Dashboard - GoDaddy Deployment Guide

## 📦 What's Included

This folder contains your XoW web dashboard:
- `index.html` - Landing page with login/signup
- `dashboard.html` - Main dashboard (sessions, analytics, wishlist, devices)
- `conversation-info-modal.html` - Modal component for conversation details
- `assets/sample_contacts_with_id.csv` - Sample contacts file

## 🔧 Configuration

**Backend API**: `https://cyboglabs.work/eight/api`

All API calls are already configured to point to your production backend.

## 🚀 Deploy to GoDaddy

### Method 1: Using cPanel File Manager (Easiest)

1. **Login to GoDaddy cPanel**
   - Go to https://godaddy.com
   - Login → My Products → Web Hosting → Manage
   - Click "cPanel Admin"

2. **Navigate to File Manager**
   - In cPanel, find "Files" section
   - Click "File Manager"
   - Navigate to `public_html` folder

3. **Upload Files**
   - Click "Upload" button
   - Drag and drop all files from `frontend-dashboard/` folder:
     - `index.html`
     - `dashboard.html`
     - `conversation-info-modal.html`
   - Create `assets` folder and upload `sample_contacts_with_id.csv`

4. **Set Permissions**
   - Select all uploaded files
   - Click "Permissions" → Set to `644`
   - For `assets` folder → Set to `755`

5. **Done!**
   - Your dashboard is now live at `https://yourdomain.com`
   - Login page: `https://yourdomain.com/index.html`
   - Dashboard: `https://yourdomain.com/dashboard.html`

### Method 2: Using FTP (FileZilla)

1. **Get FTP Credentials**
   - In GoDaddy cPanel → "Files" → "FTP Accounts"
   - Note your FTP hostname, username, and password

2. **Connect with FileZilla**
   - Download FileZilla: https://filezilla-project.org
   - Host: `ftp.yourdomain.com`
   - Username: Your FTP username
   - Password: Your FTP password
   - Port: `21`

3. **Upload Files**
   - Navigate to `public_html` folder on remote side
   - Drag all files from `frontend-dashboard/` to `public_html/`

4. **Done!**
   - Your dashboard is live at `https://yourdomain.com`

## 🔐 SSL Certificate (HTTPS)

GoDaddy usually provides free SSL. To enable:

1. In cPanel → "Security" → "SSL/TLS Status"
2. Click "Run AutoSSL" for your domain
3. Wait 5-10 minutes for certificate to activate
4. Your site will be accessible via `https://yourdomain.com`

## 📱 Update Mobile App

After deploying, update your mobile app's `.env` file:

```bash
EXPO_PUBLIC_BACKEND_URL=https://cyboglabs.work/eight
```

Then rebuild your APK and share via Drive.

## ✅ Verify Deployment

1. **Test Landing Page**: `https://yourdomain.com/index.html`
2. **Test Login**: Click "Log In" and enter email
3. **Test Dashboard**: After login, you should see the dashboard
4. **Test API Connection**: Check browser console for any errors

## 🔧 Troubleshooting

### Issue: "Cannot connect to API"
- **Solution**: Check that backend is running at `https://cyboglabs.work/eight/`
- Test: `curl https://cyboglabs.work/eight/api/health`

### Issue: "404 Not Found"
- **Solution**: Make sure files are in `public_html` folder, not a subfolder
- Files should be at: `public_html/index.html`, `public_html/dashboard.html`

### Issue: "CORS Error"
- **Solution**: Your backend needs to allow your GoDaddy domain
- Add your domain to CORS allowed origins in `backend/server.py`

### Issue: "Mixed Content Warning"
- **Solution**: Ensure both frontend (GoDaddy) and backend (cyboglabs.work) use HTTPS

## 🌐 Custom Domain Setup

If you want a subdomain like `dashboard.yourdomain.com`:

1. **Create Subdomain in cPanel**
   - cPanel → "Domains" → "Subdomains"
   - Subdomain: `dashboard`
   - Document Root: `/public_html/dashboard`

2. **Upload Files to Subdomain Folder**
   - Upload all files to `/public_html/dashboard/`

3. **Access Dashboard**
   - `https://dashboard.yourdomain.com`

## 📊 File Structure on GoDaddy

```
public_html/
├── index.html              (Landing page)
├── dashboard.html          (Main dashboard)
├── conversation-info-modal.html
└── assets/
    └── sample_contacts_with_id.csv
```

## 🔄 Updating the Dashboard

To update after making changes:

1. Edit files locally in `/frontend-dashboard/`
2. Upload changed files via cPanel or FTP
3. Clear browser cache (Ctrl+Shift+R)

## 🎯 Next Steps

1. Deploy backend to `https://cyboglabs.work/eight/` (already configured)
2. Upload these files to GoDaddy
3. Test login and dashboard functionality
4. Update mobile APK with production backend URL
5. Share APK via Drive

## 📞 Support

If you encounter issues:
- Check browser console for errors (F12)
- Verify backend is accessible: `https://cyboglabs.work/eight/api/health`
- Ensure SSL is enabled on both frontend and backend
