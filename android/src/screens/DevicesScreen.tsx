/**
 * Devices Screen
 *
 * Display saved BLE devices and scan for new ones
 * Refactored with proper header and new component library
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Bluetooth, Plus, Trash2, AlertCircle } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { theme as staticTheme } from '../styles/theme';
import { useToast } from '../contexts/ToastContext';
import { Button, Modal, EmptyState, Card, ConfirmDialog } from '../components/ui';
import BleService from '../services/BleService';
import { request, check, PERMISSIONS, RESULTS } from 'react-native-permissions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Device } from 'react-native-ble-plx';
import { RootStackNavigationProp } from '../types/navigation.types';
import { BleError } from '../types/errors.types';
import { getUserFriendlyError } from '../utils/errorUtils';
import { useDeviceStore, SavedDevice } from '../stores/deviceStore';

interface ScannedDevice {
  device: Device;
  rssi: number;
  timestamp: number;
}

const DevicesScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { showToast } = useToast();
  const navigation = useNavigation<RootStackNavigationProp<'Tabs'>>();

  // Use deviceStore for connected device tracking and saved devices
  const {
    deviceId: connectedDeviceId,
    savedDevices,
    loadSavedDevices,
    addSavedDevice,
    removeSavedDevice,
    updateDeviceLastConnected,
  } = useDeviceStore();

  const [scannedDevices, setScannedDevices] = useState<Map<string, ScannedDevice>>(new Map());
  const [isScanning, setIsScanning] = useState(false);
  const [hasPermissions, setHasPermissions] = useState(false);
  const [showScanModal, setShowScanModal] = useState(false);
  const [deviceToDelete, setDeviceToDelete] = useState<SavedDevice | null>(null);

  useEffect(() => {
    checkAndRequestPermissions();
    loadSavedDevices(); // Load from store
  }, []);

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
      showToast({
        message: 'Grant Bluetooth and Location permissions to scan for devices',
        variant: 'warning',
        action: {
          label: 'Settings',
          onPress: checkAndRequestPermissions,
        },
      });
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
      showToast({
        message: getUserFriendlyError(error),
        variant: 'error',
      });
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

    // Save to saved devices using store
    const newDevice: SavedDevice = {
      id: scannedDevice.device.id,
      name: scannedDevice.device.name || 'Unknown Device',
      lastConnected: new Date().toISOString(),
    };

    await addSavedDevice(newDevice);

    // Navigate to detail screen and auto-connect for new devices
    navigation.navigate('DeviceDetail', {
      deviceId: newDevice.id,
      deviceName: newDevice.name,
      autoConnect: true, // Auto-connect only for newly added devices
    });
  };

  const handleConnectSaved = async (device: SavedDevice) => {
    // Navigate to detail screen
    navigation.navigate('DeviceDetail', {
      deviceId: device.id,
      deviceName: device.name,
    });
  };

  const handleRemoveDevice = (device: SavedDevice) => {
    setDeviceToDelete(device);
  };

  const confirmDelete = async () => {
    if (!deviceToDelete) return;

    try {
      // Check if this device is currently connected
      const connectedDevice = BleService.getConnectedDevice();
      if (connectedDevice && connectedDevice.id === deviceToDelete.id) {
        await BleService.disconnect();
      }

      // Remove from saved devices using store
      await removeSavedDevice(deviceToDelete.id);

      showToast({
        message: 'Device removed',
        variant: 'success',
        duration: 2000,
      });
    } catch (error) {
      console.error('[DevicesScreen] Error removing device:', error);
      showToast({
        message: 'Failed to remove device',
        variant: 'error',
      });
    }
  };

  // saveDevices removed - now using deviceStore actions directly

  const renderSavedDevice = ({ item }: { item: SavedDevice }) => {
    // Check if device is currently connected
    const isConnected = connectedDeviceId === item.id;

    return (
      <Card
        variant="default"
        padding="none"
        style={styles.deviceCard}
        header={null}>
        <TouchableOpacity
          style={styles.deviceCardMain}
          onPress={() => handleConnectSaved(item)}>
          <View style={styles.deviceHeader}>
            <Bluetooth
              size={24}
              color={isConnected ? theme.colors.success : theme.colors.textTertiary}
            />
            <View style={styles.deviceInfo}>
              <Text style={[styles.deviceName, { color: theme.colors.textPrimary }]}>
                {item.name}
              </Text>
              <Text style={[styles.deviceId, { color: theme.colors.textTertiary }]}>
                {item.id}
              </Text>
              {item.lastConnected && !isConnected && (
                <Text style={[styles.lastConnected, { color: theme.colors.textSecondary }]}>
                  Last: {new Date(item.lastConnected).toLocaleDateString()}
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                handleRemoveDevice(item);
              }}
              style={styles.removeButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Trash2 size={20} color={theme.colors.error} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Card>
    );
  };

  const renderScannedDevice = (scannedDevice: ScannedDevice) => (
    <TouchableOpacity
      key={scannedDevice.device.id}
      style={[styles.scannedDeviceCard, {
        backgroundColor: theme.colors.muted,
        borderColor: theme.colors.border,
      }]}
      onPress={() => handleDeviceSelect(scannedDevice)}>
      <Bluetooth size={20} color={theme.colors.textPrimary} />
      <View style={styles.scannedDeviceInfo}>
        <Text style={[styles.scannedDeviceName, { color: theme.colors.textPrimary }]}>
          {scannedDevice.device.name || 'Unknown Device'}
        </Text>
        <Text style={[styles.scannedDeviceId, { color: theme.colors.textTertiary }]}>
          {scannedDevice.device.id}
        </Text>
      </View>
      <Text style={[styles.rssi, { color: theme.colors.textSecondary }]}>
        {scannedDevice.rssi} dBm
      </Text>
    </TouchableOpacity>
  );

  const renderScanModal = () => {
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
      <Modal
        visible={showScanModal}
        onClose={() => {
          stopScanning();
          setShowScanModal(false);
        }}
        title="Scan for Devices"
        footer={
          isScanning ? (
            <Button variant="secondary" onPress={stopScanning}>
              Stop Scanning
            </Button>
          ) : (
            <Button variant="primary" onPress={startScanning}>
              Scan Again
            </Button>
          )
        }>
        {isScanning && (
          <View style={[styles.scanningIndicator, { backgroundColor: theme.colors.muted }]}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={[styles.scanningText, { color: theme.colors.textSecondary }]}>
              Scanning for devices...
            </Text>
          </View>
        )}

        <ScrollView style={styles.scannedDevicesList}>
          {deviceArray.length === 0 && !isScanning && (
            <Text style={[styles.noDevicesText, { color: theme.colors.textSecondary }]}>
              No devices found. Make sure your device is powered on.
            </Text>
          )}
          {deviceArray.map(scannedDevice => renderScannedDevice(scannedDevice))}
        </ScrollView>
      </Modal>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Fixed Header */}
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: theme.colors.background, borderBottomColor: theme.colors.border }]}>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>
          My Devices
        </Text>
      </View>

      {/* Scrollable Content */}
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {savedDevices.length === 0 ? (
          <EmptyState
            icon={<Bluetooth size={48} color={theme.colors.textTertiary} />}
            title="No Devices Yet"
            subtitle="Scan for BLE devices like your Whoop or IMU logger. Make sure your device is powered on and nearby."
            action={{
              label: 'Scan for Devices',
              onPress: startScanning,
            }}
          />
        ) : (
          <FlatList
            data={savedDevices}
            renderItem={renderSavedDevice}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            contentContainerStyle={styles.deviceList}
          />
        )}
      </ScrollView>

      {/* FAB */}
      {savedDevices.length > 0 && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: theme.colors.primary }]}
          onPress={startScanning}>
          <Plus size={24} color={theme.colors.primaryForeground} />
        </TouchableOpacity>
      )}

      {renderScanModal()}

      <ConfirmDialog
        visible={deviceToDelete !== null}
        onDismiss={() => setDeviceToDelete(null)}
        title="Remove Device"
        message={deviceToDelete ? `Remove "${deviceToDelete.name}" from saved devices?` : ''}
        icon={<AlertCircle size={48} color={theme.colors.error} />}
        actions={[
          {
            label: 'Cancel',
            onPress: () => setDeviceToDelete(null),
            variant: 'default',
          },
          {
            label: 'Remove',
            onPress: confirmDelete,
            variant: 'danger',
          },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '300',
    fontFamily: staticTheme.typography.serif,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 96,
  },
  deviceList: {
    gap: 16,
  },
  deviceCard: {
    marginBottom: 0,
  },
  deviceCardMain: {
    flex: 1,
  },
  deviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 24,
  },
  deviceInfo: {
    marginLeft: 16,
    flex: 1,
  },
  deviceName: {
    fontSize: 18,
    fontWeight: '500',
    marginBottom: 4,
  },
  deviceId: {
    fontSize: 12,
    marginBottom: 4,
    fontFamily: staticTheme.typography.mono,
  },
  lastConnected: {
    fontSize: 12,
    fontFamily: staticTheme.typography.serif,
  },
  removeButton: {
    padding: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fab: {
    position: 'absolute',
    bottom: 32,
    right: 24,
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
  scanningIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  scanningText: {
    marginLeft: 8,
    fontSize: 14,
  },
  scannedDevicesList: {
    maxHeight: 400,
  },
  scannedDeviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
  },
  scannedDeviceInfo: {
    flex: 1,
    marginLeft: 8,
  },
  scannedDeviceName: {
    fontSize: 16,
    fontWeight: '500',
  },
  scannedDeviceId: {
    fontSize: 12,
  },
  rssi: {
    fontSize: 12,
  },
  noDevicesText: {
    textAlign: 'center',
    fontSize: 14,
    padding: 32,
  },
});

export default DevicesScreen;
