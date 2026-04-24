import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import XowLogo from '../assets/images/xow-logo-light.svg';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// These keys are written ONCE and never removed — stable identity across restarts.
const DEVICE_ID_KEY   = 'xow_permanent_device_id';
const DEVICE_PWD_KEY  = 'xow_permanent_device_password';
const DEVICE_NAME_KEY = 'xow_permanent_device_name';

function randomHex(len: number) {
  let result = '';
  const chars = '0123456789abcdef';
  for (let i = 0; i < len; i++) result += chars[Math.floor(Math.random() * 16)];
  return result;
}

export default function SetupScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const [status, setStatus] = useState<'checking' | 'registering' | 'ready' | 'error'>('checking');
  const [pairingCode, setPairingCode] = useState('------');
  const [secondsLeft, setSecondsLeft] = useState(300);
  const [errorMsg, setErrorMsg] = useState('');
  const [showNetworkError, setShowNetworkError] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    init();
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, []);

  /** Read or create permanent credentials — never regenerated after first run. */
  const getOrCreateCredentials = async (): Promise<{ device_id: string; password: string }> => {
    let device_id = await AsyncStorage.getItem(DEVICE_ID_KEY);
    let password  = await AsyncStorage.getItem(DEVICE_PWD_KEY);

    if (!device_id || !password) {
      device_id = `xow-${randomHex(4)}-${randomHex(4)}`;
      password  = randomHex(16);
      await AsyncStorage.setItem(DEVICE_ID_KEY, device_id);
      await AsyncStorage.setItem(DEVICE_PWD_KEY, password);
    }

    return { device_id, password };
  };

  const init = async () => {
    try {
      console.log('🔧 Starting initialization...');
      console.log('🌐 Backend URL:', API_URL);
      setStatus('checking');
      const { device_id, password } = await getOrCreateCredentials();
      console.log('📱 Device ID:', device_id);

      // Try to reset pairing (also confirms the device exists on the server).
      try {
        console.log('🔄 Attempting to remove pairing...');
        const res = await axios.post(
          `${API_URL}/api/devices/${device_id}/remove-pairing?password=${password}`
        );
        console.log('✅ Remove pairing response:', res.data);
        const code = res.data?.new_pairing_code || '------';
        const secs  = res.data?.expires_in_seconds ?? 300;
        console.log('🔑 Pairing code:', code);
        // Always sync the server-assigned name so it stays up to date
        if (res.data?.name) {
          await AsyncStorage.setItem(DEVICE_NAME_KEY, res.data.name);
        }
        setPairingCode(code);
        startCountdown(secs);
        setStatus('ready');
        return;
      } catch (err: any) {
        console.log('❌ Remove pairing failed:', err.message);
        console.log('📊 Error response:', err.response?.data);
        const statusCode = err?.response?.status;
        console.log('🔢 Status code:', statusCode);

        if (statusCode === 401 || statusCode === 404 || statusCode === 500) {
          // Device not found or server error — register with the SAME permanent credentials.
          console.log('📝 Device not found or server error, registering...');
          await registerDevice(device_id, password);
          return;
        }

        // Network / server unreachable — show network error modal
        console.log('⚠️ Network issue, showing network error modal');
        setShowNetworkError(true);
        setStatus('ready');
      }
    } catch (e: any) {
      console.log('💥 Init error:', e.message);
      setStatus('error');
      setErrorMsg('Could not connect to server. Make sure the server is running.');
    }
  };

  const registerDevice = async (device_id: string, password: string) => {
    setStatus('registering');
    try {
      console.log('📝 Registering device...');
      const res = await axios.post(`${API_URL}/api/auth/register`, {
        device_id,
        password,
        name: 'Booth',  // backend will overwrite with auto-assigned sequential name
      });
      console.log('✅ Registration response:', res.data);
      const device = res.data;
      // Persist the server-assigned booth name permanently
      const assignedName = device.name || 'Booth';
      await AsyncStorage.setItem(DEVICE_NAME_KEY, assignedName);
      const code = device.pairing_code || '------';
      console.log('🔑 New pairing code:', code);
      setPairingCode(code);
      startCountdown(300);
      setStatus('ready');
    } catch (e: any) {
      console.log('❌ Registration failed:', e.message);
      console.log('📊 Error response:', e.response?.data);
      // Check if it's a network error
      if (!e.response) {
        setShowNetworkError(true);
        setStatus('ready');
      } else {
        setStatus('error');
        setErrorMsg(e.response?.data?.detail || 'Registration failed. Please retry.');
      }
    }
  };

  const startCountdown = (secs: number) => {
    setSecondsLeft(secs);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          // When timer expires, regenerate a new pairing code
          regeneratePairingCode();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const regeneratePairingCode = async () => {
    try {
      const device_id = await AsyncStorage.getItem(DEVICE_ID_KEY);
      const password = await AsyncStorage.getItem(DEVICE_PWD_KEY);
      if (!device_id || !password) return;

      const res = await axios.post(
        `${API_URL}/api/devices/${device_id}/remove-pairing?password=${password}`
      );
      const code = res.data?.new_pairing_code || '------';
      const secs = res.data?.expires_in_seconds ?? 300;
      
      if (!res.data) {
        setShowNetworkError(true);
      } else {
        setPairingCode(code);
        startCountdown(secs);
      }
    } catch (e: any) {
      // If regeneration fails due to network, show error modal
      if (!e.response) {
        setShowNetworkError(true);
      } else {
        setPairingCode('------');
        startCountdown(300);
      }
    }
  };

  const pollPairingStatus = async () => {
    try {
      const device_id = await AsyncStorage.getItem(DEVICE_ID_KEY);
      const password  = await AsyncStorage.getItem(DEVICE_PWD_KEY);
      if (!device_id || !password) return;
      const res = await axios.get(
        `${API_URL}/api/devices/${device_id}/pairing-code?password=${password}`
      );
      if (res.data?.is_paired) {
        router.replace('/recorder');
      }
    } catch (_) {
      // silently ignore polling errors
    }
  };


  useEffect(() => {
    if (status !== 'ready') return;
    const interval = setInterval(pollPairingStatus, 3000);
    return () => clearInterval(interval);
  }, [status]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  // Show pairing screen immediately, even while checking/registering
  const isLoading = status === 'checking' || status === 'registering';

  // ── Error ──────────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <View style={[styles.center, { width, height }]}> 
        <View style={styles.logo}>
          <Ionicons name="videocam" size={28} color="#fff" />
        </View>
        <Text style={styles.brandName}>XoW</Text>
        <Ionicons name="alert-circle" size={40} color="#EF4444" style={{ marginTop: 24 }} />
        <Text style={styles.errorText}>{errorMsg}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={init}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Ready — show pairing code ──────────────────────────────────────────────
  return (
    <View style={[styles.container, { width, height }]}>
      {/* Left branding panel */}
      <View style={styles.leftPanel}>
        <XowLogo
          width={280}
          height={280}
          style={styles.logo}
        />
        
        <Text style={styles.tagline}>Exhibiton Watch</Text>
        <View style={styles.features}>
          <View style={styles.feature}>
            <Ionicons name="recording" size={20} color="#E54B2A" />
            <Text style={styles.featureText}>HD Recording</Text>
          </View>
          <View style={styles.feature}>
            <Ionicons name="scan" size={20} color="#E54B2A" />
            <Text style={styles.featureText}>Visitor Tracking</Text>
          </View>
          <View style={styles.feature}>
            <Ionicons name="analytics" size={20} color="#E54B2A" />
            <Text style={styles.featureText}>Expo Analytics</Text>
          </View>
        </View>
      </View>

      {/* Right panel — pairing code */}
      <View style={styles.rightPanel}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="link" size={32} color="#E54B2A" />
            <Text style={styles.cardTitle}>Connect to Dashboard</Text>
          </View>
          <Text style={styles.cardSub}>
            Open the XoW web dashboard and enter this code under Devices
          </Text>

          <View style={styles.codeBox}>
            <Text style={styles.codeText}>{pairingCode}</Text>
          </View>

          <View style={styles.timerRow}>
            <Ionicons name="time-outline" size={22} color="#555" />
            <Text style={styles.timerText}>Refreshes in {formatTime(secondsLeft)}</Text>
          </View>

          <Text style={styles.hint}>
            {isLoading ? 'Initializing device…' : 'Waiting for pairing… The app will open automatically once connected.'}
          </Text>

          <View style={styles.waitingRow}>
            <ActivityIndicator color="#E54B2A" size="small" />
            <Text style={styles.waitingText}>
              {isLoading ? 'Setting up' : 'Waiting for connection'}
            </Text>
          </View>
        </View>
      </View>

      {/* Network Error Modal */}
      <Modal
        visible={showNetworkError}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNetworkError(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalIconContainer}>
              <Ionicons name="cloud-offline" size={60} color="#EF4444" />
            </View>
            <Text style={styles.modalTitle}>Network Connection Error</Text>
            <Text style={styles.modalMessage}>
              Unable to connect to the server. Please check your network connection and try again.
            </Text>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => {
                setShowNetworkError(false);
                init();
              }}
            >
              <Ionicons name="refresh" size={24} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.modalButtonText}>Retry Connection</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => setShowNetworkError(false)}
            >
              <Text style={styles.modalCancelText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, flexDirection: 'row', backgroundColor: '#000' },

  logo: { marginBottom: -70 },
  brandName: { fontSize: 70, fontWeight: '800', color: '#fff' },
  tagline: { fontSize: 22, color: '#666', marginBottom: 35 },

  loadingText: { color: '#555', fontSize: 26, marginTop: 22 },
  errorText: { color: '#EF4444', fontSize: 26, textAlign: 'center', marginTop: 22, paddingHorizontal: 44 },
  retryBtn: { marginTop: 35, paddingHorizontal: 44, paddingVertical: 20, backgroundColor: '#E54B2A', borderRadius: 13 },
  retryText: { color: '#fff', fontWeight: '600', fontSize: 26 },
  skipBtn: { marginTop: 26, paddingHorizontal: 44, paddingVertical: 20, borderRadius: 13, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#111' },
  skipText: { color: '#fff', fontWeight: '600', fontSize: 26 },

  leftPanel: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  features: { gap: 18 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  featureText: { color: '#888', fontSize: 24 },

  rightPanel: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  card: { width: '100%', maxWidth: 530, backgroundColor: '#0a0a0a', borderRadius: 26, padding: 40 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 15 },
  cardTitle: { color: '#fff', fontSize: 31, fontWeight: '700' },
  cardSub: { color: '#666', fontSize: 22, lineHeight: 31, marginBottom: 26 },

  codeBox: { backgroundColor: 'rgba(229,75,42,0.1)', borderWidth: 3, borderColor: 'rgba(229,75,42,0.3)', borderRadius: 22, paddingVertical: 31, alignItems: 'center', marginBottom: 18 },
  codeText: { color: '#fff', fontSize: 70, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 18 },

  timerRow: { flexDirection: 'row', alignItems: 'center', gap: 9, justifyContent: 'center', marginBottom: 26 },
  timerText: { color: '#555', fontSize: 20 },

  hint: { color: '#444', fontSize: 20, textAlign: 'center', marginBottom: 29, lineHeight: 29 },

  waitingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 },
  waitingText: { color: '#555', fontSize: 22 },

  // Network Error Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: '#0a0a0a', borderRadius: 24, padding: 40, width: '100%', maxWidth: 500, borderWidth: 1, borderColor: '#1a1a1a', alignItems: 'center' },
  modalIconContainer: { marginBottom: 24, backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 60, width: 120, height: 120, justifyContent: 'center', alignItems: 'center' },
  modalTitle: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  modalMessage: { color: '#888', fontSize: 20, lineHeight: 30, textAlign: 'center', marginBottom: 32 },
  modalButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#E54B2A', paddingVertical: 18, paddingHorizontal: 36, borderRadius: 14, width: '100%', marginBottom: 12 },
  modalButtonText: { color: '#fff', fontSize: 22, fontWeight: '600' },
  modalCancelButton: { paddingVertical: 14, paddingHorizontal: 24 },
  modalCancelText: { color: '#666', fontSize: 20, fontWeight: '500' },
});
