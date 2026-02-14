/**
 * Login Screen
 *
 * Matches web app's login design
 * Refactored to use new component library and hooks
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { createClient } from '../lib/supabase';
import { Button, Input } from '../components/ui';
import { AuthError } from '../types/errors.types';
import { getUserFriendlyError } from '../utils/errorUtils';

const LoginScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { showToast } = useToast();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({ email: '', password: '' });

  const validateForm = (): boolean => {
    const newErrors = { email: '', password: '' };
    let isValid = true;

    if (!email) {
      newErrors.email = 'Email is required';
      isValid = false;
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Please enter a valid email';
      isValid = false;
    }

    if (!password) {
      newErrors.password = 'Password is required';
      isValid = false;
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleLogin = async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // Convert to AuthError for consistent handling
        const authError = new AuthError(
          error.message,
          error.message.includes('Invalid') ? 'INVALID_CREDENTIALS' : 'UNKNOWN',
          error.message
        );
        throw authError;
      }

      // Manually update auth state for immediate navigation
      auth.setUser(data.user);

      showToast({
        message: 'Welcome back!',
        variant: 'success',
        duration: 2000,
      });
    } catch (error) {
      showToast({
        message: getUserFriendlyError(error),
        variant: 'error',
        duration: 4000,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.scrollContent}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
          Sign In
        </Text>
        <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
          Access your cycling insights
        </Text>

        <View style={styles.form}>
          <Input
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              setErrors({ ...errors, email: '' });
            }}
            error={errors.email}
            keyboardType="email-address"
            autoCapitalize="none"
            disabled={loading}
            required
          />

          <Input
            label="Password"
            placeholder="••••••••"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              setErrors({ ...errors, password: '' });
            }}
            error={errors.password}
            secureTextEntry
            disabled={loading}
            required
          />

          <Button
            variant="primary"
            loading={loading}
            onPress={handleLogin}
            style={styles.button}>
            Sign In
          </Button>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 48,
    fontWeight: '300',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 48,
  },
  form: {
    gap: 24,
  },
  button: {
    marginTop: 8,
  },
});

export default LoginScreen;
