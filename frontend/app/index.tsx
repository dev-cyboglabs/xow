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
      setSecondsLeft(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
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

  const skipToApp = () => {
    router.replace('/recorder');
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
        <TouchableOpacity style={styles.skipBtn} onPress={skipToApp}>
          <Text style={styles.skipText}>Skip for Testing</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Ready — show pairing code ──────────────────────────────────────────────
  return (
    <View style={[styles.container, { width, height }]}>
      {/* Left branding panel */}
      <View style={styles.leftPanel}>
        <View style={styles.logo}>
          <Ionicons name="videocam" size={28} color="#fff" />
        </View>
        <Text style={styles.brandName}>XoW</Text>
        <Text style={styles.tagline}>Booth Recording System</Text>
        <View style={styles.features}>
          <View style={styles.feature}>
            <Ionicons name="recording" size={14} color="#E54B2A" />
            <Text style={styles.featureText}>HD Recording</Text>
          </View>
          <View style={styles.feature}>
            <Ionicons name="scan" size={14} color="#E54B2A" />
            <Text style={styles.featureText}>Visitor Tracking</Text>
          </View>
          <View style={styles.feature}>
            <Ionicons name="cloud" size={14} color="#E54B2A" />
            <Text style={styles.featureText}>Cloud Sync</Text>
          </View>
        </View>
      </View>

      {/* Right panel — pairing code */}
      <View style={styles.rightPanel}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="link" size={18} color="#8B5CF6" />
            <Text style={styles.cardTitle}>Connect to Dashboard</Text>
          </View>
          <Text style={styles.cardSub}>
            Open the XoW web dashboard and enter this code under Devices
          </Text>

          <View style={styles.codeBox}>
            <Text style={styles.codeText}>{pairingCode}</Text>
          </View>

          <View style={styles.timerRow}>
            <Ionicons name="time-outline" size={12} color="#555" />
            <Text style={styles.timerText}>Refreshes in {formatTime(secondsLeft)}</Text>
          </View>

          <Text style={styles.hint}>
            Waiting for pairing… The app will open automatically once connected.
          </Text>

          <View style={styles.waitingRow}>
            <ActivityIndicator color="#8B5CF6" size="small" />
            <Text style={styles.waitingText}>Waiting for connection</Text>
          </View>

          <TouchableOpacity style={styles.skipBtn} onPress={skipToApp}>
            <Text style={styles.skipText}>Skip for Testing</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, flexDirection: 'row', backgroundColor: '#000' },

  logo: { width: 50, height: 50, borderRadius: 12, backgroundColor: '#E54B2A', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  brandName: { fontSize: 32, fontWeight: '800', color: '#fff' },
  tagline: { fontSize: 11, color: '#666', marginBottom: 20 },

  loadingText: { color: '#555', fontSize: 13, marginTop: 12 },
  errorText: { color: '#EF4444', fontSize: 13, textAlign: 'center', marginTop: 12, paddingHorizontal: 32 },
  retryBtn: { marginTop: 20, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: '#E54B2A', borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  skipBtn: { marginTop: 14, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#111' },
  skipText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  leftPanel: { flex: 1, justifyContent: 'center', alignItems: 'center', borderRightWidth: 1, borderRightColor: '#1a1a1a', padding: 20 },
  features: { gap: 8 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  featureText: { color: '#888', fontSize: 11 },

  rightPanel: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 280, backgroundColor: '#0a0a0a', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#1a1a1a' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  cardSub: { color: '#666', fontSize: 11, lineHeight: 16, marginBottom: 16 },

  codeBox: { backgroundColor: 'rgba(139,92,246,0.1)', borderWidth: 1, borderColor: 'rgba(139,92,246,0.3)', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 8 },
  codeText: { color: '#fff', fontSize: 32, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 8 },

  timerRow: { flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'center', marginBottom: 14 },
  timerText: { color: '#555', fontSize: 10 },

  hint: { color: '#444', fontSize: 10, textAlign: 'center', marginBottom: 16, lineHeight: 15 },

  waitingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  waitingText: { color: '#555', fontSize: 11 },
});
