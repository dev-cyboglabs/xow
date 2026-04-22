const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Quick check for metadata files (search max 5 levels to reach Android app data)
function hasMetadataFiles(dirPath, maxDepth = 5, currentDepth = 0) {
  if (currentDepth > maxDepth) return false;
  
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const item of items) {
      if (item.isFile() && item.name.startsWith('metadata_') && item.name.endsWith('.json')) {
        return true;
      }
      
      if (item.isDirectory() && !item.name.startsWith('.') && currentDepth < maxDepth) {
        const skipFolders = ['System Volume Information', '$RECYCLE.BIN', 'RECYCLER', '.Trashes', '.Spotlight-V100', '.fseventsd'];
        if (!skipFolders.includes(item.name)) {
          const fullPath = path.join(dirPath, item.name);
          if (hasMetadataFiles(fullPath, maxDepth, currentDepth + 1)) {
            return true;
          }
        }
      }
    }
  } catch (e) {
    // Skip folders we can't read
  }
  
  return false;
}

async function getRemovableDrives(localStoragePath) {
  let drives = [];
  if (process.platform === 'win32') {
    drives = await getWindowsDrives();
  } else {
    drives = await getMacDrives();
  }

  // Append local storage entry if it has XoW data
  if (localStoragePath && hasMetadataFiles(localStoragePath)) {
    drives.push({
      mountpoint: localStoragePath,
      label: 'Local Storage',
      description: 'Local Storage (Saved)',
      hasXoW: true,
      isRemovable: false,
      isLocal: true,
    });
  }

  return drives;
}

function getWindowsDrives() {
  return new Promise((resolve) => {
    exec(
      'wmic logicaldisk where "DriveType=2 OR DriveType=5" get DeviceID,VolumeName,DriveType /format:csv',
      (err, stdout) => {
        if (err) {
          resolve(getFallbackDrives());
          return;
        }
        const drives = [];
        const lines = stdout.split('\n').filter((l) => l.trim() && !l.startsWith('Node'));
        for (const line of lines) {
          const parts = line.split(',').map((p) => p.trim());
          if (parts.length >= 3) {
            const deviceId = parts[1];
            const volName = parts[3] || '';
            if (deviceId && deviceId.match(/^[A-Z]:$/)) {
              const drivePath = deviceId + '\\';
              const hasXoW = hasMetadataFiles(drivePath);
              drives.push({
                mountpoint: drivePath,
                label: volName || `Removable Drive (${deviceId})`,
                description: volName
                  ? `${deviceId}\\ ${volName}`
                  : `${deviceId}\\ Removable Drive`,
                hasXoW,
                isRemovable: true,
              });
            }
          }
        }
        if (drives.length === 0) {
          resolve(getFallbackDrives());
        } else {
          resolve(drives);
        }
      }
    );
  });
}

function getMacDrives() {
  return new Promise((resolve) => {
    exec('df -h', (err, stdout) => {
      if (err) { 
        resolve([]); 
        return; 
      }
      
      const drives = [];
      const lines = stdout.split('\n').slice(1);
      
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 6) {
          const mountpoint = parts[parts.length - 1];
          if (
            mountpoint.startsWith('/Volumes/') ||
            mountpoint.startsWith('/media/') ||
            mountpoint.startsWith('/mnt/')
          ) {
            const hasXoW = hasMetadataFiles(mountpoint);
            
            drives.push({
              mountpoint,
              label: path.basename(mountpoint),
              description: mountpoint,
              hasXoW,
              isRemovable: true,
            });
          }
        }
      }
      
      resolve(drives);
    });
  });
}

function getFallbackDrives() {
  // Return common drive letters on Windows for manual selection
  const drives = [];
  const letters = ['D', 'E', 'F', 'G', 'H'];
  for (const letter of letters) {
    const mp = `${letter}:\\`;
    if (fs.existsSync(mp)) {
      const hasXoW = fs.existsSync(path.join(mp, 'XoW'));
      drives.push({
        mountpoint: mp,
        label: `${letter}: Drive`,
        description: `${letter}:\\ Drive`,
        hasXoW,
        isRemovable: true,
      });
    }
  }
  return drives;
}

module.exports = { getRemovableDrives };
