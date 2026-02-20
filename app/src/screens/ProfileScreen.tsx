/**
 * Profile Screen
 * 
 * User profile and settings with tabs
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, TextInput, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { theme as staticTheme } from '../styles/theme';
import { useTheme } from '../contexts/ThemeContext';
import { createClient } from '../lib/supabase';

type TabType = 'profile' | 'bikes' | 'preferences' | 'account';

const ProfileScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { theme, mode, setMode, isDark } = useTheme();
  const { user, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('profile');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    if (user?.user_metadata?.full_name) {
      setFullName(user.user_metadata.full_name);
    }
  }, [user]);

  const handleSaveProfile = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({
        data: { full_name: fullName }
      });

      if (error) throw error;
      setMessage({ type: 'success', text: 'Profile updated successfully!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to update profile' });
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await signOut();
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Translucent Header */}
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: isDark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.92)' }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Settings</Text>
      </View>

      {/* Tab Selector - Compact style matching chart switcher */}
      <View style={[styles.tabSelectorWrapper, { paddingTop: insets.top + 56 }]}>
        <View style={[styles.tabSelector, { backgroundColor: theme.colors.muted }]}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'profile' && { backgroundColor: theme.colors.card }]}
            onPress={() => setActiveTab('profile')}>
            <Text style={[
              styles.tabText,
              { color: theme.colors.textSecondary },
              activeTab === 'profile' && { color: theme.colors.primary, fontWeight: staticTheme.typography.fontWeight.semibold }
            ]}>
              Profile
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'bikes' && { backgroundColor: theme.colors.card }]}
            onPress={() => setActiveTab('bikes')}>
            <Text style={[
              styles.tabText,
              { color: theme.colors.textSecondary },
              activeTab === 'bikes' && { color: theme.colors.primary, fontWeight: staticTheme.typography.fontWeight.semibold }
            ]}>
              Bikes
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'preferences' && { backgroundColor: theme.colors.card }]}
            onPress={() => setActiveTab('preferences')}>
            <Text style={[
              styles.tabText,
              { color: theme.colors.textSecondary },
              activeTab === 'preferences' && { color: theme.colors.primary, fontWeight: staticTheme.typography.fontWeight.semibold }
            ]}>
              Prefs
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'account' && { backgroundColor: theme.colors.card }]}
            onPress={() => setActiveTab('account')}>
            <Text style={[
              styles.tabText,
              { color: theme.colors.textSecondary },
              activeTab === 'account' && { color: theme.colors.primary, fontWeight: staticTheme.typography.fontWeight.semibold }
            ]}>
              Account
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Tab Content */}
      <ScrollView style={styles.content}>
        {activeTab === 'profile' && (
          <View style={styles.section}>
            <View style={[styles.card, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}>
              <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>Profile Information</Text>

              {message && (
                <View style={[
                  styles.message,
                  message.type === 'success'
                    ? { backgroundColor: theme.colors.successBg, borderColor: theme.colors.success }
                    : { backgroundColor: theme.colors.errorBg, borderColor: theme.colors.error }
                ]}>
                  <Text style={[styles.messageText, { color: theme.colors.textPrimary }]}>{message.text}</Text>
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: theme.colors.textPrimary }]}>Full Name</Text>
                <TextInput
                  style={[styles.input, {
                    backgroundColor: theme.colors.formBackground,
                    borderColor: theme.colors.border,
                    color: theme.colors.textPrimary
                  }]}
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Your name"
                  placeholderTextColor={theme.colors.textTertiary}
                  editable={!loading}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: theme.colors.textPrimary }]}>Email</Text>
                <TextInput
                  style={[styles.input, {
                    backgroundColor: theme.colors.muted,
                    borderColor: theme.colors.border,
                    color: theme.colors.textTertiary
                  }]}
                  value={user?.email || ''}
                  editable={false}
                />
                <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>
                  Email is tied to your account and cannot be changed here.
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: theme.colors.textPrimary }]}>Theme</Text>
                <View style={[styles.themeToggleContainer, {
                  backgroundColor: theme.colors.formBackground,
                  borderColor: theme.colors.border
                }]}>
                  <Text style={[styles.themeToggleLabel, { color: theme.colors.textPrimary }]}>
                    Dark Mode
                  </Text>
                  <Switch
                    value={isDark}
                    onValueChange={(value) => setMode(value ? 'dark' : 'light')}
                    trackColor={{
                      false: theme.colors.border,
                      true: theme.colors.primary
                    }}
                    thumbColor={theme.colors.primaryForeground}
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.colors.primary }, loading && styles.buttonDisabled]}
                onPress={handleSaveProfile}
                disabled={loading}>
                <Text style={[styles.buttonText, { color: theme.colors.primaryForeground }]}>
                  {loading ? 'Saving...' : 'Save Changes'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {activeTab === 'bikes' && (
          <View style={styles.section}>
            <View style={[styles.card, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}>
              <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>Your Bikes</Text>
              <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>No bikes configured yet.</Text>
              <TouchableOpacity style={[styles.button, { backgroundColor: theme.colors.primary }]}>
                <Text style={[styles.buttonText, { color: theme.colors.primaryForeground }]}>Add Bike</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {activeTab === 'preferences' && (
          <View style={styles.section}>
            <View style={[styles.card, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}>
              <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>Preferences</Text>
              <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>Preferences coming soon.</Text>
            </View>
          </View>
        )}

        {activeTab === 'account' && (
          <View style={styles.section}>
            <View style={[styles.card, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}>
              <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>Account Management</Text>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: theme.colors.textPrimary }]}>Account ID</Text>
                <View style={[styles.codeBlock, { backgroundColor: theme.colors.muted, borderColor: theme.colors.border }]}>
                  <Text style={[styles.codeText, { color: theme.colors.textPrimary }]}>{user?.id || 'Loading...'}</Text>
                </View>
                <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>
                  Your unique identifier (never changes)
                </Text>
              </View>

              <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />

              <Text style={[styles.dangerText, { color: theme.colors.error }]}>Danger Zone</Text>
              <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>
                Permanently delete your account and all associated data.
              </Text>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.error }]}
                disabled>
                <Text style={[styles.buttonText, { color: theme.colors.error }]}>
                  Delete Account (Coming Soon)
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={[styles.signOutButton, { backgroundColor: theme.colors.error }]} onPress={handleSignOut}>
              <Text style={[styles.signOutText, { color: theme.colors.primaryForeground }]}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: staticTheme.spacing.lg,
    paddingVertical: staticTheme.spacing.md,
  },
  title: {
    fontSize: staticTheme.typography.fontSize.xxl,
    fontWeight: staticTheme.typography.fontWeight.light,
    fontFamily: staticTheme.typography.serif,
  },
  tabSelectorWrapper: {
    paddingHorizontal: staticTheme.spacing.lg,
    paddingVertical: staticTheme.spacing.md,
  },
  tabSelector: {
    flexDirection: 'row',
    borderRadius: staticTheme.borderRadius.md,
    padding: 4,
  },
  tabButton: {
    flex: 1,
    paddingVertical: staticTheme.spacing.sm,
    paddingHorizontal: staticTheme.spacing.xs,
    borderRadius: staticTheme.borderRadius.sm,
    alignItems: 'center',
  },
  tabText: {
    fontSize: staticTheme.typography.fontSize.sm,
    fontFamily: staticTheme.typography.serif,
    fontWeight: staticTheme.typography.fontWeight.medium,
  },
  content: {
    flex: 1,
  },
  section: {
    padding: staticTheme.spacing.lg,
  },
  card: {
    padding: staticTheme.spacing.lg,
    borderRadius: staticTheme.borderRadius.md,
    borderWidth: 1,
  },
  cardTitle: {
    fontSize: staticTheme.typography.fontSize.lg,
    fontWeight: staticTheme.typography.fontWeight.medium,
    fontFamily: staticTheme.typography.serif,
    marginBottom: staticTheme.spacing.lg,
  },
  message: {
    padding: staticTheme.spacing.md,
    borderRadius: staticTheme.borderRadius.sm,
    marginBottom: staticTheme.spacing.md,
    borderWidth: 1,
  },
  messageText: {
    fontSize: staticTheme.typography.fontSize.sm,
    fontFamily: staticTheme.typography.serif,
  },
  inputGroup: {
    marginBottom: staticTheme.spacing.lg,
  },
  label: {
    fontSize: staticTheme.typography.fontSize.sm,
    fontWeight: staticTheme.typography.fontWeight.medium,
    fontFamily: staticTheme.typography.serif,
    marginBottom: staticTheme.spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderRadius: staticTheme.borderRadius.sm,
    padding: staticTheme.spacing.md,
    fontSize: staticTheme.typography.fontSize.md,
    fontFamily: staticTheme.typography.serif,
  },
  themeToggleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: staticTheme.spacing.md,
    borderRadius: staticTheme.borderRadius.sm,
    borderWidth: 1,
  },
  themeToggleLabel: {
    fontSize: staticTheme.typography.fontSize.md,
    fontFamily: staticTheme.typography.serif,
  },
  helperText: {
    fontSize: staticTheme.typography.fontSize.xs,
    fontFamily: staticTheme.typography.serif,
    marginTop: staticTheme.spacing.xs,
  },
  codeBlock: {
    padding: staticTheme.spacing.sm,
    borderRadius: staticTheme.borderRadius.sm,
    borderWidth: 1,
  },
  codeText: {
    fontSize: staticTheme.typography.fontSize.xs,
    fontFamily: staticTheme.typography.mono,
  },
  emptyText: {
    fontSize: staticTheme.typography.fontSize.md,
    fontFamily: staticTheme.typography.serif,
    textAlign: 'center',
    paddingVertical: staticTheme.spacing.xxl,
  },
  divider: {
    height: 1,
    marginVertical: staticTheme.spacing.lg,
  },
  dangerText: {
    fontSize: staticTheme.typography.fontSize.md,
    fontWeight: staticTheme.typography.fontWeight.medium,
    fontFamily: staticTheme.typography.serif,
    marginBottom: staticTheme.spacing.sm,
  },
  button: {
    paddingVertical: staticTheme.spacing.md,
    borderRadius: staticTheme.borderRadius.md,
    alignItems: 'center',
    marginTop: staticTheme.spacing.md,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: staticTheme.typography.fontSize.md,
    fontWeight: staticTheme.typography.fontWeight.medium,
    fontFamily: staticTheme.typography.serif,
  },
  signOutButton: {
    paddingVertical: staticTheme.spacing.md,
    borderRadius: staticTheme.borderRadius.md,
    alignItems: 'center',
    margin: staticTheme.spacing.lg,
  },
  signOutText: {
    fontSize: staticTheme.typography.fontSize.md,
    fontWeight: staticTheme.typography.fontWeight.semibold,
    fontFamily: staticTheme.typography.serif,
  },
});

export default ProfileScreen;
