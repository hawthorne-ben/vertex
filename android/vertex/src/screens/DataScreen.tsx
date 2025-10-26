/**
 * Data Screen
 * 
 * Lists uploaded IMU data files
 */

import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../styles/theme';

const DataScreen: React.FC = () => {
  const insets = useSafeAreaInsets();

  // Placeholder data files
  const imuFiles = [
    { name: 'imu_20241026_123000.csv', size: '45.2 MB', date: 'Today' },
    { name: 'imu_20241025_095432.csv', size: '32.8 MB', date: 'Yesterday' },
    { name: 'imu_20241023_143022.csv', size: '28.1 MB', date: '3 days ago' },
  ];

  return (
    <ScrollView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.content}>
        <Text style={styles.title}>Data Files</Text>

        {imuFiles.map((file, index) => (
          <View key={index} style={styles.fileCard}>
            <View style={styles.fileHeader}>
              <Text style={styles.fileName}>{file.name}</Text>
              <Text style={styles.fileDate}>{file.date}</Text>
            </View>
            <Text style={styles.fileSize}>{file.size}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.lg,
  },
  title: {
    fontSize: theme.typography.fontSize.xxxl,
    fontWeight: theme.typography.fontWeight.light,
    marginBottom: theme.spacing.lg,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
  },
  fileCard: {
    backgroundColor: theme.colors.muted,
    padding: theme.spacing.lg,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  fileHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  fileName: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.textPrimary,
    flex: 1,
    fontFamily: theme.typography.mono,
  },
  fileDate: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
  },
  fileSize: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
  },
});

export default DataScreen;

