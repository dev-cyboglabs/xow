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

function randomHex(len: number) {
  let result = '';
  const chars = '0123456789abcdef';
  for (let i = 0; i < len; i++) result += chars[Math.floor(Math.random() * 16)];
  return result;
}

function generateDeviceId() {
  return `xow-${randomHex(4)}-${randomHex(4)}`;
}

function generatePassword() {
  return randomHex(16);
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

  const init = async () => {
    try {
      const saved = await AsyncStorage.getItem('xow_device');
      if (saved) {
        // Already registered — go straight to the app
        router.replace('/recorder');
        return;
      }
      // First launch — auto-register
      await autoRegister();
    } catch (e) {
      setStatus('error');
      setErrorMsg('Could not connect to server. Make sure the server is running.');
    }
  };

  const autoRegister = async () => {
    setStatus('registering');
    const device_id = generateDeviceId();
    const password = generatePassword();
    try {
      const res = await axios.post(`${API_URL}/api/auth/register`, {
        device_id,
        password,
        name: 'Expo Booth',
      });
      const device = res.data;
      await AsyncStorage.setItem('xow_device', JSON.stringify(device));
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

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  const goToRecorder = () => router.replace('/recorder');

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
        <TouchableOpacity style={styles.retryBtn} onPress={autoRegister}>
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
            You can always find this code in Settings. It's safe to skip for now.
          </Text>

          <TouchableOpacity style={styles.startBtn} onPress={goToRecorder}>
            <Ionicons name="arrow-forward" size={16} color="#fff" />
            <Text style={styles.startText}>Start Recording</Text>
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

  startBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#E54B2A', borderRadius: 10, paddingVertical: 12 },
  startText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
