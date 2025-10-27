/**
 * Landing Screen
 * 
 * First screen users see - matches web app's landing page
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { theme as staticTheme } from '../styles/theme';
import { useTheme } from '../contexts/ThemeContext';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const LandingScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.content}>
      {/* Logo/Title */}
      <Text style={[styles.logo, { color: theme.colors.textPrimary }]}>VERTEX</Text>
      <Text style={[styles.tagline, { color: theme.colors.textPrimary }]}>Your ride, unencrypted</Text>

      <View style={styles.descriptionContainer}>
        <Text style={[styles.description, { color: theme.colors.textSecondary }]}>
          Measure how you actually ride. Understand cornering forces, braking smoothness,
          body position stability, and how your equipment affects comfort—with objective data
          from IMU motion analysis.
        </Text>
      </View>

      {/* CTA Buttons */}
      <View style={styles.buttonsContainer}>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: theme.colors.primary }]}
          onPress={() => navigation.navigate('Login')}>
          <Text style={[styles.primaryButtonText, { color: theme.colors.primaryForeground }]}>Get Started</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryButton, { borderColor: theme.colors.border }]}
          onPress={() => {
            // Skip auth and go to BLE scanner (Devices tab)
            // Note: This won't work without auth - user needs to login first
            Alert.alert('Info', 'Please sign in to access device scanner');
          }}>
          <Text style={[styles.secondaryButtonText, { color: theme.colors.textPrimary }]}>Continue without account</Text>
        </TouchableOpacity>
      </View>

      {/* Footer info */}
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: theme.colors.textTertiary }]}>
          Beta platform in development
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: staticTheme.spacing.xl,
    paddingBottom: staticTheme.spacing.xxl,
  },
  logo: {
    fontSize: 48,
    fontFamily: staticTheme.typography.serif,
    fontWeight: staticTheme.typography.fontWeight.normal,
    letterSpacing: 2,
    marginBottom: staticTheme.spacing.md,
  },
  tagline: {
    fontSize: 24,
    fontWeight: staticTheme.typography.fontWeight.light,
    marginBottom: staticTheme.spacing.xxl,
    textAlign: 'center',
  },
  descriptionContainer: {
    marginBottom: staticTheme.spacing.xxl,
    maxWidth: 500,
  },
  description: {
    fontSize: staticTheme.typography.fontSize.md,
    lineHeight: 24,
    textAlign: 'center',
  },
  buttonsContainer: {
    width: '100%',
    maxWidth: 400,
    gap: 12,
  },
  primaryButton: {
    paddingVertical: staticTheme.spacing.md,
    paddingHorizontal: staticTheme.spacing.xl,
    borderRadius: staticTheme.borderRadius.md,
  },
  primaryButtonText: {
    fontSize: staticTheme.typography.fontSize.md,
    fontWeight: staticTheme.typography.fontWeight.medium,
    textAlign: 'center',
  },
  secondaryButton: {
    borderWidth: 1,
    paddingVertical: staticTheme.spacing.md,
    paddingHorizontal: staticTheme.spacing.xl,
    borderRadius: staticTheme.borderRadius.md,
  },
  secondaryButtonText: {
    fontSize: staticTheme.typography.fontSize.md,
    fontWeight: staticTheme.typography.fontWeight.medium,
    textAlign: 'center',
  },
  footer: {
    marginTop: staticTheme.spacing.xxl,
  },
  footerText: {
    fontSize: staticTheme.typography.fontSize.xs,
  },
});

export default LandingScreen;

