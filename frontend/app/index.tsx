import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
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
      setStatus('checking');
      const { device_id, password } = await getOrCreateCredentials();

      // Try to reset pairing (also confirms the device exists on the server).
      try {
        const res = await axios.post(
          `${API_URL}/api/devices/${device_id}/remove-pairing?password=${password}`
        );
        const code = res.data?.new_pairing_code || '------';
        const secs  = res.data?.expires_in_seconds ?? 300;
        // Always sync the server-assigned name so it stays up to date
        if (res.data?.name) {
          await AsyncStorage.setItem(DEVICE_NAME_KEY, res.data.name);
        }
        setPairingCode(code);
        startCountdown(secs);
        setStatus('ready');
        return;
      } catch (err: any) {
        const statusCode = err?.response?.status;

        if (statusCode === 401 || statusCode === 404) {
          // Device not found on server — register with the SAME permanent credentials.
          await registerDevice(device_id, password);
          return;
        }

        // Network / server unreachable — show pairing screen without a live code.
        setPairingCode('------');
        startCountdown(300);
        setStatus('ready');
      }
    } catch (e) {
      setStatus('error');
      setErrorMsg('Could not connect to server. Make sure the server is running.');
    }
  };

  const registerDevice = async (device_id: string, password: string) => {
    setStatus('registering');
    try {
      const res = await axios.post(`${API_URL}/api/auth/register`, {
        device_id,
        password,
        name: 'Booth',  // backend will overwrite with auto-assigned sequential name
      });
      const device = res.data;
      // Persist the server-assigned booth name permanently
      const assignedName = device.name || 'Booth';
      await AsyncStorage.setItem(DEVICE_NAME_KEY, assignedName);
      const code = device.pairing_code || '------';
      setPairingCode(code);
      startCountdown(300);
      setStatus('ready');
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e.response?.data?.detail || 'Registration failed. Please retry.');
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
      
      setPairingCode(code);
      startCountdown(secs);
    } catch (error) {
      // If regeneration fails, try again in 5 minutes
      setPairingCode('------');
      startCountdown(300);
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

  // ── Loading / Registering ──────────────────────────────────────────────────
  if (status === 'checking' || status === 'registering') {
    return (
      <View style={[styles.center, { width, height }]}>
        <View style={styles.logo}>
          <Ionicons name="videocam" size={28} color="#fff" />
        </View>
        <Text style={styles.brandName}>XoW</Text>
        <ActivityIndicator color="#E54B2A" size="large" style={{ marginTop: 24 }} />
        <Text style={styles.loadingText}>
          {status === 'checking' ? 'Starting up…' : 'Setting up your device…'}
        </Text>
      </View>
    );
  }

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
        
        <Text style={styles.tagline}>Booth Recording System</Text>
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
            <Ionicons name="cloud" size={20} color="#E54B2A" />
            <Text style={styles.featureText}>Cloud Sync</Text>
          </View>
        </View>
      </View>

      {/* Right panel — pairing code */}
      <View style={styles.rightPanel}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="link" size={32} color="#8B5CF6" />
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
            Waiting for pairing… The app will open automatically once connected.
          </Text>

          <View style={styles.waitingRow}>
            <ActivityIndicator color="#8B5CF6" size="small" />
            <Text style={styles.waitingText}>Waiting for connection</Text>
          </View>
        </View>
      </View>
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

  leftPanel: { flex: 1, justifyContent: 'center', alignItems: 'center', borderRightWidth: 1, borderRightColor: '#1a1a1a', padding: 40 },
  features: { gap: 18 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  featureText: { color: '#888', fontSize: 24 },

  rightPanel: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  card: { width: '100%', maxWidth: 530, backgroundColor: '#0a0a0a', borderRadius: 26, padding: 40, borderWidth: 1, borderColor: '#1a1a1a' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 15 },
  cardTitle: { color: '#fff', fontSize: 31, fontWeight: '700' },
  cardSub: { color: '#666', fontSize: 22, lineHeight: 31, marginBottom: 26 },

  codeBox: { backgroundColor: 'rgba(139,92,246,0.1)', borderWidth: 3, borderColor: 'rgba(139,92,246,0.3)', borderRadius: 22, paddingVertical: 31, alignItems: 'center', marginBottom: 18 },
  codeText: { color: '#fff', fontSize: 70, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 18 },

  timerRow: { flexDirection: 'row', alignItems: 'center', gap: 9, justifyContent: 'center', marginBottom: 26 },
  timerText: { color: '#555', fontSize: 20 },

  hint: { color: '#444', fontSize: 20, textAlign: 'center', marginBottom: 29, lineHeight: 29 },

  waitingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 },
  waitingText: { color: '#555', fontSize: 22 },
});
