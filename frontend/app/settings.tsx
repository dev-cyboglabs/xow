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
  NativeModules,
  NativeEventEmitter,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

const EXTERNAL_STORAGE_URI_KEY = 'xow_external_storage_uri';

interface StorageSettings {
  autoUpload: boolean;
  storageLocation: 'internal' | 'external';
}

export default function SettingsScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const usbStorageModule = Platform.OS === 'android' ? NativeModules.UsbStorage : null;
  const [settings, setSettings] = useState<StorageSettings>({
    autoUpload: false,
    storageLocation: 'internal',
  });
  const [deviceName, setDeviceName] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [externalAvailable, setExternalAvailable] = useState(false);
  const [usbAttached, setUsbAttached] = useState(false);
  const [needsUsbAccess, setNeedsUsbAccess] = useState(false);
  const [volumeLabel, setVolumeLabel] = useState('');

  useEffect(() => {
    loadSettings();
    loadDevice();
    checkExternalStorage();

    if (usbStorageModule?.startListening) {
      usbStorageModule.startListening();
    }

    const eventEmitter = usbStorageModule ? new NativeEventEmitter(usbStorageModule) : null;
    const subscription = eventEmitter?.addListener('usbStorageChanged', async (event?: { connected?: boolean }) => {
      setUsbAttached(Boolean(event?.connected));
      await checkExternalStorage();
    });

    if (usbStorageModule?.isUsbDeviceAttached) {
      usbStorageModule.isUsbDeviceAttached()
        .then((attached: boolean) => {
          setUsbAttached(attached);
          if (attached) {
            checkExternalStorage();
          }
        })
        .catch(() => {});
    }
    
    // Check for external storage every 3 seconds to detect when device is plugged in
    const interval = setInterval(() => {
      checkExternalStorage();
    }, 3000);
    
    return () => {
      subscription?.remove();
      if (usbStorageModule?.stopListening) {
        usbStorageModule.stopListening();
      }
      clearInterval(interval);
    };
  }, []);

  const checkExternalStorage = async () => {
    if (Platform.OS !== 'android') {
      setExternalAvailable(false);
      setNeedsUsbAccess(false);
      return;
    }

    try {
      // Primary source of truth: StorageManager removable volumes
      let volumes: Array<{ description: string; state: string; isRemovable: boolean }> = [];
      if (usbStorageModule?.getRemovableVolumes) {
        volumes = await usbStorageModule.getRemovableVolumes();
      }

      const physicallyPresent = volumes.length > 0;
      setUsbAttached(physicallyPresent);

      if (!physicallyPresent) {
        // Nothing plugged in — clear everything
        setExternalAvailable(false);
        setNeedsUsbAccess(false);
        setVolumeLabel('');
        const stale = await AsyncStorage.getItem(EXTERNAL_STORAGE_URI_KEY);
        if (stale) await AsyncStorage.removeItem(EXTERNAL_STORAGE_URI_KEY);
        console.log('✗ No removable storage mounted');
        return;
      }

      // Something is mounted — try to get a writable path
      const label = volumes[0]?.description || 'USB Drive';
      setVolumeLabel(label);
      console.log(`✓ Removable volume detected: ${label}`);

      // Check for a previously granted SAF URI first
      const storedUri = await AsyncStorage.getItem(EXTERNAL_STORAGE_URI_KEY);
      if (storedUri) {
        setExternalAvailable(true);
        setNeedsUsbAccess(false);
        console.log('✓ External storage available (SAF permission stored)');
        return;
      }

      // Try to get a writable app-specific path directly
      if (usbStorageModule?.getWritableExternalStoragePath) {
        const nativePath = await usbStorageModule.getWritableExternalStoragePath();
        if (nativePath) {
          setExternalAvailable(true);
          setNeedsUsbAccess(false);
          console.log('✓ External storage writable via native path:', nativePath);
          return;
        }
      }

      // Volume is mounted but app cannot write directly — user must grant SAF access
      setExternalAvailable(false);
      setNeedsUsbAccess(true);
      console.log('⚠ Volume mounted but needs SAF access grant');
    } catch (e) {
      console.log('External storage check error:', e);
      setExternalAvailable(false);
      setNeedsUsbAccess(false);
    }
  };

  const requestUsbAccess = async () => {
    if (Platform.OS !== 'android') return;
    try {
      const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permission.granted || !permission.directoryUri) {
        return;
      }
      await AsyncStorage.setItem(EXTERNAL_STORAGE_URI_KEY, permission.directoryUri);
      if (settings.storageLocation !== 'external') {
        await saveSettings({ ...settings, storageLocation: 'external' });
      }
      await checkExternalStorage();
      Alert.alert('USB Access Granted', 'External storage is now available to the app.');
    } catch (e) {
      console.log('USB access grant error:', e);
      Alert.alert('Access Failed', 'Could not grant access to the USB storage.');
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

  const sidebarWidth = Math.min(100, width * 0.12);

  return (
    <View style={[styles.container, { width, height }]}>
      {/* Sidebar */}
      <View style={[styles.sidebar, { width: sidebarWidth }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
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
                  ios_backgroundColor="#333"
                  style={{ transform: [{ scaleX: 1.56 }, { scaleY: 1.56 }] }}
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
                        <Text style={styles.availableBadgeText}>{volumeLabel ? `✓ ${volumeLabel}` : 'Available'}</Text>
                      </View>
                    ) : usbAttached && needsUsbAccess ? (
                      <View style={styles.needsAccessBadge}>
                        <Text style={styles.needsAccessBadgeText}>Connected – tap Grant</Text>
                      </View>
                    ) : (
                      <View style={styles.unavailableBadge}>
                        <Text style={styles.unavailableBadgeText}>Not Detected</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.locationDesc, !externalAvailable && { color: '#444' }]}> 
                    Audio files saved to SD Card / USB {needsUsbAccess ? '(connected - access required)' : !externalAvailable ? '(not connected)' : ''}
                  </Text>
                </View>
                {settings.storageLocation === 'external' && externalAvailable && (
                  <Ionicons name="checkmark-circle" size={20} color="#E54B2A" />
                )}
              </TouchableOpacity>

              {needsUsbAccess && (
                <TouchableOpacity style={styles.accessBtn} onPress={requestUsbAccess}>
                  <Ionicons name="key" size={16} color="#fff" />
                  <Text style={styles.accessBtnText}>Grant USB Access</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Storage Info */}
          <View style={styles.section}>
            <View style={styles.infoCard}>
              <Ionicons name="information-circle" size={22} color="#F59E0B" />
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
  sidebar: { backgroundColor: '#0a0a0a', borderRightWidth: 1, borderRightColor: '#1a1a1a', paddingVertical: 22, paddingHorizontal: 24, paddingLeft: 34, alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 72, height: 72, borderRadius: 14, backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' },
  sidebarIcon: { width: 72, height: 72, borderRadius: 14, backgroundColor: 'rgba(139,92,246,0.15)', justifyContent: 'center', alignItems: 'center' },

  // Content
  content: { flex: 1 },
  contentInner: { padding: 29 },
  header: { marginBottom: 34 },
  headerTitle: { color: '#fff', fontSize: 34, fontWeight: '700' },
  headerSub: { color: '#555', fontSize: 20, marginTop: 8 },

  sections: { gap: 34 },

  section: { gap: 17 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  sectionTitle: { color: '#888', fontSize: 21, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  card: { backgroundColor: '#0a0a0a', borderRadius: 17, padding: 24, borderWidth: 1, borderColor: '#1a1a1a' },

  // Info Row
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  infoLabel: { color: '#666', fontSize: 21 },
  infoValue: { color: '#fff', fontSize: 22, fontWeight: '500' },
  hintText: { color: '#555', fontSize: 17, marginTop: 17 },

  // Setting Row
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  settingInfo: { flex: 1, marginRight: 24 },
  settingLabel: { color: '#fff', fontSize: 23, fontWeight: '600' },
  settingDesc: { color: '#666', fontSize: 19, marginTop: 3 },

  // Location Options
  locationOption: { flexDirection: 'row', alignItems: 'center', padding: 20, marginBottom: 14, borderRadius: 12, backgroundColor: '#111', borderWidth: 1, borderColor: '#222' },
  locationActive: { borderColor: '#E54B2A', backgroundColor: 'rgba(229,75,42,0.1)' },
  locationDisabled: { opacity: 0.5, borderColor: '#1a1a1a' },
  locationInfo: { flex: 1, marginLeft: 20 },
  locationTitle: { color: '#888', fontSize: 22, fontWeight: '500' },
  locationTitleActive: { color: '#fff' },
  locationTitleDisabled: { color: '#444' },
  locationDesc: { color: '#666', fontSize: 19, marginTop: 3 },

  // Storage Availability Badges
  availableBadge: { backgroundColor: 'rgba(16,185,129,0.15)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  availableBadgeText: { color: '#10B981', fontSize: 15, fontWeight: '700' },
  unavailableBadge: { backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  unavailableBadgeText: { color: '#EF4444', fontSize: 15, fontWeight: '600' },

  // Access Button
  accessBtn: { marginTop: 20, height: 68, borderRadius: 14, backgroundColor: '#8B5CF6', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 14 },
  accessBtnText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  needsAccessBadge: { backgroundColor: 'rgba(245,158,11,0.15)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.4)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  needsAccessBadgeText: { color: '#F59E0B', fontSize: 15, fontWeight: '700' },

  // Info Card
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', padding: 20, backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: 12, gap: 17 },
  infoText: { flex: 1, color: '#F59E0B', fontSize: 16, lineHeight: 26 },
});
