/**
 * Home Screen
 * 
 * Main interface for:
 * - Scanning for BLE devices
 * - Connecting to IMU device
 * - Starting/stopping logging
 * - Displaying connection status
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Device } from 'react-native-ble-plx';
import { request, check, PERMISSIONS, RESULTS } from 'react-native-permissions';
import BleService from '../services/BleService';
import { IMUDevice } from '../types';

const HomeScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<IMUDevice[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [isLogging, setIsLogging] = useState(false);
  const [hasPermissions, setHasPermissions] = useState(false);

  useEffect(() => {
    checkAndRequestPermissions();
    return () => {
      BleService.stopScanning();
    };
  }, []);

  const checkAndRequestPermissions = async () => {
    try {
      if (Platform.OS !== 'android') {
        setHasPermissions(true);
        return;
      }

      // Check all required BLE permissions for Android 12+
      const bluetoothScanStatus = await check(PERMISSIONS.ANDROID.BLUETOOTH_SCAN);
      const bluetoothConnectStatus = await check(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
      const locationStatus = await check(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);

      console.log('Permission status:', { bluetoothScanStatus, bluetoothConnectStatus, locationStatus });

      let needsRequest = false;
      
      if (bluetoothScanStatus !== RESULTS.GRANTED) {
        const result = await request(PERMISSIONS.ANDROID.BLUETOOTH_SCAN);
        console.log('BLUETOOTH_SCAN request result:', result);
        if (result !== RESULTS.GRANTED) needsRequest = true;
      }

      if (bluetoothConnectStatus !== RESULTS.GRANTED) {
        const result = await request(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
        console.log('BLUETOOTH_CONNECT request result:', result);
        if (result !== RESULTS.GRANTED) needsRequest = true;
      }

      if (locationStatus !== RESULTS.GRANTED) {
        const result = await request(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
        console.log('ACCESS_FINE_LOCATION request result:', result);
        if (result !== RESULTS.GRANTED) needsRequest = true;
      }

      setHasPermissions(!needsRequest);
    } catch (error) {
      console.error('Permission error:', error);
    }
  };

  const handleScanDevices = async () => {
    if (!hasPermissions) {
      Alert.alert(
        'Permissions Required',
        'Please grant Bluetooth and Location permissions to scan for devices',
        [{ text: 'OK', onPress: checkAndRequestPermissions }]
      );
      return;
    }

    setIsScanning(true);
    setDevices([]);

    BleService.scanForDevices((device) => {
      setDevices((prev) => {
        // Avoid duplicates
        if (!prev.find((d) => d.id === device.id)) {
          return [
            ...prev,
            {
              id: device.id,
              name: device.name || 'Unknown Device',
              rssi: device.rssi,
            },
          ];
        }
        return prev;
      });
    });

    // Stop scanning after 10 seconds
    setTimeout(() => {
      setIsScanning(false);
      BleService.stopScanning();
    }, 10000);
  };

  const handleConnect = async (deviceId: string) => {
    try {
      const device = await BleService.connectToDevice(deviceId);
      setConnectedDevice(device);
      Alert.alert('Connected', `Connected to device: ${device.name}`);
    } catch (error) {
      console.error('Connection error:', error);
      Alert.alert('Connection Failed', 'Failed to connect to device');
    }
  };

  const handleDisconnect = async () => {
    await BleService.disconnect();
    setConnectedDevice(null);
  };

  const handleStartLogging = () => {
    if (!connectedDevice) {
      Alert.alert('No Device', 'Please connect to a device first');
      return;
    }
    setIsLogging(true);
    // TODO: Implement logging logic
  };

  const handleStopLogging = () => {
    setIsLogging(false);
    // TODO: Implement stop logging logic
  };

  const renderDevice = ({ item }: { item: IMUDevice }) => (
    <View style={styles.deviceItem}>
      <View>
        <Text style={styles.deviceName}>{item.name}</Text>
        <Text style={styles.deviceId}>{item.id}</Text>
        {item.rssi && <Text style={styles.deviceRssi}>RSSI: {item.rssi} dBm</Text>}
      </View>
      <TouchableOpacity
        style={styles.connectButton}
        onPress={() => handleConnect(item.id)}>
        <Text style={styles.connectButtonText}>Connect</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.title}>Vertex IMU Logger</Text>

      {/* Connection Status */}
      <View style={styles.statusContainer}>
        <Text style={styles.statusText}>
          Status: {connectedDevice ? 'Connected' : 'Disconnected'}
        </Text>
        {connectedDevice && (
          <Text style={styles.connectedDevice}>
            {connectedDevice.name || connectedDevice.id}
          </Text>
        )}
      </View>

      {/* Scan Button */}
      <TouchableOpacity
        style={styles.scanButton}
        onPress={handleScanDevices}
        disabled={isScanning || !!connectedDevice}>
        <Text style={styles.buttonText}>
          {isScanning ? 'Scanning...' : 'Scan for Devices'}
        </Text>
      </TouchableOpacity>

      {/* Devices List */}
      <FlatList
        data={devices}
        renderItem={renderDevice}
        keyExtractor={(item) => item.id}
        style={styles.devicesList}
      />

      {/* Connect/Disconnect Controls */}
      {connectedDevice && (
        <View style={styles.controlContainer}>
          <TouchableOpacity
            style={styles.disconnectButton}
            onPress={handleDisconnect}>
            <Text style={styles.buttonText}>Disconnect</Text>
          </TouchableOpacity>

          {/* Logging Controls */}
          <View style={styles.loggingContainer}>
            {!isLogging ? (
              <TouchableOpacity
                style={[styles.button, styles.startButton]}
                onPress={handleStartLogging}>
                <Text style={styles.buttonText}>Start Logging</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.button, styles.stopButton]}
                onPress={handleStopLogging}>
                <Text style={styles.buttonText}>Stop Logging</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  statusContainer: {
    padding: 15,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    marginBottom: 20,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
  },
  connectedDevice: {
    fontSize: 14,
    color: '#666',
    marginTop: 5,
  },
  scanButton: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  devicesList: {
    flex: 1,
  },
  deviceItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    marginBottom: 10,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
  },
  deviceId: {
    fontSize: 12,
    color: '#666',
  },
  deviceRssi: {
    fontSize: 12,
    color: '#999',
  },
  connectButton: {
    backgroundColor: '#34C759',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 6,
  },
  connectButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  controlContainer: {
    marginTop: 20,
  },
  disconnectButton: {
    backgroundColor: '#FF3B30',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
  },
  loggingContainer: {
    marginTop: 10,
  },
  button: {
    padding: 15,
    borderRadius: 8,
  },
  startButton: {
    backgroundColor: '#34C759',
  },
  stopButton: {
    backgroundColor: '#FF3B30',
  },
});

export default HomeScreen;

