import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
  Alert,
  Modal,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Video, ResizeMode } from 'expo-av';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB per chunk

interface VideoChunk {
  chunkIndex: number;
  filePath: string;
  duration: number;
  startTime: number;
  endTime: number;
  fileSize: number;
}

interface LocalRecording {
  id: string;
  localId: string;
  videoPath: string | null;
  audioPath: string | null;
  barcodeScansList: BarcodeData[];
  duration: number;
  createdAt: string;
  isUploaded: boolean;
  boothName: string;
  deviceId: string;
  fps?: number;
  fpsTimeline?: number[];
  capturedFrames?: string[];  // periodic visitor snapshot paths
  videoChunks?: VideoChunk[];  // Array of video chunks for chunked recordings
  isChunked?: boolean;  // Flag indicating chunked recording
}

interface BarcodeData {
  barcode_data: string;
  video_timestamp: number;
  frame_code: number;
}

interface CloudRecording {
  id: string;
  start_time: string;
  duration?: number;
  status: string;
  has_audio: boolean;
  has_video: boolean;
  summary?: string;
  overall_summary?: string;
  barcode_scans: any[];
  total_speakers?: number;
  host_identified?: boolean;
  head_count?: number;
  avg_head_count?: number;
}

type CombinedRecording = (LocalRecording & { source: 'local' }) | (CloudRecording & { source: 'cloud' });

export default function GalleryScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const [recordings, setRecordings] = useState<CombinedRecording[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0); // 0–1, video chunk progress
  const [autoUploadingId, setAutoUploadingId] = useState<string | null>(null);
  const [autoUploadProgress, setAutoUploadProgress] = useState<number>(0); // 0–1
  const autoUploadStateRef = useRef<{ localId: string; progress: number } | null>(null);
  const autoUploadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'all' | 'local' | 'cloud'>('all');
  
  // Preview modal state
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');
  const videoRef = useRef<any>(null);
  const [videoPosition, setVideoPosition] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [globalDuration, setGlobalDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [videoFps, setVideoFps] = useState(30);
  const [previewFpsTimeline, setPreviewFpsTimeline] = useState<number[]>([]);
  const [videoHasEnded, setVideoHasEnded] = useState(false);
  
  // Chunked playback state
  const [allChunks, setAllChunks] = useState<VideoChunk[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [isChunkedPlayback, setIsChunkedPlayback] = useState(false);
  const [chunkStartOffsets, setChunkStartOffsets] = useState<number[]>([]);
  const [isSeeking, setIsSeeking] = useState(false);
  const progressTrackWidthRef = useRef(0);
  const pendingSeekMsRef = useRef<number | null>(null);
  const pendingSeekResumeRef = useRef<boolean | null>(null);
  const dragSeekSecondsRef = useRef<number | null>(null);
  const wasPlayingBeforeSeekRef = useRef(true);

  useEffect(() => { loadDevice(); }, []);
  useEffect(() => { if (deviceId) fetchRecordings(); }, [deviceId]);

  // Poll for background auto-upload state written by recorder screen
  useEffect(() => {
    const poll = async () => {
      try {
        const raw = await AsyncStorage.getItem('xow_auto_upload_state');
        if (raw) {
          const state: { localId: string; progress: number } = JSON.parse(raw);
          const wasNull = autoUploadStateRef.current === null;
          autoUploadStateRef.current = state;
          setAutoUploadingId(state.localId);
          setAutoUploadProgress(state.progress / 100);
          if (wasNull && deviceId) {
            // New auto-upload started — refresh list so the recording card appears
            fetchRecordings();
          }
        } else if (autoUploadStateRef.current !== null) {
          // Auto-upload just completed
          autoUploadStateRef.current = null;
          setAutoUploadingId(null);
          setAutoUploadProgress(0);
          if (deviceId) fetchRecordings();
        }
      } catch {}
    };

    poll();
    autoUploadPollRef.current = setInterval(poll, 1000);
    return () => {
      if (autoUploadPollRef.current) clearInterval(autoUploadPollRef.current);
    };
  }, [deviceId]);

  const loadDevice = async () => {
    const device_id = await AsyncStorage.getItem('xow_permanent_device_id');
    if (device_id) setDeviceId(device_id);
  };

  const fetchRecordings = async () => {
    try {
      // Get local recordings
      const localRecordings = await getLocalRecordings();
      
      // Get cloud recordings
      let cloudRecordings: CloudRecording[] = [];
      try {
        const res = await axios.get(`${API_URL}/api/recordings`, { params: { device_id: deviceId }, timeout: 10000 });
        cloudRecordings = res.data;
      } catch (e) {
        console.log('Could not fetch cloud recordings:', e);
      }

      // Combine recordings
      const combined: CombinedRecording[] = [];
      
      // Add local recordings (not uploaded)
      for (const local of localRecordings) {
        if (!local.isUploaded) {
          combined.push({ ...local, source: 'local' as const });
        }
      }
      
      // Add cloud recordings
      for (const cloud of cloudRecordings) {
        combined.push({ ...cloud, source: 'cloud' as const });
      }

      // Sort by date (newest first)
      combined.sort((a, b) => {
        const dateA = a.source === 'local' ? new Date(a.createdAt).getTime() : new Date(a.start_time).getTime();
        const dateB = b.source === 'local' ? new Date(b.createdAt).getTime() : new Date(b.start_time).getTime();
        return dateB - dateA;
      });

      setRecordings(combined);
    } catch (e) {
      console.error('Fetch recordings error:', e);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  const seekToGlobalSeconds = async (targetSeconds: number, shouldResume: boolean) => {
    const total = globalDuration > 0 ? globalDuration : videoDuration;
    if (!videoRef.current || total <= 0) return;

    const clamped = Math.max(0, Math.min(targetSeconds, total));
    setVideoPosition(clamped);
    setVideoHasEnded(false);

    if (!isChunkedPlayback || allChunks.length === 0) {
      await videoRef.current.setPositionAsync(clamped * 1000);
      if (shouldResume) {
        await videoRef.current.playAsync();
        setIsPlaying(true);
      } else {
        await videoRef.current.pauseAsync();
        setIsPlaying(false);
      }
      return;
    }

    let targetChunkIndex = allChunks.length - 1;
    for (let i = 0; i < allChunks.length; i++) {
      const start = chunkStartOffsets[i] || 0;
      const end = i + 1 < allChunks.length ? (chunkStartOffsets[i + 1] || total) : total;
      if (clamped >= start && clamped < end) {
        targetChunkIndex = i;
        break;
      }
    }

    const targetChunkStart = chunkStartOffsets[targetChunkIndex] || 0;
    const localSeconds = Math.max(0, clamped - targetChunkStart);
    const localMs = localSeconds * 1000;

    if (targetChunkIndex === currentChunkIndex) {
      await videoRef.current.setPositionAsync(localMs);
      if (shouldResume) {
        await videoRef.current.playAsync();
        setIsPlaying(true);
      } else {
        await videoRef.current.pauseAsync();
        setIsPlaying(false);
      }
      return;
    }

    pendingSeekMsRef.current = localMs;
    pendingSeekResumeRef.current = shouldResume;
    setCurrentChunkIndex(targetChunkIndex);
    setPreviewUri(allChunks[targetChunkIndex].filePath);
    setIsPlaying(shouldResume);
  };

  const getSeekTargetSeconds = (locationX: number): number => {
    const total = globalDuration > 0 ? globalDuration : videoDuration;
    const width = progressTrackWidthRef.current;
    if (total <= 0 || width <= 0) return 0;
    const ratio = Math.max(0, Math.min(locationX / width, 1));
    return ratio * total;
  };

  const getLocalRecordings = async (): Promise<LocalRecording[]> => {
    try {
      const saved = await AsyncStorage.getItem('xow_local_recordings');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  };

  const openPreview = async (recording: CombinedRecording) => {
    if (recording.source === 'local') {
      const localRec = recording as LocalRecording;
      
      // Handle chunked recordings - set up sequential playback
      if (localRec.isChunked && localRec.videoChunks && localRec.videoChunks.length > 0) {
        try {
          console.log(`Opening chunked recording with ${localRec.videoChunks.length} chunks (total: ${localRec.duration}s)`);
          
          // Sort chunks by index
          const sortedChunks = [...localRec.videoChunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
          
          // Verify first chunk exists
          const firstChunk = sortedChunks[0];
          const fileInfo = await FileSystem.getInfoAsync(firstChunk.filePath);
          
          if (fileInfo.exists) {
            // Set up for sequential chunk playback
            setAllChunks(sortedChunks);
            setCurrentChunkIndex(0);
            setIsChunkedPlayback(true);
            const offsets: number[] = [];
            let acc = 0;
            for (const chunk of sortedChunks) {
              offsets.push(acc);
              acc += chunk.duration || 0;
            }
            setChunkStartOffsets(offsets);
            setPreviewUri(firstChunk.filePath);
            setVideoPosition(0);
            setVideoDuration(0);
            setGlobalDuration(localRec.duration || Math.floor(acc));
            setIsPlaying(true);
            setVideoHasEnded(false);
            
            const totalMinutes = Math.floor(localRec.duration / 60);
            const totalSeconds = localRec.duration % 60;
            setPreviewTitle(`${fmtDate(localRec.createdAt)} (${totalMinutes}m ${totalSeconds}s total)`);
            setVideoFps(localRec.fps || 30);
            setPreviewFpsTimeline(localRec.fpsTimeline || []);
            setPreviewVisible(true);
          } else {
            Alert.alert('File Not Found', 'The video chunk could not be found.');
          }
        } catch (e) {
          console.error('Error opening chunked preview:', e);
          Alert.alert('Error', 'Could not open video preview.');
        }
      } else if (localRec.videoPath) {
        // Handle non-chunked recordings
        try {
          // content:// SAF URIs cannot be checked with getInfoAsync — play directly
          if (localRec.videoPath.startsWith('content://')) {
            setPreviewUri(localRec.videoPath);
            setPreviewTitle(fmtDate(localRec.createdAt));
            setVideoFps(localRec.fps || 30);
            setPreviewFpsTimeline(localRec.fpsTimeline || []);
            setGlobalDuration(localRec.duration || 0);
            setIsChunkedPlayback(false);
            setChunkStartOffsets([]);
            setIsPlaying(true);
            setPreviewVisible(true);
          } else {
            const fileInfo = await FileSystem.getInfoAsync(localRec.videoPath);
            if (fileInfo.exists) {
              setPreviewUri(localRec.videoPath);
              setPreviewTitle(fmtDate(localRec.createdAt));
              setVideoFps(localRec.fps || 30);
              setPreviewFpsTimeline(localRec.fpsTimeline || []);
              setGlobalDuration(localRec.duration || 0);
              setIsChunkedPlayback(false);
              setChunkStartOffsets([]);
              setIsPlaying(true);
              setPreviewVisible(true);
            } else {
              Alert.alert('File Not Found', 'Video file does not exist.');
            }
          }
        } catch (e) {
          console.log('Error checking video file:', e);
          Alert.alert('Error', 'Could not access the video file.');
        }
      } else {
        Alert.alert('No Video', 'This recording does not have a video.');
      }
    } else {
      const cloudRec = recording as CloudRecording;
      if (cloudRec.has_video) {
        const videoUrl = `${API_URL}/api/recordings/${cloudRec.id}/video`;
        setPreviewUri(videoUrl);
        setPreviewTitle(fmtDate(cloudRec.start_time));
        setVideoFps(30);
        setPreviewFpsTimeline([]);
        setGlobalDuration((recording as CloudRecording).duration || 0);
        setIsChunkedPlayback(false);
        setChunkStartOffsets([]);
        setIsPlaying(true);
        setPreviewVisible(true);
      } else {
        Alert.alert('No Video', 'This cloud recording does not have a video.');
      }
    }
  };

  const closePreview = () => {
    setPreviewVisible(false);
    setPreviewUri(null);
    setVideoPosition(0);
    setVideoDuration(0);
    setGlobalDuration(0);
    setIsPlaying(false);
    setPreviewFpsTimeline([]);
    setVideoHasEnded(false);
    
    // Reset chunked playback state
    setIsChunkedPlayback(false);
    setAllChunks([]);
    setCurrentChunkIndex(0);
    setChunkStartOffsets([]);
    
    if (videoRef.current) {
      videoRef.current.stopAsync();
    }
  };

  const replayVideo = async () => {
    setVideoHasEnded(false);
    await seekToGlobalSeconds(0, true);
  };

  const togglePlayPause = async () => {
    if (!videoRef.current) return;
    try {
      if (isPlaying) {
        await videoRef.current.pauseAsync();
        setIsPlaying(false);
      } else {
        await videoRef.current.playAsync();
        setIsPlaying(true);
      }
    } catch (e) {
      console.log('Play/pause error:', e);
    }
  };

  const handlePlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      if (pendingSeekMsRef.current !== null && videoRef.current) {
        const ms = pendingSeekMsRef.current;
        pendingSeekMsRef.current = null;
        const resume = pendingSeekResumeRef.current;
        pendingSeekResumeRef.current = null;
        videoRef.current
          .setPositionAsync(ms)
          .then(async () => {
            if (resume === true) {
              await videoRef.current?.playAsync();
              setIsPlaying(true);
            } else if (resume === false) {
              await videoRef.current?.pauseAsync();
              setIsPlaying(false);
            }
          })
          .catch((e: any) => {
            console.log('Pending seek apply error:', e?.message || e);
          });
      }

      if (isSeeking) {
        return;
      }

      const positionSeconds = status.positionMillis / 1000;
      const baseOffset = isChunkedPlayback ? (chunkStartOffsets[currentChunkIndex] || 0) : 0;
      const mergedPosition = baseOffset + positionSeconds;
      setVideoPosition(mergedPosition);
      if (status.durationMillis) {
        const currentChunkDuration = status.durationMillis / 1000;
        setVideoDuration(isChunkedPlayback ? globalDuration : currentChunkDuration);
        if (!isChunkedPlayback && globalDuration <= 0) {
          setGlobalDuration(currentChunkDuration);
        }
      }

      // Check if video has ended
      if (status.didJustFinish) {
        setVideoHasEnded(true);
        
        // If chunked playback, load next chunk automatically
        if (isChunkedPlayback && allChunks.length > 0) {
          const nextIndex = currentChunkIndex + 1;
          if (nextIndex < allChunks.length) {
            console.log(`Auto-playing next chunk: ${nextIndex + 1}/${allChunks.length}`);
            const nextChunk = allChunks[nextIndex];
            setCurrentChunkIndex(nextIndex);
            setPreviewUri(nextChunk.filePath);
            setVideoHasEnded(false);
            setIsPlaying(true);
          } else {
            console.log('All chunks played');
            setIsPlaying(false);
          }
        }
      }

      if (previewFpsTimeline.length > 0) {
        const secondIndex = Math.min(
          Math.floor(mergedPosition),
          previewFpsTimeline.length - 1
        );
        const fpsAtSecond = previewFpsTimeline[secondIndex];
        if (typeof fpsAtSecond === 'number' && fpsAtSecond > 0) {
          setVideoFps(fpsAtSecond);
        }
      }
    }
  };

  const formatTC = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const frames = Math.floor((s % 1) * videoFps);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  };

  const displayPosition = isSeeking && dragSeekSecondsRef.current !== null ? dragSeekSecondsRef.current : videoPosition;
  const previewTotalDuration = globalDuration || videoDuration;
  const progressRatio = previewTotalDuration > 0 ? Math.min(displayPosition / previewTotalDuration, 1) : 0;

  const uploadToCloud = async (recording: LocalRecording) => {
    if (!deviceId) return;

    setUploadingId(recording.localId);
    setUploadProgress(0);

    const resumeKey = `xow_upload_${recording.localId}`;

    try {
      // ── Resume detection ──────────────────────────────────────────────────
      let recordingId: string;
      let videoStartChunk = 0;

      const savedResume = await AsyncStorage.getItem(resumeKey);
      const resumeState = savedResume ? JSON.parse(savedResume) : null;

      if (resumeState?.recordingId && resumeState.nextChunk > 0) {
        // Verify the recording still exists on the server
        try {
          await axios.get(`${API_URL}/api/recordings/${resumeState.recordingId}`, { timeout: 8000 });
          recordingId = resumeState.recordingId;
          videoStartChunk = resumeState.nextChunk;
          console.log(`Resuming upload from chunk ${videoStartChunk}`);
        } catch {
          // Server recording gone — start fresh
          recordingId = '';
          videoStartChunk = 0;
        }
      } else {
        recordingId = '';
      }

      if (!recordingId) {
        const res = await axios.post(`${API_URL}/api/recordings`, {
          device_id: deviceId,
          expo_name: 'Expo 2025',
          booth_name: recording.boothName,
          start_time: recording.createdAt,   // preserve actual recording time
          duration: recording.duration,       // preserve actual recording duration
        });
        recordingId = res.data.id;
      }

      // ── Chunked video upload ──────────────────────────────────────────────
      if (recording.videoPath) {
        // content:// SAF URIs need to be copied to a temp file:// path first
        let uploadVideoPath = recording.videoPath;
        let tempVideoPath: string | null = null;
        if (recording.videoPath.startsWith('content://')) {
          const ext = recording.videoPath.toLowerCase().endsWith('.mov') ? 'mov' : 'mp4';
          tempVideoPath = `${FileSystem.cacheDirectory}xow_upload_tmp.${ext}`;
          await FileSystem.copyAsync({ from: recording.videoPath, to: tempVideoPath });
          uploadVideoPath = tempVideoPath;
        }

        const fileInfo = await FileSystem.getInfoAsync(uploadVideoPath);
        if (fileInfo.exists) {
          const fileSize = (fileInfo as any).size as number;
          const isMovFile = uploadVideoPath.toLowerCase().endsWith('.mov');
          const mimeType = isMovFile ? 'video/quicktime' : 'video/mp4';
          const totalChunks = Math.max(1, Math.ceil(fileSize / CHUNK_SIZE));

          console.log(`Video upload: ${fileSize} bytes → ${totalChunks} chunks of ${CHUNK_SIZE} bytes`);

          for (let i = videoStartChunk; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const length = Math.min(CHUNK_SIZE, fileSize - start);

            // Read chunk as base64
            const chunkBase64 = await FileSystem.readAsStringAsync(uploadVideoPath, {
              encoding: FileSystem.EncodingType.Base64,
              position: start,
              length,
            });

            // Write to a temp file so uploadAsync can send it as multipart
            const tempPath = `${FileSystem.cacheDirectory}xow_chunk_${i}.tmp`;
            await FileSystem.writeAsStringAsync(tempPath, chunkBase64, {
              encoding: FileSystem.EncodingType.Base64,
            });

            const uploadResult = await FileSystem.uploadAsync(
              `${API_URL}/api/recordings/${recordingId}/upload-video`,
              tempPath,
              {
                fieldName: 'video',
                httpMethod: 'POST',
                uploadType: FileSystem.FileSystemUploadType.MULTIPART,
                mimeType,
                parameters: {
                  chunk_index: String(i),
                  total_chunks: String(totalChunks),
                },
              }
            );

            // Delete temp chunk file immediately
            await FileSystem.deleteAsync(tempPath, { idempotent: true });

            if (uploadResult.status < 200 || uploadResult.status >= 300) {
              throw new Error(`Chunk ${i + 1}/${totalChunks} upload failed (HTTP ${uploadResult.status})`);
            }

            // Update progress and save resume state
            // Cap at 0.99 so 100% only shows when everything (audio, barcodes, complete) is truly done
            const progress = Math.min((i + 1) / totalChunks, 0.99);
            setUploadProgress(progress);
            await AsyncStorage.setItem(resumeKey, JSON.stringify({
              recordingId,
              nextChunk: i + 1,
              totalChunks,
            }));

            console.log(`Chunk ${i + 1}/${totalChunks} uploaded (${Math.round(progress * 100)}%)`);
          }
        }
        // Clean up temp video file if we created one
        if (tempVideoPath) {
          await FileSystem.deleteAsync(tempVideoPath, { idempotent: true }).catch(() => {});
        }
      }

      // ── Audio upload (small file — single request is fine) ────────────────────
      if (recording.audioPath) {
        let uploadAudioPath = recording.audioPath;
        let tempAudioPath: string | null = null;
        if (recording.audioPath.startsWith('content://')) {
          tempAudioPath = `${FileSystem.cacheDirectory}xow_upload_audio.m4a`;
          await FileSystem.copyAsync({ from: recording.audioPath, to: tempAudioPath });
          uploadAudioPath = tempAudioPath;
        }
        const fileInfo = await FileSystem.getInfoAsync(uploadAudioPath);
        if (fileInfo.exists) {
          const uploadResult = await FileSystem.uploadAsync(
            `${API_URL}/api/recordings/${recordingId}/upload-audio`,
            uploadAudioPath,
            {
              fieldName: 'audio',
              httpMethod: 'POST',
              uploadType: FileSystem.FileSystemUploadType.MULTIPART,
              mimeType: 'audio/m4a',
            }
          );
          if (uploadResult.status < 200 || uploadResult.status >= 300) {
            throw new Error(`Audio upload failed (HTTP ${uploadResult.status})`);
          }
        }
        if (tempAudioPath) {
          await FileSystem.deleteAsync(tempAudioPath, { idempotent: true }).catch(() => {});
        }
      }

      // ── Visitor frames (1-per-minute snapshots for AI head count) ────────
      if (recording.capturedFrames && recording.capturedFrames.length > 0) {
        for (let i = 0; i < recording.capturedFrames.length; i++) {
          const framePath = recording.capturedFrames[i];
          try {
            const frameInfo = await FileSystem.getInfoAsync(framePath);
            if (frameInfo.exists) {
              await FileSystem.uploadAsync(
                `${API_URL}/api/recordings/${recordingId}/upload-frame`,
                framePath,
                {
                  fieldName: 'frame',
                  httpMethod: 'POST',
                  uploadType: FileSystem.FileSystemUploadType.MULTIPART,
                  mimeType: 'image/jpeg',
                  parameters: { frame_index: String(i) },
                }
              );
              console.log(`Visitor frame ${i + 1}/${recording.capturedFrames.length} uploaded`);
            }
          } catch (e) {
            console.log(`Visitor frame ${i} upload skipped:`, e);
          }
        }
      }

      // ── Barcode scans ─────────────────────────────────────────────────────
      for (const scan of recording.barcodeScansList || []) {
        try {
          await axios.post(`${API_URL}/api/barcodes`, {
            recording_id: recordingId,
            barcode_data: scan.barcode_data,
            video_timestamp: scan.video_timestamp,
            frame_code: scan.frame_code,
          });
        } catch {}
      }

      // ── Mark complete ─────────────────────────────────────────────────────
      await axios.put(`${API_URL}/api/recordings/${recordingId}/complete`, {
        duration: recording.duration,   // send actual duration to prevent server recalculation
      });

      // Clear resume state
      await AsyncStorage.removeItem(resumeKey);

      // Mark local recording as uploaded
      const localRecordings = await getLocalRecordings();
      const idx = localRecordings.findIndex(r => r.localId === recording.localId);
      if (idx !== -1) {
        localRecordings[idx].id = recordingId;
        localRecordings[idx].isUploaded = true;
        await AsyncStorage.setItem('xow_local_recordings', JSON.stringify(localRecordings));
      }

      // Set 100% immediately before the alert so user sees the transition 99% → 100% → Alert
      setUploadProgress(1);
      Alert.alert('Upload Complete', 'Recording uploaded to cloud successfully!');
      fetchRecordings();
    } catch (e: any) {
      console.error('Upload error:', e);
      Alert.alert(
        'Upload Failed',
        `${e?.message || 'Failed to upload'}\n\nTap Upload again to resume.`
      );
    } finally {
      setUploadingId(null);
      setUploadProgress(0);
    }
  };

  const handleDelete = (item: CombinedRecording) => {
    const isLocal = item.source === 'local';
    const itemId = isLocal ? (item as LocalRecording).localId : item.id;
    const dateStr = isLocal ? fmtDate((item as LocalRecording).createdAt) : fmtDate((item as CloudRecording).start_time);
    
    Alert.alert(
      'Delete Recording',
      `Delete ${isLocal ? 'local' : 'cloud'} recording from ${dateStr}?\n\n${isLocal ? 'This will remove the local files.' : 'This will remove all data including AI analysis.'}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(itemId);
            try {
              if (isLocal) {
                // Delete local files
                const localRec = item as LocalRecording;
                if (localRec.videoPath) {
                  try {
                    await FileSystem.deleteAsync(localRec.videoPath, { idempotent: true });
                  } catch {}
                }
                if (localRec.audioPath) {
                  try {
                    await FileSystem.deleteAsync(localRec.audioPath, { idempotent: true });
                  } catch {}
                }
                
                // Remove from local storage
                const localRecordings = await getLocalRecordings();
                const filtered = localRecordings.filter(r => r.localId !== localRec.localId);
                await AsyncStorage.setItem('xow_local_recordings', JSON.stringify(filtered));
              } else {
                // Delete from cloud
                await axios.delete(`${API_URL}/api/recordings/${item.id}`);
              }
              
              setRecordings(prev => prev.filter(r => 
                r.source === 'local' 
                  ? (r as LocalRecording).localId !== itemId 
                  : r.id !== itemId
              ));
            } catch (e) {
              Alert.alert('Error', 'Failed to delete recording');
            } finally {
              setDeletingId(null);
            }
          }
        }
      ]
    );
  };

  const handleReprocess = async (item: CloudRecording) => {
    try {
      await axios.post(`${API_URL}/api/recordings/${item.id}/reprocess`);
      Alert.alert('Reprocessing', 'AI analysis has started. Refresh to see results.');
      fetchRecordings();
    } catch (e) {
      Alert.alert('Error', 'Failed to start reprocessing');
    }
  };

  const fmtDur = (s?: number) => {
    if (!s) return '--:--';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const statusConfig: Record<string, { color: string; icon: string; label: string }> = {
    local: { color: '#F59E0B', icon: 'save', label: 'Local' },
    recording: { color: '#EF4444', icon: 'radio-button-on', label: 'Recording' },
    completed: { color: '#F59E0B', icon: 'checkmark-circle', label: 'Completed' },
    uploaded: { color: '#3B82F6', icon: 'cloud-done', label: 'Uploaded' },
    processing: { color: '#E54B2A', icon: 'hourglass', label: 'Processing' },
    processed: { color: '#10B981', icon: 'sparkles', label: 'AI Ready' },
    error: { color: '#EF4444', icon: 'alert-circle', label: 'Error' },
  };

  const getStatusConfig = (item: CombinedRecording) => {
    if (item.source === 'local') return statusConfig.local;
    return statusConfig[(item as CloudRecording).status] || { color: '#666', icon: 'help-circle', label: 'Unknown' };
  };

  const filterRecordings = (items: CombinedRecording[]) => {
    if (viewMode === 'all') return items;
    if (viewMode === 'local') return items.filter(r => r.source === 'local');
    return items.filter(r => r.source === 'cloud');
  };

  const sidebarWidth = Math.min(90, width * 0.12);

  const renderItem = ({ item }: { item: CombinedRecording }) => {
    const config = getStatusConfig(item);
    const isLocal = item.source === 'local';
    const localItem = item as LocalRecording;
    const cloudItem = item as CloudRecording;
    const itemId = isLocal ? localItem.localId : item.id;
    const dateStr = isLocal ? localItem.createdAt : cloudItem.start_time;
    const duration = isLocal ? localItem.duration : cloudItem.duration;
    const hasVideo = isLocal ? !!localItem.videoPath : cloudItem.has_video;
    const hasAudio = isLocal ? !!localItem.audioPath : cloudItem.has_audio;
    const barcodeCount = isLocal ? (localItem.barcodeScansList?.length || 0) : (cloudItem.barcode_scans?.length || 0);
    // For cloud recordings, prefer AI-detected head count; fall back to barcode scans count
    const visitorCount = isLocal
      ? barcodeCount
      : (cloudItem.head_count && cloudItem.head_count > 0 ? cloudItem.head_count : barcodeCount);
    const summaryText = !isLocal ? (cloudItem.overall_summary || cloudItem.summary) : null;

    return (
      <View style={styles.card}>
        {/* Header Row */}
        <View style={styles.cardHeader}>
          <View style={styles.dateSection}>
            <Text style={styles.cardDate}>{dateStr ? fmtDate(dateStr) : 'Unknown date'}</Text>
            <Text style={styles.cardDuration}>{fmtDur(duration)}</Text>
          </View>
          <View style={styles.cardActions}>
            {/* Preview Button — local videos + uploaded cloud videos */}
            {(isLocal && hasVideo) || (!isLocal && cloudItem.has_video) ? (
              <TouchableOpacity
                style={styles.previewBtn}
                onPress={() => openPreview(item)}
              >
                <Ionicons name="play-circle" size={26} color="#E54B2A" />
                <Text style={styles.previewBtnText}>Preview</Text>
              </TouchableOpacity>
            ) : null}
            {!isLocal && cloudItem.status === 'error' && (
              <TouchableOpacity style={styles.reprocessBtn} onPress={() => handleReprocess(cloudItem)}>
                <Ionicons name="refresh" size={21} color="#F59E0B" />
              </TouchableOpacity>
            )}
            {isLocal && (
              <TouchableOpacity
                style={styles.uploadBtn}
                onPress={() => uploadToCloud(localItem)}
                disabled={uploadingId === localItem.localId || autoUploadingId === localItem.localId}
              >
                {(uploadingId === localItem.localId || autoUploadingId === localItem.localId) ? (
                  (() => {
                    const prog = uploadingId === localItem.localId ? uploadProgress : autoUploadProgress;
                    return prog > 0 ? (
                      <Text style={[styles.uploadBtnText, { color: '#10B981' }]}>
                        {Math.round(prog * 100)}%
                      </Text>
                    ) : (
                      <ActivityIndicator size="small" color="#10B981" />
                    );
                  })()
                ) : (
                  <>
                    <Ionicons name="cloud-upload" size={23} color="#10B981" />
                    <Text style={styles.uploadBtnText}>Upload</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => handleDelete(item)}
              disabled={deletingId === itemId}
            >
              {deletingId === itemId ? (
                <ActivityIndicator size="small" color="#EF4444" />
              ) : (
                <Ionicons name="trash" size={23} color="#EF4444" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Media & Status Row */}
        <View style={styles.mediaRow}>
          <View style={styles.mediaIcons}>
            <View style={[styles.mediaBadge, hasVideo && styles.mediaBadgeActive]}>
              <Ionicons name="videocam" size={18} color={hasVideo ? '#10B981' : '#444'} />
            </View>
            <View style={[styles.mediaBadge, hasAudio && styles.mediaBadgeActive]}>
              <Ionicons name="mic" size={18} color={hasAudio ? '#10B981' : '#444'} />
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: `${config.color}20` }]}>
            <Ionicons name={config.icon as any} size={18} color={config.color} />
            <Text style={[styles.statusText, { color: config.color }]}>{config.label}</Text>
          </View>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Ionicons name="people" size={21} color="#E54B2A" />
            <Text style={styles.statText}>{String(visitorCount || 0)} visitors</Text>
            {!isLocal && cloudItem.head_count != null && cloudItem.head_count > 0 && (
              <View style={styles.aiDetectedBadge}>
                <Text style={styles.aiDetectedText}>AI</Text>
              </View>
            )}
          </View>
          {!isLocal && cloudItem.total_speakers != null && cloudItem.total_speakers > 0 && (
            <View style={styles.stat}>
              <Ionicons name="chatbubbles" size={21} color="#10B981" />
              <Text style={styles.statText}>{String(cloudItem.total_speakers)} speakers</Text>
            </View>
          )}
          {!isLocal && cloudItem.host_identified === true && (
            <View style={styles.hostBadge}>
              <Text style={styles.hostText}>HOST ID</Text>
            </View>
          )}
          {isLocal && (
            <View style={styles.localBadge}>
              <Text style={styles.localBadgeText}>NOT UPLOADED</Text>
            </View>
          )}
        </View>

        {/* Summary (cloud only) */}
        {summaryText != null && summaryText !== '' && (
          <View style={styles.summarySection}>
            <Ionicons name="sparkles" size={10} color="#E54B2A" />
            <Text style={styles.summary} numberOfLines={2}>{summaryText}</Text>
          </View>
        )}
      </View>
    );
  };

  const filteredRecordings = filterRecordings(recordings);
  const localCount = recordings.filter(r => r.source === 'local').length;
  const cloudCount = recordings.filter(r => r.source === 'cloud').length;
  const totalRecordingsDuration = recordings.reduce((acc, r) => {
    const dur = r.source === 'local' ? (r as LocalRecording).duration : ((r as CloudRecording).duration || 0);
    return acc + dur;
  }, 0);

  return (
    <View style={[styles.container, { width, height }]}>
      {/* Sidebar */}
      <View style={[styles.sidebar, { width: sidebarWidth }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>

        <View style={styles.sideStats}>
          <View style={styles.sideStat}>
            <Text style={styles.sideStatNum}>{recordings.length}</Text>
            <Text style={styles.sideStatLabel}>Total</Text>
          </View>
          <View style={styles.sideStat}>
            <Text style={[styles.sideStatNum, { color: '#F59E0B' }]}>{localCount}</Text>
            <Text style={styles.sideStatLabel}>Local</Text>
          </View>
          <View style={styles.sideStat}>
            <Text style={[styles.sideStatNum, { color: '#10B981' }]}>{cloudCount}</Text>
            <Text style={styles.sideStatLabel}>Cloud</Text>
          </View>
          <View style={styles.sideStat}>
            <Text style={[styles.sideStatNum, { color: '#E54B2A', fontSize: 14 }]}>{fmtDur(totalRecordingsDuration)}</Text>
            <Text style={styles.sideStatLabel}>Duration</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.refreshBtn} onPress={() => { setRefreshing(true); fetchRecordings(); }}>
          <Ionicons name="refresh" size={18} color="#E54B2A" />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Recordings</Text>
          <Text style={styles.headerSub}>View, preview and upload your recordings</Text>
        </View>

        {/* Filter Tabs */}
        <View style={styles.filterTabs}>
          <TouchableOpacity
            style={[styles.filterTab, viewMode === 'all' && styles.filterTabActive]}
            onPress={() => setViewMode('all')}
          >
            <Text style={[styles.filterTabText, viewMode === 'all' && styles.filterTabTextActive]}>All ({recordings.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterTab, viewMode === 'local' && styles.filterTabActive]}
            onPress={() => setViewMode('local')}
          >
            <Ionicons name="save" size={12} color={viewMode === 'local' ? '#E54B2A' : '#666'} />
            <Text style={[styles.filterTabText, viewMode === 'local' && styles.filterTabTextActive]}>Local ({localCount})</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterTab, viewMode === 'cloud' && styles.filterTabActive]}
            onPress={() => setViewMode('cloud')}
          >
            <Ionicons name="cloud" size={12} color={viewMode === 'cloud' ? '#E54B2A' : '#666'} />
            <Text style={[styles.filterTabText, viewMode === 'cloud' && styles.filterTabTextActive]}>Cloud ({cloudCount})</Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#E54B2A" size="large" />
            <Text style={styles.loadingText}>Loading recordings...</Text>
          </View>
        ) : filteredRecordings.length === 0 ? (
          <View style={styles.center}>
            <View style={styles.emptyIcon}>
              <Ionicons name="videocam-off" size={40} color="#333" />
            </View>
            <Text style={styles.emptyTitle}>
              {viewMode === 'local' ? 'No Local Recordings' : viewMode === 'cloud' ? 'No Cloud Recordings' : 'No Recordings Yet'}
            </Text>
            <Text style={styles.emptyText}>
              {viewMode === 'local' 
                ? 'Local recordings will appear here after recording'
                : viewMode === 'cloud'
                  ? 'Upload local recordings to see them in the cloud'
                  : 'Start recording to capture booth conversations'}
            </Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => router.back()}>
              <Ionicons name="videocam" size={16} color="#fff" />
              <Text style={styles.emptyBtnText}>Start Recording</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={filteredRecordings}
            renderItem={renderItem}
            keyExtractor={item => item.source === 'local' ? (item as LocalRecording).localId : item.id}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); fetchRecordings(); }}
                tintColor="#E54B2A"
              />
            }
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {/* Video Preview Modal */}
      <Modal
        visible={previewVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={closePreview}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{previewTitle}</Text>
                <TouchableOpacity style={styles.closeBtn} onPress={closePreview}>
                  <Ionicons name="close" size={24} color="#fff" />
                </TouchableOpacity>
              </View>

              <View style={styles.videoContainer}>
                {previewUri && (
                  <Video
                    key={previewUri}
                    {...{ ref: videoRef }}
                    source={{ uri: previewUri }}
                    style={styles.videoPlayer}
                    useNativeControls={false}
                    resizeMode={ResizeMode.CONTAIN}
                    shouldPlay={isPlaying}
                    isLooping={false}
                    onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
                  />
                )}
                
                {/* Left-side overlay with Timecode and FPS */}
                <View style={styles.videoOverlay}>
                  <View style={styles.overlayLogo}>
                    <Ionicons name="videocam" size={12} color="#fff" />
                    <Text style={styles.overlayLogoText}>XoW</Text>
                  </View>
                  <View style={styles.overlayDivider} />
                  <View style={styles.overlayBlock}>
                    <Text style={styles.overlayLabel}>TIMECODE</Text>
                    <Text style={styles.overlayTCValue}>{formatTC(videoPosition)}</Text>
                  </View>
                  <View style={styles.overlayDivider} />
                  <View style={styles.overlayBlock}>
                    <Text style={styles.overlayLabel}>FPS</Text>
                    <Text style={styles.overlayFPSValue}>{videoFps}</Text>
                  </View>
                </View>

                {/* Replay button - shown when video ends */}
                {videoHasEnded && (
                  <TouchableOpacity style={styles.replayButton} onPress={replayVideo}>
                    <Ionicons name="refresh" size={32} color="#fff" />
                    <Text style={styles.replayText}>Replay</Text>
                  </TouchableOpacity>
                )}

                <View style={styles.controlsBar}>
                  <TouchableOpacity style={styles.controlPlayBtn} onPress={togglePlayPause}>
                    <Ionicons name={isPlaying ? 'pause' : 'play'} size={18} color="#fff" />
                  </TouchableOpacity>
                  <Text style={styles.controlTimeText}>{formatTC(displayPosition)}</Text>
                  <View
                    style={styles.progressTrack}
                    onLayout={(e) => {
                      progressTrackWidthRef.current = e.nativeEvent.layout.width;
                    }}
                    onStartShouldSetResponder={() => true}
                    onMoveShouldSetResponder={() => true}
                    onResponderGrant={(e) => {
                      wasPlayingBeforeSeekRef.current = isPlaying;
                      const target = getSeekTargetSeconds(e.nativeEvent.locationX);
                      dragSeekSecondsRef.current = target;
                      setVideoPosition(target);
                      setVideoHasEnded(false);
                      setIsSeeking(true);
                    }}
                    onResponderMove={(e) => {
                      const target = getSeekTargetSeconds(e.nativeEvent.locationX);
                      dragSeekSecondsRef.current = target;
                      setVideoPosition(target);
                    }}
                    onResponderRelease={async () => {
                      const target = dragSeekSecondsRef.current;
                      dragSeekSecondsRef.current = null;
                      setIsSeeking(false);
                      if (typeof target === 'number') {
                        await seekToGlobalSeconds(target, wasPlayingBeforeSeekRef.current);
                      }
                    }}
                  >
                    <View style={[styles.progressFill, { width: `${progressRatio * 100}%` }]} />
                    <View style={[styles.progressThumb, { left: `${progressRatio * 100}%` }]} />
                  </View>
                  <Text style={styles.controlTimeText}>{formatTC(previewTotalDuration)}</Text>
                </View>
              </View>
            </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: '#000' },

  // Sidebar
  sidebar: { backgroundColor: '#0a0a0a', borderRightWidth: 1, borderRightColor: '#1a1a1a', padding: 12, alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 60, height: 60, borderRadius: 12, backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' },
  sideStats: { alignItems: 'center', gap: 26 },
  sideStat: { alignItems: 'center' },
  sideStatNum: { color: '#E54B2A', fontSize: 32, fontWeight: '800' },
  sideStatLabel: { color: '#555', fontSize: 16, marginTop: 4 },
  refreshBtn: { width: 60, height: 60, borderRadius: 12, backgroundColor: 'rgba(229,75,42,0.15)', justifyContent: 'center', alignItems: 'center' },

  // Content
  content: { flex: 1 },
  header: { padding: 24, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle: { color: '#fff', fontSize: 28, fontWeight: '700' },
  headerSub: { color: '#555', fontSize: 18, marginTop: 4 },

  // Filter Tabs
  filterTabs: { flexDirection: 'row', padding: 16, gap: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  filterTab: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, backgroundColor: '#111' },
  filterTabActive: { backgroundColor: 'rgba(229,75,42,0.2)', borderWidth: 1, borderColor: '#E54B2A' },
  filterTabText: { color: '#666', fontSize: 19, fontWeight: '500' },
  filterTabTextActive: { color: '#E54B2A' },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 36 },
  loadingText: { color: '#555', fontSize: 22, marginTop: 20 },

  // Empty State
  emptyIcon: { width: 140, height: 140, borderRadius: 70, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', marginBottom: 28 },
  emptyTitle: { color: '#fff', fontSize: 28, fontWeight: '600' },
  emptyText: { color: '#555', fontSize: 20, marginTop: 8, textAlign: 'center', maxWidth: 400 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: '#E54B2A', paddingHorizontal: 36, paddingVertical: 20, borderRadius: 12, marginTop: 36 },
  emptyBtnText: { color: '#fff', fontSize: 22, fontWeight: '600' },

  // List
  list: { padding: 18 },

  // Card
  card: { backgroundColor: '#0a0a0a', borderRadius: 14, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#1a1a1a' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  dateSection: { flex: 1 },
  cardDate: { color: '#fff', fontSize: 20, fontWeight: '600' },
  cardDuration: { color: '#666', fontSize: 18, marginTop: 4 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  previewBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: 'rgba(229,75,42,0.15)', borderRadius: 8 },
  previewBtnText: { color: '#E54B2A', fontSize: 18, fontWeight: '600' },
  reprocessBtn: { padding: 12, backgroundColor: 'rgba(245,158,11,0.15)', borderRadius: 8 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: 'rgba(16,185,129,0.15)', borderRadius: 8 },
  uploadBtnText: { color: '#10B981', fontSize: 18, fontWeight: '600' },
  deleteBtn: { padding: 12 },

  // Media Row
  mediaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  mediaIcons: { flexDirection: 'row', gap: 10 },
  mediaBadge: { width: 40, height: 40, borderRadius: 8, backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' },
  mediaBadgeActive: { backgroundColor: 'rgba(16,185,129,0.15)' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  statusText: { fontSize: 17, fontWeight: '600' },

  // Stats Row
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 16, flexWrap: 'wrap' },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statText: { color: '#888', fontSize: 18 },
  hostBadge: { backgroundColor: 'rgba(16,185,129,0.2)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 5 },
  hostText: { color: '#10B981', fontSize: 16, fontWeight: '700' },
  aiDetectedBadge: { backgroundColor: 'rgba(139,92,246,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 5, marginLeft: 8 },
  aiDetectedText: { color: '#8B5CF6', fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  localBadge: { backgroundColor: 'rgba(245,158,11,0.2)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 5 },
  localBadgeText: { color: '#F59E0B', fontSize: 16, fontWeight: '700' },

  // Summary
  summarySection: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  summary: { flex: 1, color: '#888', fontSize: 18, lineHeight: 26 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', maxWidth: 1105, maxHeight: '95%', backgroundColor: '#0a0a0a', borderRadius: 31, borderWidth: 1, borderColor: '#1a1a1a', flexDirection: 'column' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  modalTitle: { color: '#fff', fontSize: 22, fontWeight: '600' },
  closeBtn: { width: 73, height: 73, borderRadius: 13, backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' },
  
  // Video container and overlay
  videoContainer: { position: 'relative', width: '100%', backgroundColor: '#000' },
  videoPlayer: { width: '100%', aspectRatio: 16/9, backgroundColor: '#000' },
  videoOverlay: { position: 'absolute', top: 18, left: 18, backgroundColor: 'rgba(0,0,0,0.85)', paddingVertical: 13, paddingHorizontal: 16, borderRadius: 10, borderLeftWidth: 4, borderLeftColor: '#E54B2A', gap: 8 },
  overlayLogo: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 4 },
  overlayLogoText: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },
  overlayDivider: { height: 1, backgroundColor: '#333', marginVertical: 3 },
  overlayBlock: { gap: 3 },
  overlayLabel: { color: '#666', fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },
  overlayTCValue: { color: '#EF4444', fontSize: 22, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  overlayFPSValue: { color: '#E54B2A', fontSize: 22, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  // Replay button
  replayButton: { position: 'absolute', top: '50%', left: '50%', transform: [{ translateX: -98 }, { translateY: -98 }], width: 195, height: 195, borderRadius: 98, backgroundColor: 'rgba(229,75,42,0.95)', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 10 },
  replayText: { color: '#fff', fontSize: 25, fontWeight: '700', marginTop: 13, letterSpacing: 0.5 },
  controlsBar: { position: 'absolute', left: 18, right: 18, bottom: 80, backgroundColor: 'rgba(0,0,0,0.82)', borderRadius: 13, paddingHorizontal: 18, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 16 },
  controlPlayBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(229,75,42,0.85)', justifyContent: 'center', alignItems: 'center' },
  controlTimeText: { color: '#fff', fontSize: 18, fontWeight: '700', minWidth: 117, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  progressTrack: { flex: 1, height: 8, borderRadius: 5, backgroundColor: '#222', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#E54B2A' },
  progressThumb: { position: 'absolute', top: -5, marginLeft: -8, width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff' },
});
