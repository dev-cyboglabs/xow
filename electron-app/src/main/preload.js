const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xowAPI', {
  getDrives: () => ipcRenderer.invoke('get-drives'),
  getRecordings: (drivePath) => ipcRenderer.invoke('get-recordings', drivePath),
  getVideoPath: (drivePath, fileName, metaDir) =>
    ipcRenderer.invoke('get-video-path', drivePath, fileName, metaDir),
  getAudioPath: (drivePath, fileName) =>
    ipcRenderer.invoke('get-audio-path', drivePath, fileName),
  saveCsv: (csvContent, defaultName) =>
    ipcRenderer.invoke('save-csv', csvContent, defaultName),
  openPrintDialog: () => ipcRenderer.invoke('open-print-dialog'),
  openEncFile: () => ipcRenderer.invoke('open-enc-file'),
  importToLocal: (drivePath) => ipcRenderer.invoke('import-to-local', drivePath),
  formatDrive: (drivePath) => ipcRenderer.invoke('format-drive', drivePath),
  getLocalPath: () => ipcRenderer.invoke('get-local-path'),
  checkTerms: () => ipcRenderer.invoke('check-terms'),
  acceptTerms: () => ipcRenderer.invoke('accept-terms'),
  declineTerms: () => ipcRenderer.invoke('decline-terms'),
  // Utility: convert a local file path to a file:// URL the renderer can use
  filePathToUrl: (filePath) => {
    if (!filePath) return null;
    // Normalize backslashes on Windows
    const normalized = filePath.replace(/\\/g, '/');
    return `file:///${normalized}`;
  },
});
