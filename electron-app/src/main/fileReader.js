const fs = require('fs');
const path = require('path');

// Recursively search for metadata files in a directory (max 5 levels to reach Android app data)
function findMetadataFiles(dirPath, maxDepth = 5, currentDepth = 0) {
  if (currentDepth > maxDepth) return [];
  
  let metadataFiles = [];
  
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      
      if (item.isFile() && item.name.startsWith('metadata_') && item.name.endsWith('.json')) {
        metadataFiles.push(fullPath);
      } else if (item.isDirectory() && !item.name.startsWith('.')) {
        // Skip hidden folders and system folders
        const skipFolders = ['System Volume Information', '$RECYCLE.BIN', 'RECYCLER', '.Trashes', '.Spotlight-V100', '.fseventsd'];
        if (!skipFolders.includes(item.name)) {
          const subFiles = findMetadataFiles(fullPath, maxDepth, currentDepth + 1);
          metadataFiles = metadataFiles.concat(subFiles);
        }
      }
    }
  } catch (e) {
    // Skip folders we can't read
  }
  
  return metadataFiles;
}

async function getRecordings(drivePath) {
  // Recursively search for metadata files anywhere on the drive
  const metadataFilePaths = findMetadataFiles(drivePath);
  
  if (metadataFilePaths.length === 0) {
    return { error: 'No XoW recording files found. Please copy metadata_*.json files to this drive.', recordings: [] };
  }

  const recordings = [];
  
  // Process each found metadata file
  for (const metaPath of metadataFilePaths) {
    try {
      const raw = fs.readFileSync(metaPath, 'utf8');
      const data = JSON.parse(raw);

      // Validate required fields
      if (!data.sessionId || !data.createdAt) continue;

      // Store the directory where this metadata file was found
      // This will be used to locate video/audio files
      const metaDir = path.dirname(metaPath);
      const metaFileName = path.basename(metaPath);

      recordings.push({
        ...data,
        metaFileName,
        metaDir, // Store the actual directory where files are located
        drivePath,
        // Ensure arrays exist
        videoChunks: data.videoChunks || [],
        barcodeScans: data.barcodeScans || [],
      });
    } catch (e) {
      console.error(`Failed to parse ${path.basename(metaPath)}:`, e.message);
    }
  }

  // Sort newest first
  recordings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return { error: null, recordings };
}

module.exports = { getRecordings, findMetadataFiles };
