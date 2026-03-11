import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
  ScrollView,
  useWindowDimensions,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

interface StorageSettings {
  autoUpload: boolean;
  storageLocation: 'internal' | 'external';
}

export default function SettingsScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const [settings, setSettings] = useState<StorageSettings>({
    autoUpload: false,
    storageLocation: 'internal',
  });
  const [deviceName, setDeviceName] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [externalAvailable, setExternalAvailable] = useState(false);

  useEffect(() => {
    loadSettings();
    loadDevice();
    checkExternalStorage();
  }, []);

  const checkExternalStorage = async () => {
    if (Platform.OS !== 'android') {
      setExternalAvailable(false);
      return;
    }
    try {
      const mounts = await FileSystem.readAsStringAsync('file:///proc/mounts');
      const REMOVABLE_FS = new Set(['vfat', 'exfat', 'fuse', 'fuseblk', 'ntfs', 'sdcardfs', 'sdfat', 'texfat']);
      for (const line of mounts.split('\n')) {
        const parts = line.split(' ');
        if (parts.length < 3) continue;
        const mountPoint = parts[1];
        const fsType = parts[2];
        if (
          mountPoint.startsWith('/storage/') &&
          !mountPoint.includes('emulated') &&
          REMOVABLE_FS.has(fsType)
        ) {
          setExternalAvailable(true);
          return;
        }
      }
      setExternalAvailable(false);
    } catch (e) {
      setExternalAvailable(false);
    }
  };

  const loadSettings = async () => {
    try {
      const saved = await AsyncStorage.getItem('xow_settings');
      if (saved) setSettings(JSON.parse(saved));
    } catch (e) {
      console.error('Load settings error:', e);
    }
  };

  const loadDevice = async () => {
    try {
      const device_id = await AsyncStorage.getItem('xow_permanent_device_id');
      const name      = await AsyncStorage.getItem('xow_permanent_device_name');
      if (device_id) {
        setDeviceName(name || 'Booth');
        setDeviceId(device_id);
      }
    } catch (e) {
      console.error('Load device error:', e);
    }
  };

  const saveSettings = async (newSettings: StorageSettings) => {
    try {
      await AsyncStorage.setItem('xow_settings', JSON.stringify(newSettings));
      setSettings(newSettings);
    } catch (e) {
      console.error('Save settings error:', e);
    }
  };

  const toggleAutoUpload = () => saveSettings({ ...settings, autoUpload: !settings.autoUpload });

  const setStorageLocation = (location: 'internal' | 'external') => {
    saveSettings({ ...settings, storageLocation: location });
    Alert.alert('Storage Updated', `Recordings will be saved to ${getLocationName(location)}`);
  };

  const getLocationName = (location: string) => {
    switch (location) {
      case 'internal': return 'Internal Storage';
      case 'external': return 'External Storage (SD Card)';
      default: return 'Unknown';
    }
  };

  const sidebarWidth = Math.min(90, width * 0.12);

  return (
    <View style={[styles.container, { width, height }]}>
      {/* Sidebar */}
      <View style={[styles.sidebar, { width: sidebarWidth }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={styles.sidebarIcon}>
          <Ionicons name="settings" size={24} color="#E54B2A" />
        </View>
      </View>

      {/* Content */}
      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Settings</Text>
          <Text style={styles.headerSub}>Configure storage and upload preferences</Text>
        </View>

        <View style={styles.sections}>
          {/* Device Info Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="phone-portrait" size={16} color="#E54B2A" />
              <Text style={styles.sectionTitle}>Device Info</Text>
            </View>
            <View style={styles.card}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Device Name</Text>
                <Text style={styles.infoValue}>{deviceName || 'Unknown Device'}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Device ID</Text>
                <Text style={[styles.infoValue, { fontFamily: 'monospace', fontSize: 12 }]}>{deviceId || '—'}</Text>
              </View>
            </View>
          </View>

          {/* Cloud Sync Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="cloud" size={16} color="#3B82F6" />
              <Text style={styles.sectionTitle}>Cloud Sync</Text>
            </View>
            <View style={styles.card}>
              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>Auto Upload</Text>
                  <Text style={styles.settingDesc}>
                    Automatically upload recordings when finished
                  </Text>
                </View>
                <Switch
                  value={settings.autoUpload}
                  onValueChange={toggleAutoUpload}
                  trackColor={{ false: '#333', true: '#E54B2A' }}
                  thumbColor={settings.autoUpload ? '#fff' : '#666'}
                />
              </View>
              <Text style={styles.hintText}>
                {settings.autoUpload
                  ? 'Recordings will upload automatically after recording stops'
                  : 'Recordings will be saved locally. Upload manually from Gallery.'}
              </Text>
            </View>
          </View>

          {/* Storage Location Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="folder" size={16} color="#10B981" />
              <Text style={styles.sectionTitle}>Storage Location</Text>
            </View>
            <View style={styles.card}>
              <TouchableOpacity
                style={[styles.locationOption, settings.storageLocation === 'internal' && styles.locationActive]}
                onPress={() => setStorageLocation('internal')}
              >
                <Ionicons name="phone-portrait" size={18} color={settings.storageLocation === 'internal' ? '#E54B2A' : '#666'} />
                <View style={styles.locationInfo}>
                  <Text style={[styles.locationTitle, settings.storageLocation === 'internal' && styles.locationTitleActive]}>
                    Internal Storage
                  </Text>
                  <Text style={styles.locationDesc}>Audio files saved to device memory</Text>
                </View>
                {settings.storageLocation === 'internal' && (
                  <Ionicons name="checkmark-circle" size={20} color="#E54B2A" />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.locationOption,
                  settings.storageLocation === 'external' && styles.locationActive,
                  !externalAvailable && styles.locationDisabled
                ]}
                onPress={() => {
                  if (!externalAvailable) {
                    Alert.alert(
                      'External Storage Not Available',
                      'No SD card or USB drive detected. Please insert external storage and try again.',
                      [{ text: 'OK' }]
                    );
                  } else {
                    setStorageLocation('external');
                  }
                }}
                disabled={!externalAvailable}
              >
                <Ionicons name="save" size={18} color={!externalAvailable ? '#444' : settings.storageLocation === 'external' ? '#E54B2A' : '#666'} />
                <View style={styles.locationInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[
                      styles.locationTitle,
                      settings.storageLocation === 'external' && styles.locationTitleActive,
                      !externalAvailable && styles.locationTitleDisabled
                    ]}>
                      External Storage
                    </Text>
                    {externalAvailable ? (
                      <View style={styles.availableBadge}>
                        <Text style={styles.availableBadgeText}>Available</Text>
                      </View>
                    ) : (
                      <View style={styles.unavailableBadge}>
                        <Text style={styles.unavailableBadgeText}>Not Detected</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.locationDesc, !externalAvailable && { color: '#444' }]}>
                    Audio files saved to SD Card / USB {!externalAvailable && '(not connected)'}
                  </Text>
                </View>
                {settings.storageLocation === 'external' && externalAvailable && (
                  <Ionicons name="checkmark-circle" size={20} color="#E54B2A" />
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Storage Info */}
          <View style={styles.section}>
            <View style={styles.infoCard}>
              <Ionicons name="information-circle" size={18} color="#F59E0B" />
              <Text style={styles.infoText}>
                Videos are saved to your device's Gallery (DCIM/Movies) and are accessible from your phone's Photos/Gallery app.
                Audio files are saved to the selected storage location for processing.
                All recordings can be uploaded to the cloud from the Gallery tab.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: '#000' },

  // Sidebar
  sidebar: { backgroundColor: '#0a0a0a', borderRightWidth: 1, borderRightColor: '#1a1a1a', padding: 10, alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' },
  sidebarIcon: { width: 36, height: 36, borderRadius: 8, backgroundColor: 'rgba(139,92,246,0.15)', justifyContent: 'center', alignItems: 'center' },

  // Content
  content: { flex: 1 },
  contentInner: { padding: 16 },
  header: { marginBottom: 20 },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  headerSub: { color: '#555', fontSize: 11, marginTop: 4 },

  sections: { gap: 20 },

  section: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { color: '#888', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  card: { backgroundColor: '#0a0a0a', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#1a1a1a' },

  // Info Row
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  infoLabel: { color: '#666', fontSize: 12 },
  infoValue: { color: '#fff', fontSize: 13, fontWeight: '500' },
  hintText: { color: '#555', fontSize: 10, marginTop: 10 },

  // Setting Row
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  settingInfo: { flex: 1, marginRight: 16 },
  settingLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  settingDesc: { color: '#666', fontSize: 11, marginTop: 2 },

  // Location Options
  locationOption: { flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 8, borderRadius: 8, backgroundColor: '#111', borderWidth: 1, borderColor: '#222' },
  locationActive: { borderColor: '#E54B2A', backgroundColor: 'rgba(229,75,42,0.1)' },
  locationDisabled: { opacity: 0.5, borderColor: '#1a1a1a' },
  locationInfo: { flex: 1, marginLeft: 12 },
  locationTitle: { color: '#888', fontSize: 13, fontWeight: '500' },
  locationTitleActive: { color: '#fff' },
  locationTitleDisabled: { color: '#444' },
  locationDesc: { color: '#555', fontSize: 10, marginTop: 2 },

  // Storage Availability Badges
  availableBadge: { paddingHorizontal: 6, paddingVertical: 2, backgroundColor: 'rgba(16,185,129,0.2)', borderRadius: 4 },
  availableBadgeText: { color: '#10B981', fontSize: 9, fontWeight: '600' },
  unavailableBadge: { paddingHorizontal: 6, paddingVertical: 2, backgroundColor: 'rgba(239,68,68,0.2)', borderRadius: 4 },
  unavailableBadgeText: { color: '#EF4444', fontSize: 9, fontWeight: '600' },

  // Info Card
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', padding: 12, backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: 8, gap: 10 },
  infoText: { flex: 1, color: '#F59E0B', fontSize: 11, lineHeight: 16 },
});
