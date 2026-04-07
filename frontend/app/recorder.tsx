import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Modal,
  Platform,
  KeyboardAvoidingView,
  Pressable,
  NativeModules,
  useWindowDimensions,
  Animated,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useAudioRecorder, RecordingPresets, AudioModule } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import axios from 'axios';
import {
  saveChunkMetadata,
  getSessionMetadata,
  saveChunkFile,
  getFileSize,
  markSessionComplete,
  cleanupOldSessions,
  CHUNK_CONFIG,
  type VideoChunk as ChunkType,
  type RecordingMetadata,
} from './utils/chunkRecording';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const EXTERNAL_STORAGE_URI_KEY = 'xow_external_storage_uri';

interface Device {
  id: string;
  device_id: string;
  name: string;
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
  capturedFrames?: string[];
  videoChunks?: ChunkType[];  // chunked video segments
  isChunked?: boolean;  // flag to indicate chunked recording
}

interface BarcodeData {
  barcode_data: string;
  video_timestamp: number;
  frame_code: number;
}

export default function RecorderScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const [device, setDevice] = useState<Device | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const isOnlineRef = useRef(true);
  const [isRecording, setIsRecording] = useState(false);
  const [currentRecording, setCurrentRecording] = useState<any>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [fps, setFps] = useState(0);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeCount, setBarcodeCount] = useState(0);
  const [barcodeScans, setBarcodeScans] = useState<BarcodeData[]>([]);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [videoRecordingActive, setVideoRecordingActive] = useState(false);
  const [autoUpload, setAutoUpload] = useState(false);
  const autoUploadRef = useRef(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [storageLocation, setStorageLocation] = useState<'Internal' | 'External'>('Internal');
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [recordingChunks, setRecordingChunks] = useState<ChunkType[]>([]);
  const toastAnim = useRef(new Animated.Value(0)).current;
  
  const cameraRef = useRef<CameraView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameCountRef = useRef(0);
  const lastFpsFrameRef = useRef(0);
  const latestFpsRef = useRef(0);
  const fpsSamplesRef = useRef<number[]>([]);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const storageWatchRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastExternalRef = useRef<string | null>(null);
  const recordingStartTime = useRef<number>(0);
  const barcodeInputRef = useRef<TextInput>(null);
  const videoUriRef = useRef<string | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const chunkStartTimeRef = useRef<number>(0);
  const isRecordingRef = useRef(false);
  const videoRecordingActiveRef = useRef(false);
  const currentChunkIndexRef = useRef(0);
  const recordingChunksRef = useRef<ChunkType[]>([]);
  const recordingTimeRef = useRef(0);
  const barcodeScansRef = useRef<BarcodeData[]>([]);
  const audioRecordingStartedRef = useRef(false);
  const barcodeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBarcodeRef = useRef<string>('');
  
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  useEffect(() => {
    loadDevice();
    loadSettings();
    checkPermissions();
    checkConnection();
    clockRef.current = setInterval(() => setCurrentTime(new Date()), 1000);
    const connInterval = setInterval(checkConnection, 10000);

    // Initial external storage check
    detectExternalStorage().then(ext => {
      if (ext) { lastExternalRef.current = ext; setStorageLocation('External'); }
    });
    // Start watching for USB/SD plug-unplug events every 3s
    startStorageWatcher();

    return () => {
      clearInterval(connInterval);
      if (timerRef.current) clearInterval(timerRef.current);
      if (frameTimerRef.current) clearInterval(frameTimerRef.current);
      if (fpsTimerRef.current) clearInterval(fpsTimerRef.current);
      if (clockRef.current) clearInterval(clockRef.current);
      if (storageWatchRef.current) clearInterval(storageWatchRef.current);
      if (barcodeDebounceRef.current) clearTimeout(barcodeDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    videoRecordingActiveRef.current = videoRecordingActive;
  }, [videoRecordingActive]);

  useEffect(() => {
    currentChunkIndexRef.current = currentChunkIndex;
  }, [currentChunkIndex]);

  useEffect(() => {
    recordingChunksRef.current = recordingChunks;
  }, [recordingChunks]);

  useEffect(() => {
    recordingTimeRef.current = recordingTime;
  }, [recordingTime]);

  useEffect(() => {
    barcodeScansRef.current = barcodeScans;
  }, [barcodeScans]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setToastVisible(true);
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2000),
      Animated.timing(toastAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setToastVisible(false));
  };

  const loadDevice = async () => {
    const device_id = await AsyncStorage.getItem('xow_permanent_device_id');
    const name      = await AsyncStorage.getItem('xow_permanent_device_name');
    if (device_id) {
      const d = { id: device_id, device_id, name: name || 'Booth' };
      setDevice(d);
      deviceRef.current = d;
    } else {
      router.replace('/');
    }
  };

  const loadSettings = async () => {
    try {
      const saved = await AsyncStorage.getItem('xow_settings');
      if (saved) {
        const settings = JSON.parse(saved);
        const value = settings.autoUpload || false;
        setAutoUpload(value);
        autoUploadRef.current = value;
      }
    } catch (e) {
      console.log('Load settings error:', e);
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      loadSettings();
    }, [])
  );

  const APP_PACKAGE = 'com.devcyboglabs.xowrecorder';
  const usbStorageModule = Platform.OS === 'android' ? NativeModules.UsbStorage : null;

  /**
   * Detect external storage (USB OTG / SD card).
   * Uses StorageManager.getStorageVolumes() as the single gate —
   * if no removable volume is mounted, returns null immediately.
   */
  const detectExternalStorage = async (): Promise<string | null> => {
    if (Platform.OS !== 'android') return null;
    try {
      // Gate: confirm a removable volume is physically present
      let volumes: Array<{ description: string }> = [];
      if (usbStorageModule?.getRemovableVolumes) {
        volumes = await usbStorageModule.getRemovableVolumes();
      }
      if (volumes.length === 0) return null;

      // Prefer native file:// path — supports direct FileSystem.copyAsync (no base64 OOM for large files)
      if (usbStorageModule?.getWritableExternalStoragePath) {
        const nativePath = await usbStorageModule.getWritableExternalStoragePath();
        if (nativePath) {
          console.log('External storage: native file:// path', nativePath);
          return nativePath;
        }
      }

      // Fall back to SAF content:// URI only if native path unavailable
      const grantedUri = await AsyncStorage.getItem(EXTERNAL_STORAGE_URI_KEY);
      if (grantedUri) return grantedUri;

      return null;
    } catch (e) {
      console.log('detectExternalStorage error:', e);
      return null;
    }
  };

  /** Watch for USB/SD card plug-unplug events and show toast on change. */
  const startStorageWatcher = () => {
    if (storageWatchRef.current) clearInterval(storageWatchRef.current);
    storageWatchRef.current = setInterval(async () => {
      const external = await detectExternalStorage();
      const prev = lastExternalRef.current;
      if (external && !prev) {
        lastExternalRef.current = external;
        setStorageLocation('External');
        showToast('External storage connected');
      } else if (!external && prev) {
        lastExternalRef.current = null;
        setStorageLocation('Internal');
        showToast('External storage removed');
      } else if (external) {
        lastExternalRef.current = external;
      }
    }, 3000);
  };

  /**
   * Returns the storage directory based on user preference in settings.
   * Falls back to auto-detection if preference not set or external storage unavailable.
   */
  const getStorageDir = async (): Promise<{ dir: string; label: string }> => {
    if (Platform.OS === 'android') {
      // Load user's storage preference from settings
      let preferredLocation: 'internal' | 'external' = 'internal';
      try {
        const saved = await AsyncStorage.getItem('xow_settings');
        if (saved) {
          const settings = JSON.parse(saved);
          preferredLocation = settings.storageLocation || 'internal';
        }
      } catch (e) {
        console.log('Failed to load storage preference:', e);
      }

      // If user prefers external storage, try to use it
      if (preferredLocation === 'external') {
        const external = await detectExternalStorage();
        if (external) {
          lastExternalRef.current = external;
          return { dir: external, label: 'External Storage' };
        }
        lastExternalRef.current = null;
        // External not available, fall back to internal with warning
        console.log('External storage preferred but not available, using internal');
        showToast('External storage not found, using internal');
      }

      // Use internal storage (either preferred or fallback)
      const internal = `file:///storage/emulated/0/Android/data/${APP_PACKAGE}/files/XoW`;
      await FileSystem.makeDirectoryAsync(internal, { intermediates: true }).catch(() => {});
      return { dir: internal, label: 'Internal Storage' };
    }
    // iOS
    const iosDir = `${FileSystem.documentDirectory}XoW`;
    await FileSystem.makeDirectoryAsync(iosDir, { intermediates: true }).catch(() => {});
    return { dir: iosDir, label: 'Internal Storage' };
  };

  const copyIntoStorage = async (sourceUri: string, targetDir: string, fileName: string, mimeType: string): Promise<string> => {
    if (targetDir.startsWith('content://')) {
      // SAF path — read whole file as base64 and write (only suitable for small files like audio)
      const targetFileUri = await FileSystem.StorageAccessFramework.createFileAsync(targetDir, fileName, mimeType);
      const base64 = await FileSystem.readAsStringAsync(sourceUri, { encoding: FileSystem.EncodingType.Base64 });
      await FileSystem.writeAsStringAsync(targetFileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
      return targetFileUri;
    }
    // Native file:// path — zero-copy, works for any file size
    const destination = `${targetDir}/${fileName}`;
    await FileSystem.copyAsync({ from: sourceUri, to: destination });
    return destination;
  };

  const checkPermissions = async () => {
    if (!cameraPermission?.granted) await requestCameraPermission();
    const audioStatus = await AudioModule.requestRecordingPermissionsAsync();
    if (!audioStatus.granted) {
      Alert.alert('Permission Required', 'Microphone access is needed for recording.');
    }
    // MediaLibrary permissions removed - causing config issues
    // Gallery save will still work via try-catch when saving videos
  };

  const checkConnection = async () => {
    try {
      await axios.get(`${API_URL}/api/health`, { timeout: 5000 });
      setIsOnline(true);
      isOnlineRef.current = true;
    } catch {
      setIsOnline(false);
      isOnlineRef.current = false;
    }
  };

  const formatTC = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const f = frameCount % 30;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
  };

  const formatDate = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const formatTime = (d: Date) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  /**
   * Save current chunk and start a new one
   * This is called automatically every CHUNK_DURATION_MS during recording
   */
  const rotateVideoChunk = async () => {
    if (!cameraRef.current || !videoRecordingActiveRef.current || !currentSessionIdRef.current || !isRecordingRef.current) {
      console.log('Chunk rotation skipped: camera not ready or not recording');
      return;
    }

    try {
      const activeChunkIndex = currentChunkIndexRef.current;
      const nextChunkIndex = activeChunkIndex + 1;
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) return;

      console.log(`🔄 Rotating to chunk ${nextChunkIndex}...`);

      // Stop current recording and wait for URI from recordAsync promise
      cameraRef.current.stopRecording();
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (!videoUriRef.current) {
        console.warn('No video URI available after stopping chunk');
        return;
      }

      const chunkEndTime = Date.now();
      const chunkDuration = (chunkEndTime - chunkStartTimeRef.current) / 1000;
      const baseDir = `${FileSystem.documentDirectory}chunks`;
      await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true }).catch(() => {});

      const savedPath = await saveChunkFile(
        videoUriRef.current,
        sessionId,
        activeChunkIndex,
        baseDir
      );

      const fileSize = await getFileSize(savedPath);
      const chunk: ChunkType = {
        chunkIndex: activeChunkIndex,
        filePath: savedPath,
        duration: chunkDuration,
        startTime: chunkStartTimeRef.current,
        endTime: chunkEndTime,
        fileSize,
      };

      const updatedChunks = [...recordingChunksRef.current, chunk];
      recordingChunksRef.current = updatedChunks;
      setRecordingChunks(updatedChunks);

      const metadata = await getSessionMetadata(sessionId);
      if (metadata) {
        metadata.chunks = updatedChunks;
        metadata.totalDuration = recordingTimeRef.current;
        metadata.barcodeScansList = barcodeScansRef.current;
        await saveChunkMetadata(metadata);
      }

      console.log(`✓ Chunk ${activeChunkIndex} saved: ${(fileSize / 1024 / 1024).toFixed(2)}MB`);
      showToast(`Chunk ${activeChunkIndex + 1} saved`);

      currentChunkIndexRef.current = nextChunkIndex;
      setCurrentChunkIndex(nextChunkIndex);

      // Start next chunk
      videoUriRef.current = null;
      chunkStartTimeRef.current = Date.now();
      if (cameraRef.current && isRecordingRef.current && videoRecordingActiveRef.current) {
        console.log(`Starting chunk ${nextChunkIndex} recording...`);
        cameraRef.current
          .recordAsync({ maxDuration: CHUNK_CONFIG.DURATION_SECONDS })
          .then((result) => {
            if (result?.uri) {
              videoUriRef.current = result.uri;
              console.log(`Video chunk ${nextChunkIndex} recording result:`, result);
              console.log(`Video chunk ${nextChunkIndex} URI saved:`, result.uri);
            }
          })
          .catch((err: any) => {
            console.log('Chunk recording error:', err?.message || err);
          });
      }
    } catch (e: any) {
      console.error(`Failed to save chunk ${currentChunkIndexRef.current}:`, e?.message || e);
    }
  };

const startRecording = async () => {
  if (!device) return;

    try {
      isRecordingRef.current = true;
      setIsRecording(true);
      setFrameCount(0);
      setBarcodeCount(0);
      setBarcodeScans([]);
      setRecordingTime(0);
      recordingStartTime.current = Date.now();
      videoUriRef.current = null;

      const localId = `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      setCurrentRecording({ localId });

      // Initialize chunked recording
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      currentSessionIdRef.current = sessionId;
      setCurrentChunkIndex(0);
      setRecordingChunks([]);
      currentChunkIndexRef.current = 0;
      recordingChunksRef.current = [];
      chunkStartTimeRef.current = Date.now();

      // Create initial metadata
      const metadata: RecordingMetadata = {
        sessionId,
        chunks: [],
        totalDuration: 0,
        createdAt: new Date().toISOString(),
        isComplete: false,
        audioPath: null,
        barcodeScansList: [],
      };
      await saveChunkMetadata(metadata);
      console.log(`📹 Chunked recording session started: ${sessionId}`);

      frameCountRef.current = 0;
      lastFpsFrameRef.current = 0;
      latestFpsRef.current = 0;
      fpsSamplesRef.current = [];
      setFps(0);
      timerRef.current = setInterval(() => setRecordingTime(p => p + 1), 1000);
      frameTimerRef.current = setInterval(() => {
        frameCountRef.current += 1;
        setFrameCount(frameCountRef.current);
      }, 33.33);
      fpsTimerRef.current = setInterval(() => {
        const current = frameCountRef.current;
        const currentFps = current - lastFpsFrameRef.current;
        latestFpsRef.current = currentFps;
        fpsSamplesRef.current.push(currentFps);
        setFps(currentFps);
        lastFpsFrameRef.current = current;
      }, 1000);

      // Set up automatic chunk rotation timer (every 5 minutes)
      chunkTimerRef.current = setInterval(() => {
        rotateVideoChunk();
      }, CHUNK_CONFIG.DURATION_MS);

      // Show Android Expo Go limitation notice
      if (Platform.OS === 'android' && __DEV__) {
        console.log('Note: Video recording is limited in Expo Go on Android. For full video recording, use a development build.');
        showToast('Audio only (Expo Go)');
      }

      // Try video recording on all platforms (may fail on Android Expo Go)
      if (cameraRef.current && Platform.OS !== 'web') {
        console.log('Starting chunked video recording on', Platform.OS);
        videoRecordingActiveRef.current = true;
        setVideoRecordingActive(true);
        
        // Show Android limitation warning
        if (Platform.OS === 'android') {
          console.log('Note: Video recording may be limited in Expo Go on Android. For full video recording, use a development build.');
          showToast('Chunked recording enabled');
        }
        
        try {
          // Record first chunk with maxDuration = chunk duration
          cameraRef.current.recordAsync({ maxDuration: CHUNK_CONFIG.DURATION_SECONDS }).then((result) => {
            console.log('Video chunk 0 recording result:', result);
            if (result?.uri) {
              videoUriRef.current = result.uri;
              console.log('Video chunk 0 URI saved:', result.uri);
            }
          }).catch((err: any) => {
            console.log('Video chunk recording error:', err?.message || err);
            videoRecordingActiveRef.current = false;
            setVideoRecordingActive(false);
          });
        } catch (e: any) {
          console.log('recordAsync failed:', e?.message || e);
          videoRecordingActiveRef.current = false;
          setVideoRecordingActive(false);
        }
      }

      audioRecordingStartedRef.current = false;
      try {
        await audioRecorder.prepareToRecordAsync();
        await audioRecorder.record();
        audioRecordingStartedRef.current = true;
        console.log('Audio recording started');
      } catch (audioErr: any) {
        console.log('Audio recording error:', audioErr?.message || audioErr);
        if (Platform.OS === 'android' && __DEV__) {
          console.log('⚠️ Audio recording not available in Expo Go on Android');
          console.log('ℹ️ Video recording will continue without audio');
        }
      }

      showToast('Chunked recording started');
    } catch (e: any) {
      console.error('Start recording error:', e?.message || e);
      showToast('Failed to start recording');
      isRecordingRef.current = false;
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    if (!currentRecording) return;
    
    setIsSaving(true);
    setSaveProgress(0);
    
    try {
      isRecordingRef.current = false;
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
      if (frameTimerRef.current) clearInterval(frameTimerRef.current);
      if (fpsTimerRef.current) clearInterval(fpsTimerRef.current);
      if (chunkTimerRef.current) clearInterval(chunkTimerRef.current);

      let audioUri: string | null = null;
      let videoUri: string | null = null;

      // Save the final chunk
      if (cameraRef.current && videoRecordingActiveRef.current && currentSessionIdRef.current) {
        try {
          console.log('Stopping final video chunk...');
          cameraRef.current.stopRecording();
          
          for (let i = 0; i < 100; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            if (videoUriRef.current) {
              console.log('Final chunk saved at:', videoUriRef.current);
              break;
            }
          }
          videoUri = videoUriRef.current;

          // Save the final chunk to storage
          if (videoUri) {
            const chunkEndTime = Date.now();
            const chunkDuration = (chunkEndTime - chunkStartTimeRef.current) / 1000;
            
            // Use documentDirectory which is always writable
            const baseDir = `${FileSystem.documentDirectory}chunks`;
            await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true }).catch(() => {});
            
            const savedPath = await saveChunkFile(
              videoUri,
              currentSessionIdRef.current,
              currentChunkIndexRef.current,
              baseDir
            );
            
            const fileSize = await getFileSize(savedPath);
            
            const finalChunk: ChunkType = {
              chunkIndex: currentChunkIndexRef.current,
              filePath: savedPath,
              duration: chunkDuration,
              startTime: chunkStartTimeRef.current,
              endTime: chunkEndTime,
              fileSize,
            };
            
            const allChunks = [...recordingChunksRef.current, finalChunk];
            recordingChunksRef.current = allChunks;
            setRecordingChunks(allChunks);
            
            console.log(`✓ Final chunk ${currentChunkIndexRef.current} saved: ${(fileSize / 1024 / 1024).toFixed(2)}MB`);
            console.log(`📦 Total chunks: ${allChunks.length}`);
          }
        } catch (e: any) {
          console.log('Stop video error:', e?.message || e);
        }
      }
      videoRecordingActiveRef.current = false;
      setVideoRecordingActive(false);

      // Only try to stop audio if it was successfully started
      if (audioRecordingStartedRef.current) {
        try {
          await audioRecorder.stop();
          audioUri = audioRecorder.uri;
          console.log('Audio saved at:', audioUri);
        } catch (e: any) {
          console.log('Stop audio error:', e?.message || e);
          // Silently continue - audio failed but video should still save
        }
      } else {
        console.log('⚠️ Audio was not recorded (Expo Go limitation)');
      }

      setSaveProgress(30);

      let savedAudioPath: string | null = null;
      const timestamp = Date.now();

      // Save audio to app directory
      if (audioUri) {
        try {
          const audioDir = `${FileSystem.documentDirectory}audio`;
          await FileSystem.makeDirectoryAsync(audioDir, { intermediates: true }).catch(() => {});
          const dest = `${audioDir}/XoW_${timestamp}.m4a`;
          await FileSystem.copyAsync({ from: audioUri, to: dest });
          savedAudioPath = dest;
          console.log('✓ Audio saved:', dest);
        } catch (e: any) {
          console.log('Audio copy error:', e?.message || e);
          savedAudioPath = audioUri;
        }
      }

      setSaveProgress(50);

      const finalChunksArray = recordingChunksRef.current;

      // Update final metadata with audio path and mark as complete
      if (currentSessionIdRef.current) {
        const metadata = await getSessionMetadata(currentSessionIdRef.current);
        if (metadata) {
          metadata.audioPath = savedAudioPath;
          metadata.totalDuration = recordingTimeRef.current;
          metadata.barcodeScansList = barcodeScansRef.current;
          metadata.chunks = finalChunksArray.length > 0 ? finalChunksArray : metadata.chunks;
          await saveChunkMetadata(metadata);
          await markSessionComplete(currentSessionIdRef.current);
          
          console.log(`✅ Session complete: ${metadata.chunks.length} chunks, ${recordingTimeRef.current}s total`);
        }
      }

      setSaveProgress(60);

      // Save to local recordings list with chunk information
      const localRecording: LocalRecording = {
        id: '',
        localId: currentRecording.localId,
        videoPath: finalChunksArray.length > 0 ? finalChunksArray[0].filePath : null, // Use first chunk for preview
        audioPath: savedAudioPath,
        barcodeScansList: barcodeScansRef.current,
        duration: recordingTimeRef.current,
        createdAt: new Date().toISOString(),
        isUploaded: false,
        boothName: device?.name || 'Unknown Booth',
        deviceId: device?.device_id || '',
        fps:
          fpsSamplesRef.current.length > 0
            ? Math.round(
                fpsSamplesRef.current.reduce((sum, sample) => sum + sample, 0) /
                  fpsSamplesRef.current.length
              )
            : latestFpsRef.current || fps || 30,
        fpsTimeline: [...fpsSamplesRef.current],
        videoChunks: finalChunksArray,
        isChunked: true,
      };

      const existingRecordings = await getLocalRecordings();
      existingRecordings.unshift(localRecording);
      await AsyncStorage.setItem('xow_local_recordings', JSON.stringify(existingRecordings));

      // Finish the save UI immediately — upload happens silently in background
      setSaveProgress(100);
      showToast('Recording saved');
      setCurrentRecording(null);
      setIsSaving(false);

      // Clean up old incomplete sessions
      await cleanupOldSessions();

      // Background upload — does not block or affect UI
      if (autoUploadRef.current && isOnlineRef.current && (finalChunksArray.length > 0 || savedAudioPath)) {
        uploadRecordingToCloud(localRecording)
          .then(() => console.log('Background upload complete'))
          .catch((uploadErr: any) => console.log('Background upload error:', uploadErr?.message || uploadErr));
      }
    } catch (e: any) {
      console.error('Stop recording error:', e?.message || e);
      showToast('Save failed');
    } finally {
      setIsSaving(false);
      setSaveProgress(0);
    }
  };

  const getLocalRecordings = async (): Promise<LocalRecording[]> => {
    try {
      const saved = await AsyncStorage.getItem('xow_local_recordings');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  };

  const uploadRecordingToCloud = async (recording: LocalRecording) => {
    const currentDevice = deviceRef.current;
    if (!currentDevice) throw new Error('No device');

    console.log('Starting upload for recording:', recording.localId);

    const res = await axios.post(`${API_URL}/api/recordings`, {
      device_id: currentDevice.device_id,
      expo_name: 'Expo 2025',
      booth_name: recording.boothName,
      start_time: recording.createdAt,
      duration: recording.duration,
    });
    
    const recordingId = res.data.id;
    console.log('Created recording in backend:', recordingId);

    // Upload video chunks if available
    if (recording.isChunked && recording.videoChunks && recording.videoChunks.length > 0) {
      try {
        const totalChunks = recording.videoChunks.length;
        console.log(`Uploading ${totalChunks} video chunks...`);
        
        for (let i = 0; i < recording.videoChunks.length; i++) {
          const chunk = recording.videoChunks[i];
          const fileInfo = await FileSystem.getInfoAsync(chunk.filePath);
          
          if (fileInfo.exists) {
            console.log(`Uploading chunk ${i + 1}/${totalChunks}...`);
            
            const uploadResult = await FileSystem.uploadAsync(
              `${API_URL}/api/recordings/${recordingId}/upload-video`,
              chunk.filePath,
              {
                fieldName: 'video',
                httpMethod: 'POST',
                uploadType: FileSystem.FileSystemUploadType.MULTIPART,
                mimeType: 'video/mp4',
                parameters: { 
                  chunk_index: String(chunk.chunkIndex), 
                  total_chunks: String(totalChunks),
                  chunk_duration: String(chunk.duration),
                  chunk_size: String(chunk.fileSize),
                },
              }
            );
            console.log(`Chunk ${i + 1} upload status:`, uploadResult.status);
          }
        }
        console.log('✓ All chunks uploaded successfully');
      } catch (e: any) {
        console.log('Chunk upload error:', e?.message || e);
      }
    } else if (recording.videoPath) {
      // Legacy single file upload
      try {
        const fileInfo = await FileSystem.getInfoAsync(recording.videoPath);
        if (fileInfo.exists) {
          const isMovFile = recording.videoPath.toLowerCase().endsWith('.mov');
          console.log('Uploading video...');
          
          const uploadResult = await FileSystem.uploadAsync(
            `${API_URL}/api/recordings/${recordingId}/upload-video`,
            recording.videoPath,
            {
              fieldName: 'video',
              httpMethod: 'POST',
              uploadType: FileSystem.FileSystemUploadType.MULTIPART,
              mimeType: isMovFile ? 'video/quicktime' : 'video/mp4',
              parameters: { chunk_index: '0', total_chunks: '1' },
            }
          );
          console.log('Video upload status:', uploadResult.status);
        }
      } catch (e: any) {
        console.log('Video upload error:', e?.message || e);
      }
    }

    if (recording.audioPath) {
      try {
        const fileInfo = await FileSystem.getInfoAsync(recording.audioPath);
        if (fileInfo.exists) {
          console.log('Uploading audio...');
          
          const uploadResult = await FileSystem.uploadAsync(
            `${API_URL}/api/recordings/${recordingId}/upload-audio`,
            recording.audioPath,
            {
              fieldName: 'audio',
              httpMethod: 'POST',
              uploadType: FileSystem.FileSystemUploadType.MULTIPART,
              mimeType: 'audio/m4a',
            }
          );
          console.log('Audio upload status:', uploadResult.status);
        }
      } catch (e: any) {
        console.log('Audio upload error:', e?.message || e);
      }
    }

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

    await axios.put(`${API_URL}/api/recordings/${recordingId}/complete`, {
      duration: recording.duration,
    });

    const localRecordings = await getLocalRecordings();
    const idx = localRecordings.findIndex(r => r.localId === recording.localId);
    if (idx !== -1) {
      localRecordings[idx].id = recordingId;
      localRecordings[idx].isUploaded = true;
      await AsyncStorage.setItem('xow_local_recordings', JSON.stringify(localRecordings));
    }

    return recordingId;
  };

  const validateBarcode = (barcode: string): boolean => {
    // Accept ANY QR code format - no restrictions on prefix, format, or length
    // Works with any format: BV98761, ME727, YT67, ABC123, etc.
    const trimmed = barcode.trim();
    
    // Reject only if empty
    if (trimmed.length === 0) {
      console.log('⚠️ Empty barcode data');
      return false;
    }
    
    // Accept any non-empty QR data
    console.log(`✓ Valid QR data (${trimmed.length} chars):`, trimmed);
    return true;
  };

  const processBarcodeInput = (value: string) => {
    // Clear any existing debounce timer
    if (barcodeDebounceRef.current) {
      clearTimeout(barcodeDebounceRef.current);
    }
    
    const trimmed = value.trim();
    
    // If input is cleared, reset
    if (!trimmed) {
      lastBarcodeRef.current = '';
      return;
    }
    
    // Debounce: Wait 800ms after last character before processing
    // This ensures the scanner has completely finished typing the full barcode
    // Longer delay is critical to prevent accepting partial scans
    barcodeDebounceRef.current = setTimeout(() => {
      if (trimmed && isRecording) {
        // Check if this is a duplicate of the last scan (within 2 seconds)
        if (trimmed === lastBarcodeRef.current) {
          console.log('⚠️ Duplicate barcode scan ignored:', trimmed);
          setBarcodeInput('');
          return;
        }
        
        // Validate barcode format (minimum 6 chars: BV + 4 digits)
        // Only accept when scanner has finished typing completely
        if (validateBarcode(trimmed)) {
          handleBarcode(trimmed);
        } else {
          // Invalid or incomplete barcode - show warning and clear
          console.log('❌ Rejected partial/invalid barcode:', trimmed);
          showToast(`Incomplete scan: ${trimmed}`);
          setBarcodeInput('');
          barcodeInputRef.current?.focus();
        }
      }
    }, 200); // 200ms debounce - waits for complete scan to finish
  };

  const handleBarcode = async (barcodeValue?: string) => {
    const bc = barcodeValue || barcodeInput.trim();
    
    if (!bc || !isRecording) return;
    
    // Final validation
    if (!validateBarcode(bc)) {
      showToast(`Invalid barcode format`);
      setBarcodeInput('');
      return;
    }
    
    const ts = (Date.now() - recordingStartTime.current) / 1000;
    
    const newScan: BarcodeData = {
      barcode_data: bc,
      video_timestamp: ts,
      frame_code: frameCount,
    };
    
    setBarcodeScans(prev => [...prev, newScan]);
    setBarcodeCount(p => p + 1);
    setBarcodeInput('');
    lastBarcodeRef.current = bc;
    
    // Clear the last barcode after 2 seconds to allow re-scanning
    setTimeout(() => {
      if (lastBarcodeRef.current === bc) {
        lastBarcodeRef.current = '';
      }
    }, 2000);
    
    console.log('✓ Barcode scanned:', bc);
    showToast(`Visitor: ${bc}`);
    barcodeInputRef.current?.focus();
  };

  const handleLogout = () => {
    if (isRecording) {
      Alert.alert('Recording Active', 'Please stop recording before exiting.');
      return;
    }
    setShowExitModal(true);
  };

  const confirmExit = async () => {
    setShowExitModal(false);
    router.replace('/');
  };

  if (!cameraPermission?.granted) {
    return (
      <View style={[styles.container, { width, height, justifyContent: 'center', alignItems: 'center' }]}>
        <Ionicons name="videocam-off" size={40} color="#E54B2A" />
        <Text style={{ color: '#fff', marginTop: 12, fontSize: 16 }}>Camera Permission Required</Text>
        <TouchableOpacity onPress={requestCameraPermission} style={{ marginTop: 16, backgroundColor: '#E54B2A', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>Enable Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Responsive panel width with better spacing for different screen sizes
  // Increased widths to accommodate larger UI elements (15% increase applied)
  const panelWidth = width < 600 ? Math.min(200, width * 0.30) : width < 900 ? Math.min(230, width * 0.26) : Math.min(250, width * 0.24);
  const isSmallScreen = width < 600;
  const isMediumScreen = width >= 600 && width < 900;

  return (
    <View style={[styles.container, { width, height }]}>
      <View style={[styles.cameraArea, { width: width - panelWidth }]}>

        {/* Preview Header — shown above the video when recording */}
        {isRecording && (
          <View style={styles.previewHeader}>
            <View style={styles.previewHeaderLeft}>
              <View style={styles.previewLogo}>
                <Ionicons name="videocam" size={14} color="#fff" />
                <Text style={styles.previewLogoText}>XoW</Text>
                <View style={styles.previewLiveDot} />
              </View>
              <View style={styles.previewDivider} />
              <View style={styles.previewTCBlock}>
                <Text style={styles.previewMetaLabel}>TIMECODE</Text>
                <Text style={styles.previewTCVal}>{formatTC(recordingTime)}</Text>
              </View>
              <View style={styles.previewDivider} />
              <View style={styles.previewTCBlock}>
                <Text style={styles.previewMetaLabel}>FPS</Text>
                <Text style={styles.previewFPSVal}>{fps}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Camera feed */}
        <View style={styles.cameraViewWrapper}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" mode="video" />

        {/* Top Bar */}
        <View style={styles.topBar}>
          <View style={styles.deviceSection}>
            <View style={styles.idBadge}>
              <Ionicons name="hardware-chip" size={10} color="#E54B2A" />
              <Text style={styles.idText}>{device?.device_id || '---'}</Text>
            </View>
          </View>
          {isRecording && (
            <View style={styles.recBadge}>
              <View style={styles.recDot} />
              <Text style={styles.recText}>REC</Text>
              {videoRecordingActive && <Text style={styles.videoIndicator}>VIDEO</Text>}
            </View>
          )}
          <View style={[styles.statusBadge, isOnline ? styles.online : styles.offline]}>
            <View style={[styles.statusDot, isOnline ? styles.onlineDot : styles.offlineDot]} />
            <Text style={styles.statusText}>{isOnline ? 'CLOUD' : 'OFFLINE'}</Text>
          </View>
        </View>

        {/* Timecode Box — date/time only */}
        <View style={styles.tcBox}>
          <Text style={styles.tcLabel}>DATE</Text>
          <Text style={styles.tcVal}>{formatDate(currentTime)}</Text>
          <Text style={styles.tcLabel}>TIME</Text>
          <Text style={styles.tcVal}>{formatTime(currentTime)}</Text>
        </View>

        {/* Watermark */}
        <View style={styles.watermark}>
          <View style={styles.wmIcon}>
            <Ionicons name="videocam" size={12} color="#fff" />
          </View>
          <Text style={styles.wmText}>XoW</Text>
          {isRecording && <Text style={styles.wmLive}>LIVE</Text>}
        </View>

        {/* Visitor Count */}
        {isRecording && (
          <View style={styles.visitorBox}>
            <Ionicons name="people" size={16} color="#E54B2A" />
            <Text style={styles.visitorNum}>{String(barcodeCount)}</Text>
            <Text style={styles.visitorLabel}>visitors</Text>
          </View>
        )}

        {/* Duration */}
        {isRecording && (
          <View style={styles.durationBox}>
            <Text style={styles.durationText}>{formatTC(recordingTime).slice(0, 8)}</Text>
          </View>
        )}

        {/* Save Progress */}
        {isSaving && (
          <View style={styles.uploadOverlay}>
            <View style={styles.uploadBox}>
              <Ionicons name="save" size={32} color="#E54B2A" />
              <Text style={styles.uploadTitle}>Saving Recording</Text>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${saveProgress}%` }]} />
              </View>
              <Text style={styles.uploadPercent}>{saveProgress}%</Text>
            </View>
          </View>
        )}

        {/* Toast */}
        {toastVisible && (
          <Animated.View style={[styles.toast, { opacity: toastAnim, transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}>
            <Ionicons name="checkmark-circle" size={16} color="#10B981" />
            <Text style={styles.toastText}>{toastMessage}</Text>
          </Animated.View>
        )}
        </View>{/* end cameraViewWrapper */}
      </View>

      {/* Control Panel */}
      <View style={[styles.panel, { width: panelWidth }]}>
        <View>
          <Text style={styles.boothName} numberOfLines={1}>{device?.name || 'Booth'}</Text>
          <Text style={styles.boothSub}>Expo Recording</Text>
          <View style={styles.uploadModeBadge}>
            <Ionicons name={autoUpload ? 'cloud' : 'save'} size={16} color={autoUpload ? '#10B981' : '#F59E0B'} />
            <Text style={[styles.uploadModeText, { color: autoUpload ? '#10B981' : '#F59E0B' }]}>
              {autoUpload ? 'Auto Upload' : 'Local Save'}
            </Text>
          </View>
          <View style={styles.storageBadge}>
            <Ionicons
              name={storageLocation === 'External' ? 'save' : 'phone-portrait'}
              size={16}
              color={storageLocation === 'External' ? '#10B981' : '#8B5CF6'}
            />
            <Text style={[styles.storageBadgeText, { color: storageLocation === 'External' ? '#10B981' : '#8B5CF6' }]}>
              {storageLocation}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.secLabel}>VISITOR BADGE</Text>
          <View style={styles.inputRow}>
            <TextInput
              ref={barcodeInputRef}
              style={styles.input}
              placeholder="Scan/Enter"
              placeholderTextColor="#444"
              value={barcodeInput}
              onChangeText={(value) => {
                setBarcodeInput(value);
                processBarcodeInput(value);
              }}
              onSubmitEditing={() => handleBarcode()}
              autoCapitalize="characters"
              editable={isRecording}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.addBtn, !isRecording && { backgroundColor: '#333' }]}
              onPress={() => handleBarcode()}
              disabled={!isRecording}
            >
              <Ionicons name="add" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
          {isRecording && barcodeCount > 0 && (
            <Text style={styles.scanCount}>{barcodeCount} scanned</Text>
          )}
        </View>

        <View style={styles.recSection}>
          <TouchableOpacity
            style={[styles.recBtn, isRecording && styles.recBtnActive]}
            onPress={isRecording ? stopRecording : startRecording}
            disabled={isSaving}
          >
            <View style={[styles.recBtnInner, isRecording && styles.recBtnInnerActive]}>
              {isSaving ? (
                <Ionicons name="save" size={28} color="#fff" />
              ) : isRecording ? (
                <View style={styles.stopIcon} />
              ) : (
                <View style={styles.recordIcon} />
              )}
            </View>
          </TouchableOpacity>
          <Text style={styles.recLabel}>
            {isSaving ? 'SAVING' : isRecording ? 'STOP' : 'RECORD'}
          </Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.actBtn} onPress={() => router.push('/gallery')}>
            <Ionicons name="folder" size={24} color="#fff" />
            <Text style={styles.actLabel}>Gallery</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actBtn} onPress={() => router.push('/settings')}>
            <Ionicons name="settings" size={24} color="#E54B2A" />
            <Text style={[styles.actLabel, { color: '#E54B2A' }]}>Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actBtn} onPress={handleLogout}>
            <Ionicons name="power" size={24} color="#EF4444" />
            <Text style={[styles.actLabel, { color: '#EF4444' }]}>Exit</Text>
          </TouchableOpacity>
        </View>
      </View>
      {/* Exit confirmation overlay */}
      {showExitModal && (
        <Pressable style={styles.exitOverlay} onPress={() => setShowExitModal(false)}>
          <Pressable style={styles.exitModal} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.exitTitle}>Exit App?</Text>
            <Text style={styles.exitSub}>Are you sure you want to exit the application?</Text>
            <View style={styles.exitBtnRow}>
              <TouchableOpacity style={styles.exitCancelBtn} onPress={() => setShowExitModal(false)}>
                <Text style={styles.exitCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.exitConfirmBtn} onPress={confirmExit}>
                <Text style={styles.exitConfirmText}>Exit</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: '#000' },
  cameraArea: { flex: 1, flexDirection: 'column' },
  cameraViewWrapper: { flex: 1, position: 'relative' },

  // Preview header — above the video when recording (Enhanced spacing)
  previewHeader: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#0d0d0d', 
    borderBottomWidth: 1, 
    borderBottomColor: '#1a1a1a', 
    paddingHorizontal: 24, 
    paddingVertical: 14 
  },
  previewHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  previewLogo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  previewLogoText: { color: '#fff', fontSize: 23, fontWeight: '800', letterSpacing: 1.5 },
  previewLiveDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#EF4444' },
  previewDivider: { width: 1, height: 33, backgroundColor: '#2a2a2a' },
  previewTCBlock: { alignItems: 'flex-start', gap: 4 },
  previewMetaLabel: { color: '#555', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  previewTCVal: { color: '#EF4444', fontSize: 21, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  previewFPSVal: { color: '#E54B2A', fontSize: 21, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  
  topBar: { 
    position: 'absolute', 
    top: 20, 
    left: 20, 
    right: 20, 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'flex-start',
    gap: 15
  },
  deviceSection: { gap: 10, marginTop: 22 },
  idBadge: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: 'rgba(0,0,0,0.85)', 
    paddingHorizontal: 16, 
    paddingVertical: 10, 
    borderRadius: 10, 
    gap: 9 
  },
  idText: { color: '#fff', fontSize: 16, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  brandBadge: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: 'rgba(229,75,42,0.4)', 
    paddingHorizontal: 14, 
    paddingVertical: 8, 
    borderRadius: 10, 
    gap: 8 
  },
  brandText: { color: '#E54B2A', fontSize: 15, fontWeight: '800' },
  recBadge: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#DC2626', 
    paddingHorizontal: 20, 
    paddingVertical: 11, 
    borderRadius: 10, 
    gap: 10 
  },
  recDot: { width: 13, height: 13, borderRadius: 7, backgroundColor: '#fff' },
  recText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 1.5 },
  videoIndicator: { color: '#fff', fontSize: 13, fontWeight: '600', backgroundColor: '#E54B2A', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 5, marginLeft: 7 },
  statusBadge: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 16, 
    paddingVertical: 10, 
    borderRadius: 10, 
    gap: 9 
  },
  online: { backgroundColor: 'rgba(16,185,129,0.3)' },
  offline: { backgroundColor: 'rgba(239,68,68,0.3)' },
  statusDot: { width: 11, height: 11, borderRadius: 6 },
  onlineDot: { backgroundColor: '#10B981' },
  offlineDot: { backgroundColor: '#EF4444' },
  statusText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  
  tcBox: { 
    position: 'absolute', 
    top: 92, 
    left: 20, 
    backgroundColor: 'rgba(0,0,0,0.9)', 
    padding: 16, 
    borderRadius: 12, 
    borderLeftWidth: 4, 
    borderLeftColor: '#E54B2A' 
  },
  tcLabel: { color: '#666', fontSize: 13, fontWeight: '600', marginTop: 5 },
  tcVal: { color: '#fff', fontSize: 20, fontWeight: '600', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  tcDiv: { height: 1, backgroundColor: '#333', marginVertical: 9 },
  
  watermark: { 
    position: 'absolute', 
    bottom: 22, 
    right: 22, 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: 'rgba(229,75,42,0.95)', 
    paddingHorizontal: 20, 
    paddingVertical: 12, 
    borderRadius: 12, 
    gap: 12 
  },
  wmIcon: { width: 33, height: 33, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  wmText: { color: '#fff', fontSize: 23, fontWeight: '800', letterSpacing: 1.5 },
  wmLive: { color: '#fff', fontSize: 13, fontWeight: '700', backgroundColor: '#EF4444', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 5, marginLeft: 5 },
  
  visitorBox: { 
    position: 'absolute', 
    bottom: 22, 
    left: 22, 
    backgroundColor: 'rgba(0,0,0,0.9)', 
    paddingHorizontal: 22, 
    paddingVertical: 14, 
    borderRadius: 14, 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 14 
  },
  visitorNum: { color: '#fff', fontSize: 35, fontWeight: '800' },
  visitorLabel: { color: '#666', fontSize: 16 },
  
  durationBox: { 
    position: 'absolute', 
    bottom: 22, 
    alignSelf: 'center', 
    backgroundColor: 'rgba(0,0,0,0.85)', 
    paddingHorizontal: 28, 
    paddingVertical: 14, 
    borderRadius: 12, 
    borderWidth: 2, 
    borderColor: '#EF4444' 
  },
  durationText: { color: '#EF4444', fontSize: 27, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  
  uploadOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 33 },
  uploadBox: { 
    backgroundColor: '#0a0a0a', 
    padding: 46, 
    borderRadius: 23, 
    alignItems: 'center', 
    borderWidth: 1, 
    borderColor: '#1a1a1a',
    minWidth: 393
  },
  uploadTitle: { color: '#fff', fontSize: 25, fontWeight: '600', marginTop: 19, marginBottom: 30 },
  progressBar: { width: 323, height: 10, backgroundColor: '#1a1a1a', borderRadius: 5, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#E54B2A', borderRadius: 5 },
  uploadPercent: { color: '#E54B2A', fontSize: 22, fontWeight: '700', marginTop: 16 },
  
  toast: { 
    position: 'absolute', 
    bottom: 99, 
    alignSelf: 'center', 
    backgroundColor: 'rgba(0,0,0,0.95)', 
    paddingHorizontal: 33, 
    paddingVertical: 19, 
    borderRadius: 14, 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 16, 
    borderWidth: 1, 
    borderColor: '#10B981' 
  },
  toastText: { color: '#fff', fontSize: 21, fontWeight: '600' },
  
  panel: { 
    backgroundColor: '#0a0a0a', 
    borderLeftWidth: 1, 
    borderLeftColor: '#1a1a1a', 
    padding: 24, 
    justifyContent: 'space-between' 
  },
  boothName: { color: '#fff', fontSize: 23, fontWeight: '700', textAlign: 'center' },
  boothSub: { color: '#666', fontSize: 18, textAlign: 'center', marginTop: 7 },
  uploadModeBadge: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 9, 
    marginTop: 12, 
    paddingVertical: 9, 
    paddingHorizontal: 14, 
    backgroundColor: 'rgba(255,255,255,0.05)', 
    borderRadius: 9 
  },
  uploadModeText: { fontSize: 18, fontWeight: '600' },
  storageBadge: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 9, 
    marginTop: 9, 
    paddingVertical: 8, 
    paddingHorizontal: 14, 
    backgroundColor: 'rgba(255,255,255,0.05)', 
    borderRadius: 9 
  },
  storageBadgeText: { fontSize: 18, fontWeight: '600' },
  
  section: { marginTop: 28 },
  secLabel: { color: '#555', fontSize: 16, fontWeight: '700', marginBottom: 12, letterSpacing: 0.5 },
  inputRow: { flexDirection: 'row', gap: 10 },
  input: { 
    flex: 1, 
    backgroundColor: '#111', 
    borderRadius: 11, 
    paddingHorizontal: 12, 
    paddingVertical: 14, 
    color: '#fff', 
    fontSize: 21, 
    borderWidth: 1, 
    borderColor: '#222' 
  },
  addBtn: { 
    width: 60, 
    height: 60, 
    borderRadius: 11, 
    backgroundColor: '#E54B2A', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  scanCount: { color: '#E54B2A', fontSize: 18, marginTop: 9, textAlign: 'center' },
  
  recSection: { alignItems: 'center', marginVertical: 18 },
  recBtn: { 
    width: 117, 
    height: 117, 
    borderRadius: 59, 
    backgroundColor: 'rgba(229,75,42,0.2)', 
    justifyContent: 'center', 
    alignItems: 'center', 
    borderWidth: 5, 
    borderColor: '#E54B2A' 
  },
  recBtnActive: { backgroundColor: 'rgba(239,68,68,0.2)', borderColor: '#EF4444' },
  recBtnInner: { 
    width: 89, 
    height: 89, 
    borderRadius: 45, 
    backgroundColor: '#E54B2A', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  recBtnInnerActive: { backgroundColor: '#EF4444', borderRadius: 14, width: 58, height: 58 },
  recordIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#fff' },
  stopIcon: { width: 26, height: 26, borderRadius: 5, backgroundColor: '#fff' },
  recLabel: { color: '#888', fontSize: 24, fontWeight: '700', textAlign: 'center', marginTop: 14, letterSpacing: 0.5 },
  
  actions: { 
    flexDirection: 'row', 
    justifyContent: 'space-around', 
    paddingTop: 20, 
    borderTopWidth: 1, 
    borderTopColor: '#1a1a1a',
    marginTop: 8
  },
  actBtn: { alignItems: 'center', padding: 12 },
  actLabel: { color: '#888', fontSize: 16, marginTop: 8 },

  // Exit modal (Enhanced spacing)
  exitOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)', 
    justifyContent: 'center', 
    alignItems: 'center',
    padding: 28,
    zIndex: 1000
  },
  exitModal: { 
    width: '90%',
    maxWidth: 554, 
    backgroundColor: '#0f0f0f', 
    borderRadius: 27, 
    padding: 50, 
    borderWidth: 1, 
    borderColor: '#2a2a2a' 
  },
  exitTitle: { color: '#fff', fontSize: 37, fontWeight: '700', textAlign: 'center', marginBottom: 21 },
  exitSub: { color: '#888', fontSize: 25, textAlign: 'center', marginBottom: 42, lineHeight: 37 },
  exitBtnRow: { flexDirection: 'row', gap: 23 },
  exitCancelBtn: { 
    flex: 1, 
    paddingVertical: 23, 
    borderRadius: 15, 
    backgroundColor: '#1a1a1a', 
    alignItems: 'center', 
    borderWidth: 1, 
    borderColor: '#333' 
  },
  exitCancelText: { color: '#888', fontSize: 25, fontWeight: '600' },
  exitConfirmBtn: { 
    flex: 1, 
    paddingVertical: 23, 
    borderRadius: 15, 
    backgroundColor: '#EF4444', 
    alignItems: 'center' 
  },
  exitConfirmText: { color: '#fff', fontSize: 25, fontWeight: '700' },
});
