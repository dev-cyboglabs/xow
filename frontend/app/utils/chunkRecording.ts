import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CHUNK_DURATION_MS = 5 * 60 * 1000; // 5 minutes per chunk
const METADATA_STORAGE_KEY = 'xow_recording_metadata';

export interface VideoChunk {
  chunkIndex: number;
  filePath: string;
  duration: number;
  startTime: number;
  endTime: number;
  fileSize: number;
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

export const CHUNK_CONFIG = {
  DURATION_MS: CHUNK_DURATION_MS,
  DURATION_SECONDS: CHUNK_DURATION_MS / 1000,
};

// Expo Router treats files under app/ as routes. Provide a no-op default export
// so this utility file does not trigger missing default export warnings.
export default function ChunkRecordingUtilsRoute() {
  return null;
}
