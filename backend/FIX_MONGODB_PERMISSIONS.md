# Fix MongoDB Permissions Error

## Problem
```
pymongo.errors.OperationFailure: not authorized on xow to execute command { update: "devices" }
```

Your MongoDB user has **read-only** access but needs **readWrite** permissions.

## Solution

### Option 1: Via MongoDB Compass (GUI)
1. Open MongoDB Compass
2. Connect to your database
3. Click "Users" in the left sidebar
4. Find your user (check your `MONGO_URL` for the username)
5. Click "Edit"
6. Under "Roles", add:
   - Database: `xow`
   - Role: `readWrite`
7. Save

### Option 2: Via MongoDB Shell
1. SSH into your server or connect to MongoDB Atlas
2. Run:
   ```bash
   mongosh "your_mongodb_connection_string"
   ```
3. Execute:
   ```javascript
   use admin;
   db.grantRolesToUser(
     "YOUR_USERNAME",  // from MONGO_URL
     [{ role: "readWrite", db: "xow" }]
   );
   ```

### Option 3: Via DigitalOcean MongoDB UI (if using DO)
1. Go to DigitalOcean → Databases → your MongoDB cluster
2. Click "Users & Databases" tab
3. Find your user
4. Click "Edit"
5. Grant `readWrite` role on `xow` database

## After fixing permissions:
1. Upload the updated `server.py` to your server
2. Restart the backend:
   ```bash
   pm2 restart xow-backend
   ```
3. Test the app again

## What was fixed in server.py:
- ✅ Replaced `datetime.utcnow()` with `datetime.now(timezone.utc)`
- ✅ Added timezone-aware comparison for old DB records
- ⚠️ Still need MongoDB write permissions
