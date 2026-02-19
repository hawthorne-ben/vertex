/**
 * Loading Screen Component
 *
 * Elegant loading screen with VERTEX branding
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { theme as staticTheme } from '../styles/theme';
import { useTheme } from '../contexts/ThemeContext';

const LoadingScreen: React.FC = () => {
  const { theme } = useTheme();
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Pulse animation for logo
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Rotate animation for spinner
    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 1500,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Animated.View style={{ opacity: pulseAnim }}>
        <Text style={[styles.logo, { color: theme.colors.textPrimary }]}>VERTEX</Text>
      </Animated.View>

      <Animated.View style={[styles.spinner, { transform: [{ rotate: spin }] }]}>
        <View style={[styles.spinnerDot, { backgroundColor: theme.colors.textSecondary }]} />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    fontSize: staticTheme.typography.fontSize.xxxl,
    fontFamily: staticTheme.typography.serif,
    fontWeight: staticTheme.typography.fontWeight.normal,
    letterSpacing: 2,
    marginBottom: staticTheme.spacing.xl,
  },
  spinner: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  spinnerDot: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
});

export default LoadingScreen;
