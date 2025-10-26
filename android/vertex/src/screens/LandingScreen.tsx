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
import { theme } from '../styles/theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const LandingScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();

  return (
    <ScrollView 
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}>
      {/* Logo/Title */}
      <Text style={styles.logo}>VERTEX</Text>
      <Text style={styles.tagline}>Your ride, unencrypted</Text>

      <View style={styles.descriptionContainer}>
        <Text style={styles.description}>
          Measure how you actually ride. Understand cornering forces, braking smoothness, 
          body position stability, and how your equipment affects comfort—with objective data 
          from IMU motion analysis.
        </Text>
      </View>

      {/* CTA Buttons */}
      <View style={styles.buttonsContainer}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.navigate('Login')}>
          <Text style={styles.primaryButtonText}>Get Started</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => {
            // Skip auth and go to BLE scanner (Devices tab)
            // Note: This won't work without auth - user needs to login first
            Alert.alert('Info', 'Please sign in to access device scanner');
          }}>
          <Text style={styles.secondaryButtonText}>Continue without account</Text>
        </TouchableOpacity>
      </View>

      {/* Footer info */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Beta platform in development
        </Text>
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
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: theme.spacing.xxl,
  },
  logo: {
    fontSize: 48,
    fontFamily: theme.typography.serif,
    fontWeight: theme.typography.fontWeight.normal,
    letterSpacing: 2,
    marginBottom: theme.spacing.md,
    color: theme.colors.textPrimary,
  },
  tagline: {
    fontSize: 24,
    fontWeight: theme.typography.fontWeight.light,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xxl,
    textAlign: 'center',
  },
  descriptionContainer: {
    marginBottom: theme.spacing.xxl,
    maxWidth: 500,
  },
  description: {
    fontSize: theme.typography.fontSize.md,
    lineHeight: 24,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  buttonsContainer: {
    width: '100%',
    maxWidth: 400,
    gap: 12,
  },
  primaryButton: {
    backgroundColor: theme.colors.primary,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    borderRadius: theme.borderRadius.md,
  },
  primaryButtonText: {
    color: theme.colors.primaryForeground,
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.medium,
    textAlign: 'center',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    borderRadius: theme.borderRadius.md,
  },
  secondaryButtonText: {
    color: theme.colors.textPrimary,
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.medium,
    textAlign: 'center',
  },
  footer: {
    marginTop: theme.spacing.xxl,
  },
  footerText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textTertiary,
  },
});

export default LandingScreen;

