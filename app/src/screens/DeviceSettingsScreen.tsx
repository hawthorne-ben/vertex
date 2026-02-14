/**
 * Device Settings Screen
 *
 * Configure device parameters via BLE
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ChevronDown } from 'lucide-react-native';
import { theme as staticTheme } from '../styles/theme';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { BackButton, Card, BottomSheet } from '../components/ui';
import type { BottomSheetOption } from '../components/ui';
import BleService from '../services/BleService';
import { useDeviceStore } from '../stores/deviceStore';

type BottomSheetType = 'sampleRate' | 'ledMode' | 'powerMode' | null;

const DeviceSettingsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { showToast } = useToast();
  const navigation = useNavigation();
  const { deviceConfig } = useDeviceStore();

  const [isLoading, setIsLoading] = useState(false);
  const [activeSheet, setActiveSheet] = useState<BottomSheetType>(null);
  const [sampleRate, setSampleRate] = useState(deviceConfig?.sampleRate || 10);
  const [ledMode, setLedMode] = useState(deviceConfig?.ledMode || 1);
  const [powerMode, setPowerMode] = useState(deviceConfig?.powerMode || 1);

  // Update local state when deviceConfig changes (from store)
  useEffect(() => {
    if (deviceConfig) {
      setSampleRate(deviceConfig.sampleRate);
      setLedMode(deviceConfig.ledMode);
      setPowerMode(deviceConfig.powerMode);
    }
  }, [deviceConfig]);

  const sampleRateOptions: BottomSheetOption[] = useMemo(() => [
    { label: '10 Hz', value: 10, description: 'Default - Optimal stability' },
    { label: '20 Hz', value: 20, description: 'Higher frequency capture' },
    { label: '50 Hz', value: 50, description: 'Maximum supported rate' },
  ], []);

  const ledModeOptions: BottomSheetOption[] = useMemo(() => [
    { label: 'Off', value: 0, description: 'LED always off' },
    { label: 'Status', value: 1, description: 'Blinks on connection (default)' },
    { label: 'Always On', value: 2, description: 'LED always on' },
  ], []);

  const powerModeOptions: BottomSheetOption[] = useMemo(() => [
    { label: 'Low Power', value: 0, description: '100 kHz I2C speed' },
    { label: 'Normal', value: 1, description: '400 kHz I2C speed (default)' },
    { label: 'High Performance', value: 2, description: '400 kHz I2C with aggressive sampling' },
  ], []);

  const handleSampleRateChange = async (value: string | number) => {
    const newValue = value as number;
    setSampleRate(newValue);
    setIsLoading(true);
    try {
      await BleService.setSampleRate(newValue);
      // Update store with new config
      useDeviceStore.getState().setDeviceConfig({
        sampleRate: newValue,
        ledMode,
        powerMode,
      });
      showToast({ message: `Sample rate set to ${newValue} Hz`, variant: 'success' });
    } catch (error: any) {
      showToast({ message: error?.message || 'Failed to set sample rate', variant: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLedModeChange = async (value: string | number) => {
    const newValue = value as number;
    setLedMode(newValue);
    setIsLoading(true);
    try {
      await BleService.setLEDMode(newValue);
      // Update store with new config
      useDeviceStore.getState().setDeviceConfig({
        sampleRate,
        ledMode: newValue,
        powerMode,
      });
      const modeNames = ['Off', 'Status', 'Always On'];
      showToast({ message: `LED mode set to ${modeNames[newValue]}`, variant: 'success' });
    } catch (error: any) {
      showToast({ message: error?.message || 'Failed to set LED mode', variant: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePowerModeChange = async (value: string | number) => {
    const newValue = value as number;
    setPowerMode(newValue);
    setIsLoading(true);
    try {
      await BleService.setPowerMode(newValue);
      // Update store with new config
      useDeviceStore.getState().setDeviceConfig({
        sampleRate,
        ledMode,
        powerMode: newValue,
      });
      const modeNames = ['Low Power', 'Normal', 'High Performance'];
      showToast({ message: `Power mode set to ${modeNames[newValue]}`, variant: 'success' });
    } catch (error: any) {
      showToast({ message: error?.message || 'Failed to set power mode', variant: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCalibrate = async () => {
    setIsLoading(true);
    try {
      await BleService.triggerCalibration();
      showToast({ message: 'Calibration triggered', variant: 'success' });
    } catch (error: any) {
      showToast({ message: error?.message || 'Failed to trigger calibration', variant: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleQueryConfig = async () => {
    setIsLoading(true);
    try {
      await BleService.queryConfiguration();
      showToast({
        message: 'Config queried - check device serial logs',
        variant: 'info',
        duration: 4000,
      });
    } catch (error: any) {
      showToast({ message: error?.message || 'Failed to query config', variant: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async () => {
    setIsLoading(true);
    try {
      await BleService.resetDevice();
      showToast({ message: 'Device reset', variant: 'warning' });
    } catch (error: any) {
      showToast({ message: error?.message || 'Failed to reset device', variant: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const getSampleRateLabel = () => {
    return sampleRateOptions.find((opt) => opt.value === sampleRate)?.label || '10 Hz';
  };

  const getLedModeLabel = () => {
    return ledModeOptions.find((opt) => opt.value === ledMode)?.label || 'Status';
  };

  const getPowerModeLabel = () => {
    return powerModeOptions.find((opt) => opt.value === powerMode)?.label || 'Normal';
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Device Settings</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        {/* Sample Rate */}
        <Card style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={[styles.settingLabel, { color: theme.colors.textPrimary }]}>
                Sample Rate
              </Text>
              <Text style={[styles.settingDescription, { color: theme.colors.textSecondary }]}>
                How often the device sends sensor data
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.valueButton, { backgroundColor: theme.colors.muted }]}
              onPress={() => setActiveSheet('sampleRate')}
              disabled={isLoading}
            >
              <Text style={[styles.valueText, { color: theme.colors.textPrimary }]}>
                {getSampleRateLabel()}
              </Text>
              <ChevronDown size={16} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </Card>

        {/* LED Mode */}
        <Card style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={[styles.settingLabel, { color: theme.colors.textPrimary }]}>
                LED Mode
              </Text>
              <Text style={[styles.settingDescription, { color: theme.colors.textSecondary }]}>
                Control the built-in LED indicator
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.valueButton, { backgroundColor: theme.colors.muted }]}
              onPress={() => setActiveSheet('ledMode')}
              disabled={isLoading}
            >
              <Text style={[styles.valueText, { color: theme.colors.textPrimary }]}>
                {getLedModeLabel()}
              </Text>
              <ChevronDown size={16} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </Card>

        {/* Power Mode */}
        <Card style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={[styles.settingLabel, { color: theme.colors.textPrimary }]}>
                Power Mode
              </Text>
              <Text style={[styles.settingDescription, { color: theme.colors.textSecondary }]}>
                Adjust I2C speed and sensor performance
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.valueButton, { backgroundColor: theme.colors.muted }]}
              onPress={() => setActiveSheet('powerMode')}
              disabled={isLoading}
            >
              <Text style={[styles.valueText, { color: theme.colors.textPrimary }]}>
                {getPowerModeLabel()}
              </Text>
              <ChevronDown size={16} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </Card>

        {/* Actions */}
        <View style={styles.actionsSection}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
            DEVICE ACTIONS
          </Text>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}
            onPress={handleCalibrate}
            disabled={isLoading}
          >
            <Text style={[styles.actionButtonText, { color: theme.colors.textPrimary }]}>
              Trigger Calibration
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}
            onPress={handleQueryConfig}
            disabled={isLoading}
          >
            <Text style={[styles.actionButtonText, { color: theme.colors.textPrimary }]}>
              Query Configuration
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: theme.colors.card, borderColor: theme.colors.errorBorder }]}
            onPress={handleReset}
            disabled={isLoading}
          >
            <Text style={[styles.actionButtonText, { color: theme.colors.error }]}>
              Reset Device
            </Text>
          </TouchableOpacity>
        </View>

        {isLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        )}
      </ScrollView>

      {/* Bottom Sheets */}
      <BottomSheet
        visible={activeSheet === 'sampleRate'}
        onClose={() => setActiveSheet(null)}
        title="Select Sample Rate"
        options={sampleRateOptions}
        selectedValue={sampleRate}
        onSelect={handleSampleRateChange}
      />

      <BottomSheet
        visible={activeSheet === 'ledMode'}
        onClose={() => setActiveSheet(null)}
        title="Select LED Mode"
        options={ledModeOptions}
        selectedValue={ledMode}
        onSelect={handleLedModeChange}
      />

      <BottomSheet
        visible={activeSheet === 'powerMode'}
        onClose={() => setActiveSheet(null)}
        title="Select Power Mode"
        options={powerModeOptions}
        selectedValue={powerMode}
        onSelect={handlePowerModeChange}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  card: {
    marginBottom: staticTheme.spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: staticTheme.spacing.lg,
    paddingBottom: staticTheme.spacing.md,
  },
  title: {
    fontSize: staticTheme.typography.fontSize.xl,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    fontFamily: staticTheme.typography.serif,
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: staticTheme.spacing.lg,
    paddingBottom: staticTheme.spacing.xxl,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingInfo: {
    flex: 1,
    marginRight: staticTheme.spacing.md,
  },
  settingLabel: {
    fontSize: staticTheme.typography.fontSize.md,
    fontWeight: staticTheme.typography.fontWeight.medium,
    fontFamily: staticTheme.typography.serif,
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: staticTheme.typography.fontSize.sm,
    fontFamily: staticTheme.typography.serif,
    lineHeight: 18,
  },
  valueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: staticTheme.spacing.md,
    paddingVertical: staticTheme.spacing.sm,
    borderRadius: staticTheme.borderRadius.md,
    gap: staticTheme.spacing.xs,
  },
  valueText: {
    fontSize: staticTheme.typography.fontSize.sm,
    fontWeight: staticTheme.typography.fontWeight.medium,
    fontFamily: staticTheme.typography.mono,
  },
  actionsSection: {
    marginTop: staticTheme.spacing.lg,
  },
  sectionTitle: {
    fontSize: staticTheme.typography.fontSize.xs,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    fontFamily: staticTheme.typography.serif,
    letterSpacing: 1,
    marginBottom: staticTheme.spacing.md,
  },
  actionButton: {
    borderRadius: staticTheme.borderRadius.md,
    padding: staticTheme.spacing.md,
    marginBottom: staticTheme.spacing.sm,
    borderWidth: 1,
  },
  actionButtonText: {
    fontSize: staticTheme.typography.fontSize.md,
    fontWeight: staticTheme.typography.fontWeight.medium,
    fontFamily: staticTheme.typography.serif,
    textAlign: 'center',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
});

export default DeviceSettingsScreen;
