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
import { Audio } from 'expo-av';
// Logo removed - using text instead
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import axios from 'axios';
import {
  saveChunkMetadata,
  getSessionMetadata,
  markSessionComplete,
  cleanupOldSessions,
  exportMetadataToStorage,
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
  storageType?: 'external' | 'internal';  // Storage location
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
  const [isPaired, setIsPaired] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [currentRecording, setCurrentRecording] = useState<any>(null);
  const currentRecordingRef = useRef<any>(null);
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
  const [exitConfirmText, setExitConfirmText] = useState('');
  const [storageLocation, setStorageLocation] = useState<'Internal' | 'External'>('Internal');
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [recordingChunks, setRecordingChunks] = useState<ChunkType[]>([]);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const blinkAnim = useRef(new Animated.Value(1)).current;
  
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
  const sessionStorageDirRef = useRef<string>(`${FileSystem.documentDirectory}chunks`);
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
  const storageTypeRef = useRef<'external' | 'internal'>('internal');
  
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  useEffect(() => {
    loadDevice();
    loadSettings();
    checkPermissions();
    checkConnection();
    checkPairingStatus();
    clockRef.current = setInterval(() => setCurrentTime(new Date()), 1000);
    const connInterval = setInterval(checkConnection, 10000);
    const pairingInterval = setInterval(checkPairingStatus, 5000);

    // Start watching for USB/SD plug-unplug events every 3s
    startStorageWatcher();

    return () => {
      clearInterval(connInterval);
      clearInterval(pairingInterval);
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

  useEffect(() => {
    currentRecordingRef.current = currentRecording;
  }, [currentRecording]);

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

  const checkPairingStatus = async () => {
    try {
      const device_id = await AsyncStorage.getItem('xow_permanent_device_id');
      const password = await AsyncStorage.getItem('xow_permanent_device_password');
      if (!device_id || !password) return;
      
      const res = await axios.get(
        `${API_URL}/api/devices/${device_id}/pairing-code?password=${password}`,
        { timeout: 5000 }
      );
      setIsPaired(res.data?.is_paired || false);
    } catch (e) {
      setIsPaired(false);
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
        setStorageLocation(settings.storageLocation === 'external' ? 'External' : 'Internal');
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


  const usbStorageModule = Platform.OS === 'android' ? NativeModules.UsbStorage : null;

  /**
   * Detect external storage (USB OTG / SD card).
   * Uses StorageManager.getStorageVolumes() as the single gate —
   * if no removable volume is mounted, returns null immediately.
   */
  const detectExternalStorage = async (): Promise<string | null> => {
    if (Platform.OS !== 'android') return null;
    try {
      // Detect removable storage via mounted volumes or app-specific external path
      let volumes: Array<{ description: string }> = [];
      if (usbStorageModule?.getRemovableVolumes) {
        volumes = await usbStorageModule.getRemovableVolumes();
      }

      // Prefer native file:// path — supports direct FileSystem.copyAsync (no base64 OOM for large files)
      if (usbStorageModule?.getWritableExternalStoragePath) {
        const nativePath = await usbStorageModule.getWritableExternalStoragePath();
        if (nativePath) {
          console.log('External storage: native file:// path', nativePath);
          return nativePath;
        }
      }

      if (volumes.length === 0) return null;

      // Fall back to SAF content:// URI only if native path unavailable
      const grantedUri = await AsyncStorage.getItem(EXTERNAL_STORAGE_URI_KEY);
      if (grantedUri) return grantedUri;

      return null;
    } catch (e) {
      console.log('detectExternalStorage error:', e);
      return null;
    }
  };

  /** Persist storage location preference to AsyncStorage. */
  const persistStorageSetting = async (location: 'internal' | 'external') => {
    try {
      const saved = await AsyncStorage.getItem('xow_settings');
      const s = saved ? JSON.parse(saved) : { autoUpload: false };
      await AsyncStorage.setItem('xow_settings', JSON.stringify({ ...s, storageLocation: location }));
    } catch (e) {
      console.log('persistStorageSetting error:', e);
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
        await persistStorageSetting('external');
        showToast('External storage connected – saving to External');
      } else if (!external && prev) {
        lastExternalRef.current = null;
        setStorageLocation('Internal');
        await persistStorageSetting('internal');
        showToast('External storage removed – saving to Internal');
      } else if (external) {
        lastExternalRef.current = external;
      }
    }, 3000);
  };

  /**
   * Returns the storage directory based on user preference in settings.
   * Falls back to auto-detection if preference not set or external storage unavailable.
   */
  /**
   * Reliable file copy using native Java IO (works on all Android versions).
   * FileSystem.copyAsync can fail silently on Android 13 for cross-storage copies.
   */
  const nativeCopyFile = async (sourceUri: string, destPath: string): Promise<string> => {
    if (Platform.OS === 'android' && usbStorageModule?.copyFile) {
      return await usbStorageModule.copyFile(sourceUri, destPath);
    }
    // iOS or fallback
    await FileSystem.copyAsync({ from: sourceUri, to: destPath });
    return destPath;
  };

  /** Creates a directory using native Java mkdirs — works on all Android paths. */
  const nativeMkdirs = async (path: string): Promise<void> => {
    if (Platform.OS === 'android' && usbStorageModule?.mkdirs) {
      await usbStorageModule.mkdirs(path);
    } else {
      await FileSystem.makeDirectoryAsync(path, { intermediates: true });
    }
  };

  /**
   * Returns the base XoW directory for this recording session.
   *
   * External selected + SD card present:
   *   → SD card/XoW/  (public, visible in Files app)
   *     i.e. /storage/XXXX-XXXX/XoW  (MANAGE_EXTERNAL_STORAGE granted)
   *       or /storage/XXXX-XXXX/Android/data/com.pkg/files/XoW  (fallback)
   *
   * Internal selected (or no SD card):
   *   → Phone Internal/Android/data/com.devcyboglabs.xowrecorder/files/XoW
   *     i.e. /storage/emulated/0/Android/data/com.pkg/files/XoW
   *     Visible in Files app → Internal Storage → Android → data → com.pkg → files → XoW
   *     NOT app cache — survives "Clear Cache", only removed by "Clear Data" or uninstall.
   */
  const getStorageDir = async (): Promise<{ dir: string; label: string }> => {
    if (Platform.OS === 'android') {
      // Read user's setting
      let preferExternal = false;
      try {
        const saved = await AsyncStorage.getItem('xow_settings');
        if (saved) {
          const s = JSON.parse(saved);
          preferExternal = s.storageLocation === 'external';
        }
      } catch (_) {}

      if (preferExternal) {
        // Try external SD card / USB
        try {
          const extBase: string | null = usbStorageModule?.getWritableExternalStoragePath
            ? await usbStorageModule.getWritableExternalStoragePath()
            : null;
          if (extBase) {
            const xowDir = `${extBase}/XoW`;
            await nativeMkdirs(xowDir);
            lastExternalRef.current = xowDir;
            storageTypeRef.current = 'external';
            console.log('Storage: external →', xowDir);
            return { dir: xowDir, label: 'External Storage' };
          }
        } catch (e) {
          console.log('External storage setup failed, falling back to internal:', e);
        }
        showToast('External storage not available, using internal');
      }

      // Internal — use app-specific dir on phone storage (visible in Files app)
      lastExternalRef.current = null;
      storageTypeRef.current = 'internal';
      try {
        const documentBase = `${FileSystem.documentDirectory}XoW`;
        await nativeMkdirs(documentBase);
        console.log('Storage: internal →', documentBase);
        return { dir: documentBase, label: 'Internal Storage' };
      } catch (e) {
        console.log('Internal document storage path error:', e);
      }

      try {
        const internalBase: string | null = usbStorageModule?.getInternalStoragePath
          ? await usbStorageModule.getInternalStoragePath()
          : null;
        if (internalBase) {
          const xowDir = `${internalBase}/XoW`;
          await nativeMkdirs(xowDir);
          storageTypeRef.current = 'internal';
          console.log('Storage: internal →', xowDir);
          return { dir: xowDir, label: 'Internal Storage' };
        }
      } catch (e) {
        console.log('Internal storage path error:', e);
      }

      // Ultimate fallback (should never reach here)
      const fallback = `${FileSystem.documentDirectory}XoW`;
      await nativeMkdirs(fallback);
      storageTypeRef.current = 'internal';
      console.log('Storage: fallback →', fallback);
      return { dir: fallback, label: 'Internal Storage' };
    }
    // iOS
    const iosDir = `${FileSystem.documentDirectory}XoW`;
    await nativeMkdirs(iosDir);
    storageTypeRef.current = 'internal';
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
    // Request MANAGE_EXTERNAL_STORAGE so videos save publicly to SD card on Android 11+
    if (Platform.OS === 'android' && usbStorageModule?.hasManageStoragePermission) {
      try {
        const hasPermission: boolean = await usbStorageModule.hasManageStoragePermission();
        if (!hasPermission) {
          Alert.alert(
            'Storage Permission Required',
            'To save videos directly to your SD card, please grant "All files access" in the next screen.',
            [
              {
                text: 'Grant Access',
                onPress: () => usbStorageModule.requestManageStoragePermission().catch(() => {}),
              },
              { text: 'Skip', style: 'cancel' },
            ]
          );
        }
      } catch (e) {
        console.log('Storage permission check error:', e);
      }
    }
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

  const toFileUri = (path: string): string => {
    if (!path || path.startsWith('file://') || path.startsWith('content://') || path.startsWith('http')) {
      return path;
    }
    return `file://${path}`;
  };

  const upsertLocalRecordingEntry = async (
    chunks: ChunkType[],
    audioPath: string | null = null
  ): Promise<LocalRecording | null> => {
    const activeRecording = currentRecordingRef.current;
    if (!activeRecording?.localId || chunks.length === 0) {
      return null;
    }

    try {
      const saved = await AsyncStorage.getItem('xow_local_recordings');
      const existingRecordings: LocalRecording[] = saved ? JSON.parse(saved) : [];
      const existingIndex = existingRecordings.findIndex(r => r.localId === activeRecording.localId);
      const existingRecording = existingIndex >= 0 ? existingRecordings[existingIndex] : null;
      const averageFps =
        fpsSamplesRef.current.length > 0
          ? Math.round(
              fpsSamplesRef.current.reduce((sum, sample) => sum + sample, 0) /
                fpsSamplesRef.current.length
            )
          : latestFpsRef.current || fps || existingRecording?.fps || 30;

      const localRecording: LocalRecording = {
        id: existingRecording?.id || '',
        localId: activeRecording.localId,
        videoPath: chunks[0]?.filePath || existingRecording?.videoPath || null,
        audioPath: audioPath ?? existingRecording?.audioPath ?? null,
        barcodeScansList: barcodeScansRef.current,
        duration:
          recordingTimeRef.current > 0
            ? recordingTimeRef.current
            : Math.floor(chunks.reduce((sum, chunk) => sum + (chunk.duration || 0), 0)),
        createdAt: activeRecording.createdAt || existingRecording?.createdAt || new Date().toISOString(),
        isUploaded: existingRecording?.isUploaded || false,
        boothName: deviceRef.current?.name || existingRecording?.boothName || 'Unknown Booth',
        deviceId: deviceRef.current?.device_id || existingRecording?.deviceId || '',
        fps: averageFps,
        fpsTimeline: fpsSamplesRef.current.length > 0 ? [...fpsSamplesRef.current] : existingRecording?.fpsTimeline || [],
        videoChunks: chunks,
        isChunked: true,
        storageType: storageTypeRef.current,
      };

      if (existingIndex >= 0) {
        existingRecordings[existingIndex] = localRecording;
      } else {
        existingRecordings.unshift(localRecording);
      }

      await AsyncStorage.setItem('xow_local_recordings', JSON.stringify(existingRecordings));
      return localRecording;
    } catch (error) {
      console.log('Failed to upsert local recording entry:', error);
      return null;
    }
  };

  const waitForFileReady = async (fileUri: string, minSize = 1024): Promise<number> => {
    let lastSize = -1;
    let stableReads = 0;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        const info = await FileSystem.getInfoAsync(toFileUri(fileUri));
        const size = info.exists && 'size' in info ? info.size : 0;
        if (info.exists && size >= minSize) {
          if (size === lastSize) {
            stableReads += 1;
          } else {
            lastSize = size;
            stableReads = 0;
          }

          if (stableReads >= 2) {
            return size;
          }
        } else {
          lastSize = -1;
          stableReads = 0;
        }
      } catch (error) {
        console.log('File readiness check error:', error);
        lastSize = -1;
        stableReads = 0;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`File not ready: ${fileUri}`);
  };

  const persistVideoChunk = async (sourceUri: string, destPath: string): Promise<{ savedPath: string; fileSize: number }> => {
    const sourceSize = await waitForFileReady(sourceUri);
    console.log(`📁 Source chunk ready: ${sourceUri} (${sourceSize} bytes)`);

    const lastSlash = destPath.lastIndexOf('/');
    if (lastSlash !== -1) {
      const parentDir = destPath.slice(0, lastSlash);
      await nativeMkdirs(parentDir);
    }

    const srcFileUri = toFileUri(sourceUri);
    const destFileUri = toFileUri(destPath);

    try {
      await FileSystem.deleteAsync(destFileUri, { idempotent: true });
    } catch (_) {}

    let persistedPath = destFileUri;
    let sourceDeleted = false;

    // Prefer atomic move (same-filesystem rename) — zero corruption risk
    try {
      await FileSystem.moveAsync({ from: srcFileUri, to: destFileUri });
      sourceDeleted = true;
      console.log(`📁 Chunk moved (atomic): ${destFileUri}`);
    } catch (moveError) {
      console.log('Atomic move failed, trying native copy:', moveError);
      // Fall back to native copy (needed for cross-filesystem / external storage)
      try {
        const nativePath = await nativeCopyFile(sourceUri, destPath);
        persistedPath = toFileUri(nativePath);
        console.log(`📁 Chunk copied (native): ${persistedPath}`);
      } catch (copyError) {
        console.log('Native copy failed, trying expo copy:', copyError);
        await FileSystem.copyAsync({ from: srcFileUri, to: destFileUri });
        persistedPath = destFileUri;
        console.log(`📁 Chunk copied (expo): ${persistedPath}`);
      }
    }

    if (!sourceDeleted) {
      try {
        await FileSystem.deleteAsync(srcFileUri, { idempotent: true });
      } catch (_) {}
    }

    const destSize = await waitForFileReady(persistedPath, sourceSize);
    if (destSize < sourceSize) {
      throw new Error(`Chunk copy incomplete: source=${sourceSize} dest=${destSize}`);
    }
    console.log(`📁 Persisted chunk ready: ${persistedPath} (${destSize} bytes)`);
    return { savedPath: persistedPath, fileSize: destSize };
  };

  /**
   * Save current chunk and start a new one
   * Called when camera auto-stops after maxDuration
   */
  const rotateVideoChunk = async () => {
    if (!cameraRef.current || !currentSessionIdRef.current || !isRecordingRef.current) {
      console.log('Chunk rotation skipped: camera not ready or not recording');
      return;
    }

    try {
      const activeChunkIndex = currentChunkIndexRef.current;
      const nextChunkIndex = activeChunkIndex + 1;
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) return;

      console.log(`🔄 Rotating to chunk ${nextChunkIndex}...`);

      // videoUriRef should already be set by recordAsync completion
      if (!videoUriRef.current) {
        console.warn('No video URI available for chunk rotation');
        return;
      }

      const srcUri = videoUriRef.current;
      console.log(`✓ Chunk ${activeChunkIndex} completed by camera: ${srcUri}`);

      const chunkEndTime = Date.now();
      const chunkDuration = (chunkEndTime - chunkStartTimeRef.current) / 1000;

      // Save rotation chunks to documentDirectory — this is always writable and
      // readable by expo-file-system/expo-av, unlike external app storage paths
      // which can silently produce corrupt files on some Android versions.
      const chunkBaseDir = `${sessionStorageDirRef.current}/Videos`;
      await nativeMkdirs(chunkBaseDir);
      const chunkDest = `${chunkBaseDir}/chunk_${sessionId}_${activeChunkIndex}.mp4`;

      const { savedPath, fileSize } = await persistVideoChunk(srcUri, chunkDest);
      console.log(`✅ Chunk saved successfully: ${savedPath} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);
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

      await upsertLocalRecordingEntry(updatedChunks);

      console.log(`✓ Chunk ${activeChunkIndex} saved: ${(fileSize / 1024 / 1024).toFixed(2)}MB`);
      showToast(`Chunk ${activeChunkIndex + 1} saved`);

      currentChunkIndexRef.current = nextChunkIndex;
      setCurrentChunkIndex(nextChunkIndex);

      // Start next chunk with maxDuration - camera will auto-finalize
      videoUriRef.current = null;
      chunkStartTimeRef.current = Date.now();
      videoRecordingActiveRef.current = true;
      
      if (cameraRef.current && isRecordingRef.current) {
        console.log(`Starting chunk ${nextChunkIndex} recording...`);
        const maxDurationSeconds = CHUNK_CONFIG.DURATION_MS / 1000;
        cameraRef.current
          .recordAsync({ maxDuration: maxDurationSeconds })
          .then(async (result) => {
            if (result?.uri) {
              videoUriRef.current = result.uri;
              console.log(`Video chunk ${nextChunkIndex} recording result:`, result);
              console.log(`Video chunk ${nextChunkIndex} URI saved:`, result.uri);
              
              // Auto-rotate to next chunk when this one completes
              if (isRecordingRef.current) {
                await rotateVideoChunk();
              }
            }
          })
          .catch((err: any) => {
            console.log('Chunk recording error:', err?.message || err);
            // If chunk recording fails, stop the whole recording
            if (isRecordingRef.current) {
              console.error('Critical: chunk recording failed, stopping recording');
              stopRecording();
            }
          });
      }
    } catch (e: any) {
      console.error(`Failed to save chunk ${currentChunkIndexRef.current}:`, e?.message || e);
    }
  };

const startRecording = async () => {
  console.log('🎬 startRecording called');
  if (!device) {
    console.log('⚠️ No device, returning');
    return;
  }
  
  // Prevent re-entry
  if (isRecordingRef.current) {
    console.log('⚠️ Recording already in progress, ignoring duplicate call');
    return;
  }

    try {
      console.log('🎬 Starting recording setup...');
      // Play camera shutter sound
      try {
        const { sound } = await Audio.Sound.createAsync(
          require('../assets/sounds/camera-sfx1.mp3')
        );
        await sound.playAsync();
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            sound.unloadAsync();
          }
        });
      } catch (error) {
        console.log('Error playing camera sound:', error);
      }
      
      console.log('Step 1: Setting recording state');
      isRecordingRef.current = true;
      setIsRecording(true);
      setFrameCount(0);
      setBarcodeCount(0);
      setBarcodeScans([]);
      setRecordingTime(0);
      recordingStartTime.current = Date.now();
      videoUriRef.current = null;

      console.log('Step 2: Creating local ID');
      const localId = `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const createdAt = new Date().toISOString();
      const nextRecording = { localId, createdAt };
      setCurrentRecording(nextRecording);
      currentRecordingRef.current = nextRecording;

      console.log('Step 3: Initialize chunked recording');
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      currentSessionIdRef.current = sessionId;
      setCurrentChunkIndex(0);
      setRecordingChunks([]);
      currentChunkIndexRef.current = 0;
      recordingChunksRef.current = [];
      chunkStartTimeRef.current = Date.now();

      console.log('Step 4: Resolve storage directory');
      const { dir: resolvedDir } = await getStorageDir();
      sessionStorageDirRef.current = resolvedDir;

      console.log('Step 5: Create initial metadata');
      const metadata: RecordingMetadata = {
        sessionId,
        chunks: [],
        totalDuration: 0,
        createdAt: new Date().toISOString(),
        isComplete: false,
        audioPath: null,
        barcodeScansList: [],
      };
      console.log('Step 6: Save chunk metadata');
      await saveChunkMetadata(metadata);
      console.log(`📹 Chunked recording session started: ${sessionId}`);

      frameCountRef.current = 0;
      lastFpsFrameRef.current = 0;
      latestFpsRef.current = 0;
      fpsSamplesRef.current = [];
      setFps(0);
      
      // Start blinking animation for live dot
      Animated.loop(
        Animated.sequence([
          Animated.timing(blinkAnim, {
            toValue: 0.2,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(blinkAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();
      
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

      // Chunk rotation now handled by maxDuration in recordAsync - camera auto-finalizes properly

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
          // Record first chunk with maxDuration - camera will auto-finalize properly
          const maxDurationSeconds = CHUNK_CONFIG.DURATION_MS / 1000;
          cameraRef.current.recordAsync({ maxDuration: maxDurationSeconds }).then(async (result) => {
            console.log('Video chunk 0 recording result:', result);
            if (result?.uri) {
              videoUriRef.current = result.uri;
              console.log('Video chunk 0 URI saved:', result.uri);
              
              // Camera stopped automatically with proper finalization - save and start next
              if (isRecordingRef.current) {
                console.log('Auto-rotating after chunk 0 completed');
                await rotateVideoChunk();
              }
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
    
    // Play camera shutter sound
    try {
      const { sound } = await Audio.Sound.createAsync(
        require('../assets/sounds/camera-sfx1.mp3')
      );
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
        }
      });
    } catch (error) {
      console.log('Error playing camera sound:', error);
    }
    
    setIsSaving(true);
    setSaveProgress(0);
    
    try {
      isRecordingRef.current = false;
      setIsRecording(false);
      
      // Stop blinking animation and reset
      blinkAnim.stopAnimation();
      blinkAnim.setValue(1);
      
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
            
            const finalBaseDir = `${sessionStorageDirRef.current}/Videos`;
            await nativeMkdirs(finalBaseDir);
            const finalDest = `${finalBaseDir}/chunk_${currentSessionIdRef.current}_${currentChunkIndexRef.current}.mp4`;
            const { savedPath, fileSize } = await persistVideoChunk(videoUri, finalDest);
            
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
          const audioDir = `${sessionStorageDirRef.current}/Audio`;
          await nativeMkdirs(audioDir);
          const dest = `${audioDir}/XoW_${timestamp}.m4a`;
          const copiedAudioPath = await nativeCopyFile(audioUri, dest);
          savedAudioPath = toFileUri(copiedAudioPath);
          console.log('✓ Audio saved:', savedAudioPath);
        } catch (e: any) {
          console.log('Audio copy error:', e?.message || e);
          savedAudioPath = toFileUri(audioUri);
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
          
          // Export metadata JSON to external storage for Windows Electron app
          if (sessionStorageDirRef.current) {
            try {
              console.log(`🔄 Starting JSON export...`);
              console.log(`📁 Storage directory: ${sessionStorageDirRef.current}`);
              console.log(`📊 Session ID: ${currentSessionIdRef.current}`);
              console.log(`📊 Chunks: ${metadata.chunks.length}, Scans: ${barcodeScansRef.current.length}`);
              
              // Create export data with relative timestamps
              let cumulativeTime = 0;
              const exportData = {
                sessionId: metadata.sessionId,
                createdAt: metadata.createdAt,
                totalDuration: metadata.totalDuration,
                isComplete: metadata.isComplete,
                videoChunks: metadata.chunks.map(chunk => {
                  const chunkData = {
                    chunkIndex: chunk.chunkIndex,
                    fileName: chunk.filePath.split('/').pop() || `chunk_${chunk.chunkIndex}.mp4`,
                    duration: chunk.duration,
                    startTime: cumulativeTime,
                    endTime: cumulativeTime + chunk.duration,
                    fileSize: chunk.fileSize
                  };
                  cumulativeTime += chunk.duration;
                  return chunkData;
                }),
                audioFileName: metadata.audioPath ? metadata.audioPath.split('/').pop() : null,
                barcodeScans: barcodeScansRef.current.map((scan: BarcodeData) => ({
                  barcode: scan.barcode_data || '',
                  timestamp: scan.video_timestamp || 0,
                  visitorName: '',
                  company: '',
                  email: '',
                  phone: ''
                })),
                exportedAt: new Date().toISOString(),
                version: '1.0'
              };
              
              // Write to temp file first
              const tempJsonPath = `${FileSystem.cacheDirectory}temp_metadata_${currentSessionIdRef.current}.json`;
              const jsonString = JSON.stringify(exportData, null, 2);
              
              await FileSystem.writeAsStringAsync(
                tempJsonPath,
                jsonString,
                { encoding: FileSystem.EncodingType.UTF8 }
              );
              console.log(`✓ Temp JSON created: ${tempJsonPath} (${jsonString.length} chars)`);
              
              // Copy to final destination using native copy (works with external storage)
              const jsonFileName = `metadata_${currentSessionIdRef.current}.json`;
              const jsonFinalPath = `${sessionStorageDirRef.current}/${jsonFileName}`;
              
              const copiedPath = await nativeCopyFile(tempJsonPath, jsonFinalPath);
              console.log(`✅ SUCCESS! Metadata JSON saved to: ${copiedPath}`);
              
              // Clean up temp file
              await FileSystem.deleteAsync(tempJsonPath, { idempotent: true });
              
              // Verify the file
              try {
                const fileInfo = await FileSystem.getInfoAsync(jsonFinalPath);
                if (fileInfo.exists) {
                  const sizeKB = Math.round((fileInfo.size || 0) / 1024);
                  console.log(`✓ File verified! Size: ${sizeKB} KB`);
                  console.log(`📂 Location: ${jsonFinalPath}`);
                } else {
                  console.warn(`⚠️ File not found after copy: ${jsonFinalPath}`);
                }
              } catch (verifyError) {
                console.error(`❌ Error verifying file:`, verifyError);
              }
              
            } catch (exportError: any) {
              console.error('❌ Failed to export metadata JSON:', exportError);
              console.error('Error details:', exportError?.message || exportError);
              // Don't fail the recording save if JSON export fails
            }
          } else {
            console.warn(`⚠️ sessionStorageDirRef.current is not set - cannot export JSON`);
          }
        }
      }

      setSaveProgress(60);

      const localRecording = await upsertLocalRecordingEntry(finalChunksArray, savedAudioPath);
      if (!localRecording) {
        throw new Error('Failed to save local recording entry');
      }

      // Finish the save UI immediately — upload happens silently in background
      setSaveProgress(100);
      showToast('Recording saved');
      
      // Wait briefly to show 100% before resetting
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setCurrentRecording(null);
      currentRecordingRef.current = null;
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

    const AUTO_UPLOAD_KEY = 'xow_auto_upload_state';
    const setProgress = (p: number) =>
      AsyncStorage.setItem(AUTO_UPLOAD_KEY, JSON.stringify({ localId: recording.localId, progress: p })).catch(() => {});

    console.log('Starting upload for recording:', recording.localId);

    // Signal gallery: auto-upload starting
    await setProgress(1);

    try {
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
        const totalChunks = recording.videoChunks.length;
        console.log(`Uploading ${totalChunks} video chunks...`);

        for (let i = 0; i < totalChunks; i++) {
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
          // Video chunks = 5%–90% of total progress
          await setProgress(5 + Math.round(((i + 1) / totalChunks) * 85));
        }
        console.log('✓ All chunks uploaded successfully');
      } else if (recording.videoPath) {
        // Legacy single file upload
        await setProgress(30);
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
        await setProgress(75);
      }

      if (recording.audioPath) {
        await setProgress(90);
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
      }

      await setProgress(95);

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

      // Signal gallery: upload complete (removing key triggers refresh)
      await AsyncStorage.removeItem(AUTO_UPLOAD_KEY);

      return recordingId;
    } catch (e) {
      await AsyncStorage.removeItem(AUTO_UPLOAD_KEY).catch(() => {});
      throw e;
    }
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
    
    // Play visitor entry sound
    try {
      const { sound } = await Audio.Sound.createAsync(
        require('../assets/sounds/visitor-log.mp3')
      );
      await sound.playAsync();
      // Unload sound after playing to free memory
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
        }
      });
    } catch (error) {
      console.log('Error playing visitor sound:', error);
    }
    
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
    setExitConfirmText('');
    setShowExitModal(true);
  };

  const confirmExit = async () => {
    if (exitConfirmText.toLowerCase() !== 'exit') {
      Alert.alert('Invalid Input', 'Please type "exit" to confirm.');
      return;
    }
    setShowExitModal(false);
    setExitConfirmText('');
    try {
      const device_id = await AsyncStorage.getItem('xow_permanent_device_id');
      const password  = await AsyncStorage.getItem('xow_permanent_device_password');
      if (device_id && password) {
        await axios.post(
          `${API_URL}/api/devices/${device_id}/remove-pairing?password=${password}`
        );
      }
    } catch (_) {
      // ignore unpair errors — still clear local state
    }
    await AsyncStorage.removeItem('xow_is_paired');
    router.replace('/');
  };

  // Auto-request camera permission if not granted
  if (!cameraPermission?.granted) {
    requestCameraPermission();
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
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            mode="video"
            mute={false}
            videoQuality="480p"
            videoBitrate={2500000}
          />

        {/* Top Bar */}
        <View style={styles.topBar}>
          <View style={styles.deviceSection}>
            <View style={styles.idBadge}>
              <Ionicons name="hardware-chip" size={14} color="#E54B2A" />
              <Text style={styles.idText}>{device?.device_id || '---'}</Text>
            </View>
          </View>
          {isRecording && (
            <View style={styles.recBadge}>
              <Animated.View style={[styles.recDot, { opacity: blinkAnim }]} />
              <Text style={styles.recText}>REC</Text>
              {videoRecordingActive && <Text style={styles.videoIndicator}>VIDEO</Text>}
            </View>
          )}
          <View style={[styles.pairingBadge, isPaired ? styles.pairingPaired : styles.pairingInactive]}>
            <View style={[styles.pairingDot, isPaired ? styles.pairingDotPaired : styles.pairingDotInactive]} />
            <Text style={[styles.pairingText, isPaired ? styles.pairingTextPaired : styles.pairingTextInactive]}>
              {isPaired ? 'Device Paired' : 'Device Unpaired'}
            </Text>
          </View>
        </View>

        {/* Timecode Box — date/time only */}
        <View style={styles.tcBox}>
          <Text style={styles.tcLabel}>DATE</Text>
          <Text style={styles.tcVal}>{formatDate(currentTime)}</Text>
          <Text style={styles.tcLabel}>TIME</Text>
          <Text style={styles.tcVal}>{formatTime(currentTime)}</Text>
        </View>

        {/* Logo Watermark */}
        <View style={styles.watermark}>
          <Text style={styles.logoText}>XOW</Text>
        </View>

        {/* Visitor Count */}
        {isRecording && (
          <View style={styles.visitorBox}>
            <Ionicons name="people" size={28} color="#E54B2A" />
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
            <Ionicons name="checkmark-circle" size={24} color="#10B981" />
            <Text style={styles.toastText}>{toastMessage}</Text>
          </Animated.View>
        )}
        </View>{/* end cameraViewWrapper */}
      </View>

      {/* Control Panel */}
      <View style={[styles.panel, { width: panelWidth }]}>
        <View>
          <Text style={styles.boothName} numberOfLines={1}>{device?.name || 'Xow-box'}</Text>
          <Text style={styles.boothSub}>Expo Recording</Text>
          <View style={styles.uploadModeBadge}>
            <Ionicons name={autoUpload ? 'cloud' : 'save'} size={16} color={autoUpload ? '#E54B2A' : '#bcbcbc'} />
            <Text style={[styles.uploadModeText, { color: autoUpload ? '#E54B2A' : '#bcbcbc' }]}>
              {autoUpload ? 'Auto Upload' : 'Local Save'}
            </Text>
          </View>
          <View style={styles.storageBadge}>
            <Ionicons
              name={storageLocation === 'External' ? 'save' : 'phone-portrait'}
              size={16}
              color={storageLocation === 'External' ? '#E54B2A' : '#bcbcbc'}
            />
            <Text style={[styles.storageBadgeText, { color: storageLocation === 'External' ? '#E54B2A' : '#bcbcbc' }]}>
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
                <Animated.View style={[styles.recordIcon, { opacity: blinkAnim }]} />
              )}
            </View>
          </TouchableOpacity>
          <Text style={styles.recLabel}>
            {isSaving ? 'SAVING' : isRecording ? 'STOP' : 'RECORD'}
          </Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.actBtn} onPress={() => router.push('/gallery')}>
            <Ionicons name="folder" size={24} color="#E54B2A" />
            <Text style={[styles.actLabel, { color: '#E54B2A' }]}>Gallery</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actBtn} onPress={() => router.push('/settings')}>
            <Ionicons name="settings" size={24} color="#E54B2A" />
            <Text style={[styles.actLabel, { color: '#E54B2A' }]}>Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actBtn} onPress={handleLogout}>
            <Ionicons name="power" size={24} color="#E54B2A" />
            <Text style={[styles.actLabel, { color: '#E54B2A' }]}>Exit</Text>
          </TouchableOpacity>
        </View>
      </View>
      {/* Exit confirmation overlay */}
      {showExitModal && (
        <Pressable style={styles.exitOverlay} onPress={() => setShowExitModal(false)}>
          <Pressable style={styles.exitModal} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.exitTitle}>Exit and Unpair Device?</Text>
            <Text style={styles.exitSub}>This will unpair the device and return to the pairing screen.</Text>
            <Text style={styles.exitConfirmLabel}>Type "exit" to confirm:</Text>
            <TextInput
              style={styles.exitConfirmInput}
              value={exitConfirmText}
              onChangeText={setExitConfirmText}
              placeholder="exit"
              placeholderTextColor="#666"
              autoCapitalize="none"
              autoCorrect={false}
            />
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
    top: 15, 
    left: 20, 
    right: 20, 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'flex-start',
    gap: 15
  },
  deviceSection: { gap: 10, marginTop: 0 },
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
  pairingBadge: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 20, 
    paddingVertical: 11, 
    borderRadius: 10, 
    gap: 10 
  },
  pairingPaired: { backgroundColor: 'rgba(34, 197, 94, 0.15)' },
  pairingInactive: { backgroundColor: 'rgba(239, 68, 68, 0.15)' },
  pairingDot: { width: 11, height: 11, borderRadius: 6 },
  pairingDotPaired: { backgroundColor: '#22c55e' },
  pairingDotInactive: { backgroundColor: '#ef4444' },
  pairingText: { fontSize: 18, fontWeight: '700' },
  pairingTextPaired: { color: '#22c55e' },
  pairingTextInactive: { color: '#ef4444' },
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
    top: 72, 
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
    backgroundColor: '#E54B2A',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center'
  },
  logoText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 2
  },
  wmIcon: { width: 33, height: 33, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  wmText: { color: '#fff', fontSize: 23, fontWeight: '800', letterSpacing: 1.5 },
  wmLive: { color: '#fff', fontSize: 13, fontWeight: '700', backgroundColor: '#EF4444', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 5, marginLeft: 5 },
  
  visitorBox: { 
    position: 'absolute', 
    bottom: 22, 
    left: 22, 
    backgroundColor: 'rgba(0,0,0,0.85)', 
    paddingHorizontal: 20, 
    paddingVertical: 10, 
    borderRadius: 10, 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 10,
    minWidth: 80 
  },
  visitorNum: { color: '#fff', fontSize: 22, fontWeight: '800' },
  visitorLabel: { color: '#666', fontSize: 14 },
  
  durationBox: { 
    position: 'absolute', 
    bottom: 22, 
    alignSelf: 'center', 
    backgroundColor: 'rgba(0,0,0,0.85)', 
    paddingHorizontal: 20, 
    paddingVertical: 10, 
    borderRadius: 10, 
    borderWidth: 2, 
    borderColor: '#EF4444' 
  },
  durationText: { color: '#EF4444', fontSize: 22, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  
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
  exitSub: { color: '#888', fontSize: 25, textAlign: 'center', marginBottom: 28, lineHeight: 37 },
  exitConfirmLabel: { color: '#fff', fontSize: 23, fontWeight: '600', marginBottom: 14 },
  exitConfirmInput: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    paddingHorizontal: 21,
    paddingVertical: 19,
    fontSize: 25,
    color: '#fff',
    marginBottom: 35,
  },
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
    backgroundColor: '#E54B2A', 
    alignItems: 'center' 
  },
  exitConfirmText: { color: '#fff', fontSize: 25, fontWeight: '700' },
});
