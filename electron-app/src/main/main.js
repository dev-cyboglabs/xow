const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const driveDetector = require('./driveDetector');
const fileReader = require('./fileReader');

const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_DEV === 'true';

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#111111',
    titleBarStyle: 'default',
    title: 'XoW Video Player',
    icon: path.join(__dirname, '../../resources/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: isDev ? false : true,
    },
  });

  // Block all network requests — 100% offline (except localhost in dev mode)
  if (!isDev) {
    mainWindow.webContents.session.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (details, callback) => {
        callback({ cancel: true });
      }
    );
  }

  if (isDev) {
    mainWindow.loadURL('http://localhost:5174');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC Handlers ---

ipcMain.handle('get-drives', async () => {
  const localXoWPath = path.join(app.getPath('userData'), 'XoW');
  return await driveDetector.getRemovableDrives(localXoWPath);
});

ipcMain.handle('get-recordings', async (event, drivePath) => {
  return await fileReader.getRecordings(drivePath);
});

ipcMain.handle('get-video-path', async (event, drivePath, fileName, metaDir) => {
  // If metaDir is provided, search around that directory first
  const searchPaths = [];
  
  if (metaDir) {
    searchPaths.push(
      path.join(metaDir, 'Videos', fileName),  // Same folder/Videos
      path.join(metaDir, fileName),            // Same folder
      path.join(path.dirname(metaDir), 'Videos', fileName), // Parent/Videos
      path.join(path.dirname(metaDir), fileName)  // Parent folder
    );
  }
  
  // Fallback: search common locations
  searchPaths.push(
    path.join(drivePath, 'Videos', fileName),
    path.join(drivePath, 'XoW', 'Videos', fileName),
    path.join(drivePath, 'Android', 'data', 'com.devcyboglabs.xowrecorder', 'files', 'XoW', 'Videos', fileName),
    path.join(drivePath, fileName)
  );
  
  // Try all paths
  for (const fullPath of searchPaths) {
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  
  return null;
});

ipcMain.handle('get-audio-path', async (event, drivePath, fileName, metaDir) => {
  if (!fileName) return null;
  
  // If metaDir is provided, search around that directory first
  const searchPaths = [];
  
  if (metaDir) {
    searchPaths.push(
      path.join(metaDir, 'Audio', fileName),  // Same folder/Audio
      path.join(metaDir, fileName),           // Same folder
      path.join(path.dirname(metaDir), 'Audio', fileName), // Parent/Audio
      path.join(path.dirname(metaDir), fileName)  // Parent folder
    );
  }
  
  // Fallback: search common locations
  searchPaths.push(
    path.join(drivePath, 'Audio', fileName),
    path.join(drivePath, 'XoW', 'Audio', fileName),
    path.join(drivePath, 'Android', 'data', 'com.devcyboglabs.xowrecorder', 'files', 'XoW', 'Audio', fileName),
    path.join(drivePath, fileName)
  );
  
  // Try all paths
  for (const fullPath of searchPaths) {
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  
  return null;
});

ipcMain.handle('save-csv', async (event, csvContent, defaultName) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Visitor List',
    defaultPath: defaultName || 'visitors.csv',
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
  });
  if (filePath) {
    fs.writeFileSync(filePath, csvContent, 'utf8');
    return { success: true, path: filePath };
  }
  return { success: false };
});

ipcMain.handle('open-print-dialog', async () => {
  if (mainWindow) {
    mainWindow.webContents.print({}, (success) => {});
  }
});

ipcMain.handle('get-local-path', async () => {
  return path.join(app.getPath('userData'), 'XoW');
});

ipcMain.handle('import-to-local', async (event, drivePath) => {
  const localXoWPath = path.join(app.getPath('userData'), 'XoW');
  const localVideosPath = path.join(localXoWPath, 'Videos');
  const localAudioPath = path.join(localXoWPath, 'Audio');

  fs.mkdirSync(localVideosPath, { recursive: true });
  fs.mkdirSync(localAudioPath, { recursive: true });

  const metaFiles = fileReader.findMetadataFiles(drivePath);
  if (metaFiles.length === 0) {
    return { success: false, error: 'No recordings found on this drive.' };
  }

  let copiedFiles = 0;
  let errors = 0;

  for (const metaPath of metaFiles) {
    try {
      const raw = fs.readFileSync(metaPath, 'utf8');
      const data = JSON.parse(raw);
      const metaDir = path.dirname(metaPath);
      const metaFileName = path.basename(metaPath);

      // Copy metadata JSON
      await fs.promises.copyFile(metaPath, path.join(localXoWPath, metaFileName));
      copiedFiles++;

      // Copy video chunks
      for (const chunk of (data.videoChunks || [])) {
        const chunkName = typeof chunk === 'string' ? chunk : chunk?.fileName;
        if (!chunkName) continue;
        const searchPaths = [
          path.join(metaDir, 'Videos', chunkName),
          path.join(metaDir, chunkName),
          path.join(path.dirname(metaDir), 'Videos', chunkName),
        ];
        for (const sp of searchPaths) {
          if (fs.existsSync(sp)) {
            await fs.promises.copyFile(sp, path.join(localVideosPath, chunkName));
            copiedFiles++;
            break;
          }
        }
      }

      // Copy audio file
      const audioFile = data.audioFileName || data.audioFile;
      if (audioFile) {
        const searchPaths = [
          path.join(metaDir, 'Audio', audioFile),
          path.join(metaDir, audioFile),
          path.join(path.dirname(metaDir), 'Audio', audioFile),
        ];
        for (const sp of searchPaths) {
          if (fs.existsSync(sp)) {
            await fs.promises.copyFile(sp, path.join(localAudioPath, audioFile));
            copiedFiles++;
            break;
          }
        }
      }
    } catch (e) {
      errors++;
      console.error('Import error:', e.message);
    }
  }

  return { success: true, copiedFiles, errors, localPath: localXoWPath };
});

ipcMain.handle('open-enc-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Encrypted Visitor Data',
    filters: [{ name: 'Encrypted Files', extensions: ['enc'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  const buffer = fs.readFileSync(filePath);
  return { data: Array.from(buffer), fileName: path.basename(filePath) };
});
