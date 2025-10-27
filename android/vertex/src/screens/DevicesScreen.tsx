/**
 * Devices Screen
 * 
 * Display saved BLE devices and scan for new ones
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Wifi, Plus, Bluetooth, X, ChevronRight } from 'lucide-react-native';
import { theme } from '../styles/theme';
import BleService from '../services/BleService';
import { request, check, PERMISSIONS, RESULTS } from 'react-native-permissions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Device } from 'react-native-ble-plx';
import { IMUDevice } from '../types';
import { RootStackParamList } from '../navigation/AppNavigator';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const SAVED_DEVICES_KEY = '@vertex_saved_devices';

interface SavedDevice {
  id: string;
  name: string;
  lastConnected?: string;
}

interface ScannedDevice {
  device: Device;
  rssi: number;
  timestamp: number;
}

const DevicesScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const [savedDevices, setSavedDevices] = useState<SavedDevice[]>([]);
  const [scannedDevices, setScannedDevices] = useState<Map<string, ScannedDevice>>(new Map());
  const [isScanning, setIsScanning] = useState(false);
  const [hasPermissions, setHasPermissions] = useState(false);
  const [showScanModal, setShowScanModal] = useState(false);

  useEffect(() => {
    checkAndRequestPermissions();
    loadSavedDevices();
  }, []);

  const loadSavedDevices = async () => {
    try {
      const saved = await AsyncStorage.getItem(SAVED_DEVICES_KEY);
      if (saved) {
        setSavedDevices(JSON.parse(saved));
      }
    } catch (error) {
      console.error('Error loading saved devices:', error);
    }
  };

  const checkAndRequestPermissions = async () => {
    if (Platform.OS !== 'android') {
      setHasPermissions(true);
      return;
    }

    try {
      const bluetoothScanStatus = await check(PERMISSIONS.ANDROID.BLUETOOTH_SCAN);
      const bluetoothConnectStatus = await check(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
      const locationStatus = await check(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);

      let allGranted = true;

      if (bluetoothScanStatus !== RESULTS.GRANTED) {
        const result = await request(PERMISSIONS.ANDROID.BLUETOOTH_SCAN);
        if (result !== RESULTS.GRANTED) allGranted = false;
      }

      if (bluetoothConnectStatus !== RESULTS.GRANTED) {
        const result = await request(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
        if (result !== RESULTS.GRANTED) allGranted = false;
      }

      if (locationStatus !== RESULTS.GRANTED) {
        const result = await request(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
        if (result !== RESULTS.GRANTED) allGranted = false;
      }

      setHasPermissions(allGranted);
    } catch (error) {
      console.error('Permission error:', error);
    }
  };

  const startScanning = async () => {
    if (!hasPermissions) {
      Alert.alert(
        'Permissions Required',
        'Grant Bluetooth and Location permissions to scan for devices',
        [{ text: 'OK', onPress: checkAndRequestPermissions }]
      );
      return;
    }

    setIsScanning(true);
    setScannedDevices(new Map());
    setShowScanModal(true);

    try {
      await BleService.scanForDevices((device) => {
        if (device.name) {
          setScannedDevices((prev) => {
            const updated = new Map(prev);
            updated.set(device.id, {
              device,
              rssi: device.rssi || -100,
              timestamp: Date.now(),
            });
            return updated;
          });
        }
      });

      // Auto-stop scan after 10 seconds
      setTimeout(() => {
        stopScanning();
      }, 10000);
    } catch (error) {
      console.error('Scan error:', error);
      Alert.alert('Scan Error', 'Failed to start BLE scan');
      setIsScanning(false);
    }
  };

  const stopScanning = () => {
    BleService.stopScanning();
    setIsScanning(false);
  };

  const handleDeviceSelect = async (scannedDevice: ScannedDevice) => {
    stopScanning();
    setShowScanModal(false);

    // Save to saved devices
    const newDevice: SavedDevice = {
      id: scannedDevice.device.id,
      name: scannedDevice.device.name || 'Unknown Device',
      lastConnected: new Date().toISOString(),
    };

    const updated = [...savedDevices.filter(d => d.id !== newDevice.id), newDevice];
    await saveDevices(updated);

    // Navigate to detail screen
    navigation.navigate('DeviceDetail', {
      deviceId: newDevice.id,
      deviceName: newDevice.name,
    });
  };

  const handleConnectSaved = async (device: SavedDevice) => {
    // Navigate to detail screen
    navigation.navigate('DeviceDetail', {
      deviceId: device.id,
      deviceName: device.name,
    });
  };


  const handleRemoveDevice = async (deviceId: string) => {
    Alert.alert(
      'Remove Device',
      'Are you sure you want to remove this device?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              // Check if this device is currently connected
              const connectedDevice = BleService.getConnectedDevice();
              if (connectedDevice && connectedDevice.id === deviceId) {
                console.log('[DevicesScreen] Disconnecting device before removal:', deviceId);
                await BleService.disconnect();
              }

              // Remove from saved devices
              const updated = savedDevices.filter(d => d.id !== deviceId);
              await saveDevices(updated);
            } catch (error) {
              console.error('[DevicesScreen] Error removing device:', error);
              Alert.alert('Error', 'Failed to remove device');
            }
          },
        },
      ]
    );
  };

  const saveDevices = async (devices: SavedDevice[]) => {
    try {
      await AsyncStorage.setItem(SAVED_DEVICES_KEY, JSON.stringify(devices));
      setSavedDevices(devices);
    } catch (error) {
      console.error('Error saving devices:', error);
    }
  };

  const renderSavedDevice = ({ item }: { item: SavedDevice }) => {
    return (
      <View style={styles.deviceCard}>
        <TouchableOpacity
          style={styles.deviceMain}
          onPress={() => handleConnectSaved(item)}>
          <View style={styles.deviceHeader}>
            <Bluetooth size={24} color={theme.colors.textPrimary} />
            <View style={styles.deviceInfo}>
              <Text style={styles.deviceName}>{item.name}</Text>
              <Text style={styles.deviceId}>{item.id}</Text>
              {item.lastConnected && (
                <Text style={styles.lastConnected}>
                  Last: {new Date(item.lastConnected).toLocaleDateString()}
                </Text>
              )}
            </View>
            <ChevronRight size={20} color={theme.colors.textTertiary} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.removeButton}
          onPress={() => handleRemoveDevice(item.id)}>
          <X size={20} color={theme.colors.error} />
        </TouchableOpacity>
      </View>
    );
  };

  const renderScannedDevice = (scannedDevice: ScannedDevice) => (
    <TouchableOpacity
      key={scannedDevice.device.id}
      style={styles.scannedDeviceCard}
      onPress={() => handleDeviceSelect(scannedDevice)}>
      <Bluetooth size={20} color={theme.colors.textPrimary} />
      <View style={styles.scannedDeviceInfo}>
        <Text style={styles.scannedDeviceName}>
          {scannedDevice.device.name || 'Unknown Device'}
        </Text>
        <Text style={styles.scannedDeviceId}>{scannedDevice.device.id}</Text>
      </View>
      <Text style={styles.rssi}>{scannedDevice.rssi} dBm</Text>
    </TouchableOpacity>
  );

  const renderScanModal = () => {
    if (!showScanModal) return null;

    const deviceArray = Array.from(scannedDevices.values())
      .sort((a, b) => {
        // Prioritize Vertex devices
        const aIsVertex = a.device.name?.toLowerCase().includes('vertex') ?? false;
        const bIsVertex = b.device.name?.toLowerCase().includes('vertex') ?? false;

        if (aIsVertex && !bIsVertex) return -1;
        if (!aIsVertex && bIsVertex) return 1;

        // Within same group, sort by RSSI
        return b.rssi - a.rssi;
      });

    return (
      <View style={styles.modal}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Scan for Devices</Text>
            <TouchableOpacity onPress={() => {
              stopScanning();
              setShowScanModal(false);
            }}>
              <X size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {isScanning && (
            <View style={styles.scanningIndicator}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Text style={styles.scanningText}>Scanning for devices...</Text>
            </View>
          )}

          <ScrollView style={styles.scannedDevicesList}>
            {deviceArray.length === 0 && !isScanning && (
              <Text style={styles.noDevicesText}>No devices found. Make sure your device is powered on.</Text>
            )}
            {deviceArray.map(scannedDevice => renderScannedDevice(scannedDevice))}
          </ScrollView>

          {isScanning ? (
            <TouchableOpacity style={styles.modalButton} onPress={stopScanning}>
              <Text style={styles.modalButtonText}>Stop Scanning</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.modalButton} onPress={startScanning}>
              <Text style={styles.modalButtonText}>Scan Again</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyCard}>
      <Bluetooth size={48} color={theme.colors.textTertiary} />
      <Text style={styles.emptyTitle}>No Devices Yet</Text>
      <Text style={styles.emptySubtitle}>
        Scan for BLE devices like your Whoop or IMU logger. Make sure your device
        is powered on and nearby.
      </Text>
      <TouchableOpacity style={styles.addButton} onPress={startScanning}>
        <Text style={styles.addButtonText}>Scan for Devices</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Devices</Text>

        {savedDevices.length === 0 ? (
          renderEmptyState()
        ) : (
          <>
            <FlatList
              data={savedDevices}
              renderItem={renderSavedDevice}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
            />
            <TouchableOpacity style={styles.fab} onPress={startScanning}>
              <Plus size={24} color={theme.colors.primaryForeground} />
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {renderScanModal()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl * 2,
  },
  title: {
    fontSize: theme.typography.fontSize.xxxl,
    fontWeight: theme.typography.fontWeight.light,
    marginBottom: theme.spacing.lg,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
  },
  deviceCard: {
    backgroundColor: theme.colors.muted,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  deviceMain: {
    flex: 1,
    padding: theme.spacing.lg,
  },
  deviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deviceInfo: {
    marginLeft: theme.spacing.md,
    flex: 1,
  },
  deviceName: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
    marginBottom: 4,
  },
  deviceId: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textTertiary,
    fontFamily: theme.typography.mono,
    marginBottom: 4,
  },
  lastConnected: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
  },
  removeButton: {
    padding: theme.spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyCard: {
    backgroundColor: theme.colors.muted,
    padding: theme.spacing.xxl,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 300,
  },
  emptyTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  emptySubtitle: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
    lineHeight: 20,
  },
  addButton: {
    backgroundColor: theme.colors.primary,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    borderRadius: theme.borderRadius.md,
  },
  addButtonText: {
    color: theme.colors.primaryForeground,
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.medium,
    fontFamily: theme.typography.serif,
  },
  fab: {
    position: 'absolute',
    bottom: theme.spacing.xl,
    right: theme.spacing.lg,
    backgroundColor: theme.colors.primary,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  // Scan Modal Styles
  modal: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
  modalContent: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    width: '100%',
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  modalTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
  },
  scanningIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
  },
  scanningText: {
    marginLeft: theme.spacing.sm,
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
    fontFamily: theme.typography.serif,
  },
  scannedDevicesList: {
    maxHeight: 400,
    marginBottom: theme.spacing.md,
  },
  scannedDeviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  scannedDeviceInfo: {
    flex: 1,
    marginLeft: theme.spacing.sm,
  },
  scannedDeviceName: {
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
  },
  scannedDeviceId: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textTertiary,
    fontFamily: theme.typography.mono,
  },
  rssi: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.mono,
  },
  noDevicesText: {
    textAlign: 'center',
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
    fontFamily: theme.typography.serif,
    padding: theme.spacing.xl,
  },
  modalButton: {
    backgroundColor: theme.colors.primary,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
  },
  modalButtonText: {
    color: theme.colors.primaryForeground,
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.medium,
    fontFamily: theme.typography.serif,
  },
});

export default DevicesScreen;
