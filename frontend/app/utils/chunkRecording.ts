import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const CHUNK_DURATION_MS = 10 * 60 * 1000; // 10 minute per chunk(Prevent loss)
const METADATA_STORAGE_KEY = 'xow_recording_metadata';

export interface VideoChunk {
  chunkIndex: number;
  filePath: string;
  duration: number;
  startTime: number;
  endTime: number;
  fileSize: number;
}

function normalizeFileUri(path: string): string {
  if (!path || path.startsWith('file://') || path.startsWith('content://') || path.startsWith('http')) {
    return path;
  }
  return `file://${path}`;
}

async function copyToPlayableCache(fileUri: string): Promise<string> {
  const cacheRoot = `${FileSystem.cacheDirectory}xow_preview`;
  await FileSystem.makeDirectoryAsync(cacheRoot, { intermediates: true });

  const safeName = fileUri.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || `preview_${Date.now()}.mp4`;
  const targetUri = `${cacheRoot}/${safeName}`;

  const [sourceInfo, targetInfo] = await Promise.all([
    FileSystem.getInfoAsync(fileUri),
    FileSystem.getInfoAsync(targetUri),
  ]);

  const sourceSize = sourceInfo.exists && 'size' in sourceInfo ? sourceInfo.size : 0;
  const targetSize = targetInfo.exists && 'size' in targetInfo ? targetInfo.size : 0;

  if (!targetInfo.exists || sourceSize !== targetSize || targetSize < 1024) {
    await FileSystem.copyAsync({ from: fileUri, to: targetUri });
  }

  return targetUri;
}

export async function ensurePlayableUri(path: string): Promise<string> {
  if (!path) return path;
  
  // Already a content URI or HTTP URL - return as-is
  if (path.startsWith('content://') || path.startsWith('http')) {
    return path;
  }
  
  // Ensure path has file:// prefix for getContentUriAsync
  let fileUri = normalizeFileUri(path);
  
  if (Platform.OS === 'android') {
    try {
      const cachedUri = await copyToPlayableCache(fileUri);
      const contentUri = await FileSystem.getContentUriAsync(cachedUri);
      if (contentUri) {
        console.log(`✓ Using cached playable URI: ${contentUri}`);
        return contentUri;
      }
      return cachedUri;
    } catch (error) {
      console.log('Unable to prepare cached playable URI for chunk:', error);
    }

    try {
      const contentUri = await FileSystem.getContentUriAsync(fileUri);
      if (contentUri) {
        console.log(`✓ Converted to content URI: ${contentUri}`);
        return contentUri;
      }
    } catch (error) {
      console.log('Unable to derive content URI for chunk:', error);
    }
  }
  
  // Fallback to file:// URI
  return fileUri;
}

export interface RecordingMetadata {
  sessionId: string;
  chunks: VideoChunk[];
  totalDuration: number;
  createdAt: string;
  isComplete: boolean;
  audioPath: string | null;
  barcodeScansList: any[];
}

/**
 * Save chunk metadata to persistent storage
 */
export async function saveChunkMetadata(metadata: RecordingMetadata): Promise<void> {
  try {
    const existing = await getAllMetadata();
    existing[metadata.sessionId] = metadata;
    await AsyncStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(existing));
    console.log(`✓ Chunk metadata saved for session ${metadata.sessionId}`);
  } catch (error) {
    console.error('Failed to save chunk metadata:', error);
  }
}

/**
 * Get metadata for a specific session
 */
export async function getSessionMetadata(sessionId: string): Promise<RecordingMetadata | null> {
  try {
    const all = await getAllMetadata();
    return all[sessionId] || null;
  } catch (error) {
    console.error('Failed to get session metadata:', error);
    return null;
  }
}

/**
 * Get all recording metadata
 */
export async function getAllMetadata(): Promise<Record<string, RecordingMetadata>> {
  try {
    const data = await AsyncStorage.getItem(METADATA_STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch (error) {
    console.error('Failed to get all metadata:', error);
    return {};
  }
}

/**
 * Mark a recording session as complete
 */
export async function markSessionComplete(sessionId: string): Promise<void> {
  try {
    const metadata = await getSessionMetadata(sessionId);
    if (metadata) {
      metadata.isComplete = true;
      await saveChunkMetadata(metadata);
      console.log(`✓ Session ${sessionId} marked as complete`);
    }
  } catch (error) {
    console.error('Failed to mark session complete:', error);
  }
}

/**
 * Get the path for a chunk file
 */
export function getChunkFilePath(sessionId: string, chunkIndex: number, baseDir: string): string {
  return `${baseDir}/chunk_${sessionId}_${chunkIndex}.mp4`;
}

/**
 * Get the metadata file path for a session
 */
export function getMetadataFilePath(sessionId: string, baseDir: string): string {
  return `${baseDir}/metadata_${sessionId}.json`;
}

/**
 * Save chunk file to storage
 */
export async function saveChunkFile(
  sourceUri: string,
  sessionId: string,
  chunkIndex: number,
  baseDir: string
): Promise<string> {
  try {
    const destPath = getChunkFilePath(sessionId, chunkIndex, baseDir);
    await FileSystem.copyAsync({ from: sourceUri, to: destPath });
    console.log(`✓ Chunk ${chunkIndex} saved: ${destPath}`);
    return destPath;
  } catch (error) {
    console.error(`Failed to save chunk ${chunkIndex}:`, error);
    throw error;
  }
}

/**
 * Get file size in bytes
 */
export async function getFileSize(filePath: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(filePath);
    return info.exists && 'size' in info ? info.size : 0;
  } catch (error) {
    console.error('Failed to get file size:', error);
    return 0;
  }
}

/**
 * Concatenate video chunks into a single file
 * This is a placeholder - actual implementation would use FFmpeg
 */
export async function concatenateChunks(
  chunks: VideoChunk[],
  outputPath: string
): Promise<string> {
  // For now, return the first chunk path
  // In production, you would use FFmpeg to concatenate:
  // ffmpeg -f concat -safe 0 -i filelist.txt -c copy output.mp4
  
  if (chunks.length === 0) {
    throw new Error('No chunks to concatenate');
  }
  
  if (chunks.length === 1) {
    // Single chunk, just copy it
    await FileSystem.copyAsync({ from: chunks[0].filePath, to: outputPath });
    return outputPath;
  }
  
  // TODO: Implement FFmpeg concatenation for multiple chunks
  // For now, we'll keep chunks separate and handle them in upload/preview
  console.log(`Note: ${chunks.length} chunks need concatenation (FFmpeg required)`);
  return chunks[0].filePath;
}

/**
 * Clean up incomplete recording sessions older than 24 hours
 */
export async function cleanupOldSessions(): Promise<void> {
  try {
    const all = await getAllMetadata();
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    
    for (const [sessionId, metadata] of Object.entries(all)) {
      const age = now - new Date(metadata.createdAt).getTime();
      
      if (!metadata.isComplete && age > dayMs) {
        // Delete chunk files
        for (const chunk of metadata.chunks) {
          try {
            await FileSystem.deleteAsync(chunk.filePath, { idempotent: true });
          } catch (e) {
            console.log(`Failed to delete chunk: ${chunk.filePath}`);
          }
        }
        
        // Remove from metadata
        delete all[sessionId];
        console.log(`✓ Cleaned up old session: ${sessionId}`);
      }
    }
    
    await AsyncStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(all));
  } catch (error) {
    console.error('Failed to cleanup old sessions:', error);
  }
}

/**
 * Recover incomplete sessions after crash/shutdown
 * Returns array of local recording objects that can be added to gallery
 */
export async function recoverIncompleteSessions(): Promise<any[]> {
  try {
    const all = await getAllMetadata();
    const recovered: any[] = [];
    
    for (const [sessionId, metadata] of Object.entries(all)) {
      // Only recover sessions that have chunks but are not marked complete
      if (!metadata.isComplete && metadata.chunks.length > 0) {
        console.log(`🔄 Recovering session ${sessionId}: ${metadata.chunks.length} chunks`);
        
        // Verify chunk files exist
        const validChunks = [];
        for (const chunk of metadata.chunks) {
          try {
            const info = await FileSystem.getInfoAsync(chunk.filePath);
            const size = info.exists && 'size' in info ? info.size : 0;
            if (info.exists && size >= 1024) {
              validChunks.push(chunk);
            } else {
              console.log(`⚠️ Skipping invalid chunk file: ${chunk.filePath} (${size} bytes)`);
            }
          } catch (e) {
            console.log(`⚠️ Chunk file missing: ${chunk.filePath}`);
          }
        }
        
        if (validChunks.length > 0) {
          // Calculate total duration
          const totalDuration = validChunks.reduce((sum, chunk) => sum + chunk.duration, 0);
          
          // Create local recording entry
          const firstChunkPath = validChunks[0].filePath;

          const localRecording = {
            id: '',
            localId: `recovered_${sessionId}`,
            videoPath: firstChunkPath,
            audioPath: metadata.audioPath, // Will be null for incomplete sessions
            barcodeScansList: metadata.barcodeScansList || [],
            duration: Math.floor(totalDuration),
            createdAt: metadata.createdAt,
            isUploaded: false,
            boothName: 'Recovered Recording',
            deviceId: '',
            fps: 30,
            fpsTimeline: [],
            videoChunks: validChunks,
            isChunked: true,
          };
          
          recovered.push(localRecording);
          console.log(`✅ Recovered ${validChunks.length} chunks (${Math.floor(totalDuration)}s)`);
        }
        
        // Mark as complete to avoid re-recovery
        metadata.isComplete = true;
        await saveChunkMetadata(metadata);
      }
    }
    
    return recovered;
  } catch (error) {
    console.error('Failed to recover sessions:', error);
    return [];
  }
}

/**
 * Export metadata JSON file to external storage for Windows Electron app
 * This creates a standalone JSON file that can be read by the Windows player
 */
export async function exportMetadataToStorage(
  sessionId: string,
  storageDir: string
): Promise<string | null> {
  try {
    console.log(`[exportMetadataToStorage] Starting export for session: ${sessionId}`);
    console.log(`[exportMetadataToStorage] Target directory: ${storageDir}`);
    
    const metadata = await getSessionMetadata(sessionId);
    if (!metadata) {
      console.error('[exportMetadataToStorage] ❌ No metadata found for session:', sessionId);
      return null;
    }

    console.log(`[exportMetadataToStorage] ✓ Metadata loaded: ${metadata.chunks.length} chunks, ${metadata.barcodeScansList.length} scans`);

    // Create a clean export object with relative file paths
    const exportData = {
      sessionId: metadata.sessionId,
      createdAt: metadata.createdAt,
      totalDuration: metadata.totalDuration,
      isComplete: metadata.isComplete,
      videoChunks: metadata.chunks.map(chunk => ({
        chunkIndex: chunk.chunkIndex,
        fileName: chunk.filePath.split('/').pop() || `chunk_${chunk.chunkIndex}.mp4`,
        duration: chunk.duration,
        startTime: chunk.startTime,
        endTime: chunk.endTime,
        fileSize: chunk.fileSize
      })),
      audioFileName: metadata.audioPath ? metadata.audioPath.split('/').pop() : null,
      barcodeScans: metadata.barcodeScansList.map((scan: any) => ({
        barcode: scan.barcode || '',
        timestamp: scan.timestamp || 0,
        visitorName: scan.visitorName || '',
        company: scan.company || '',
        email: scan.email || '',
        phone: scan.phone || ''
      })),
      exportedAt: new Date().toISOString(),
      version: '1.0'
    };

    console.log(`[exportMetadataToStorage] ✓ Export data prepared`);

    // Save JSON file to storage directory
    const jsonFileName = `metadata_${sessionId}.json`;
    const jsonFilePath = `${storageDir}/${jsonFileName}`;
    
    console.log(`[exportMetadataToStorage] 📝 Writing JSON to: ${jsonFilePath}`);
    
    const jsonString = JSON.stringify(exportData, null, 2);
    console.log(`[exportMetadataToStorage] JSON size: ${jsonString.length} characters`);
    
    // Write to temp file first, then copy to final location (works better with external storage)
    const tempJsonPath = `${FileSystem.cacheDirectory}temp_metadata_${sessionId}.json`;
    
    try {
      // Write to cache first (always works)
      await FileSystem.writeAsStringAsync(
        tempJsonPath,
        jsonString,
        { encoding: FileSystem.EncodingType.UTF8 }
      );
      console.log(`[exportMetadataToStorage] ✓ Temp file written: ${tempJsonPath}`);
      
      // Copy to final destination
      await FileSystem.copyAsync({
        from: tempJsonPath,
        to: jsonFilePath
      });
      console.log(`[exportMetadataToStorage] ✓ Copied to final location: ${jsonFilePath}`);
      
      // Clean up temp file
      await FileSystem.deleteAsync(tempJsonPath, { idempotent: true });
      console.log(`[exportMetadataToStorage] ✓ Temp file cleaned up`);
      
    } catch (writeError: any) {
      console.error(`[exportMetadataToStorage] ❌ File write/copy failed:`, writeError?.message);
      throw writeError;
    }

    console.log(`[exportMetadataToStorage] ✅ JSON file written successfully!`);
    console.log(`[exportMetadataToStorage] 📂 Full path: ${jsonFilePath}`);
    
    return jsonFilePath;
  } catch (error: any) {
    console.error('[exportMetadataToStorage] ❌ Failed to export metadata JSON:', error);
    console.error('[exportMetadataToStorage] Error message:', error?.message);
    console.error('[exportMetadataToStorage] Error stack:', error?.stack);
    return null;
  }
}

export const CHUNK_CONFIG = {
  DURATION_MS: CHUNK_DURATION_MS,
  DURATION_SECONDS: CHUNK_DURATION_MS / 1000,
};
