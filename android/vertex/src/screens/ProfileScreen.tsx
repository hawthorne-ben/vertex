/**
 * Profile Screen
 * 
 * User profile and settings with tabs
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../styles/theme';
import { createClient } from '../lib/supabase';

type TabType = 'profile' | 'bikes' | 'preferences' | 'account';

const ProfileScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
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

  const TabButton: React.FC<{ tab: TabType; label: string }> = ({ tab, label }) => (
    <TouchableOpacity
      style={[styles.tab, activeTab === tab && styles.tabActive]}
      onPress={() => setActiveTab(tab)}>
      <Text style={[styles.tabLabel, activeTab === tab && styles.tabLabelActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Static Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.tabRow}>
            <TabButton tab="profile" label="Profile" />
            <TabButton tab="bikes" label="Bikes" />
            <TabButton tab="preferences" label="Preferences" />
            <TabButton tab="account" label="Account" />
          </View>
        </ScrollView>
      </View>

      {/* Tab Content */}
      <ScrollView style={styles.content}>
        {activeTab === 'profile' && (
          <View style={styles.section}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Profile Information</Text>
              
              {message && (
                <View style={[styles.message, message.type === 'success' ? styles.messageSuccess : styles.messageError]}>
                  <Text style={styles.messageText}>{message.text}</Text>
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Full Name</Text>
                <TextInput
                  style={styles.input}
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Your name"
                  editable={!loading}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={[styles.input, styles.inputDisabled]}
                  value={user?.email || ''}
                  editable={false}
                />
                <Text style={styles.helperText}>
                  Email is tied to your account and cannot be changed here.
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleSaveProfile}
                disabled={loading}>
                <Text style={styles.buttonText}>
                  {loading ? 'Saving...' : 'Save Changes'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {activeTab === 'bikes' && (
          <View style={styles.section}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Your Bikes</Text>
              <Text style={styles.emptyText}>No bikes configured yet.</Text>
              <TouchableOpacity style={styles.button}>
                <Text style={styles.buttonText}>Add Bike</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {activeTab === 'preferences' && (
          <View style={styles.section}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Preferences</Text>
              <Text style={styles.emptyText}>Preferences coming soon.</Text>
            </View>
          </View>
        )}

        {activeTab === 'account' && (
          <View style={styles.section}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Account Management</Text>
              
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Account ID</Text>
                <View style={styles.codeBlock}>
                  <Text style={styles.codeText}>{user?.id || 'Loading...'}</Text>
                </View>
                <Text style={styles.helperText}>
                  Your unique identifier (never changes)
                </Text>
              </View>

              <View style={styles.divider} />

              <Text style={styles.dangerText}>Danger Zone</Text>
              <Text style={styles.helperText}>
                Permanently delete your account and all associated data.
              </Text>
              <TouchableOpacity style={[styles.button, styles.buttonDanger]} disabled>
                <Text style={[styles.buttonText, styles.buttonDangerText]}>
                  Delete Account (Coming Soon)
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
              <Text style={styles.signOutText}>Sign Out</Text>
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
    backgroundColor: theme.colors.background,
  },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    backgroundColor: theme.colors.background,
  },
  title: {
    fontSize: theme.typography.fontSize.xxxl,
    fontWeight: theme.typography.fontWeight.light,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
  },
  tabs: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.background,
  },
  tabRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  tab: {
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: theme.colors.primary,
  },
  tabLabel: {
    fontSize: theme.typography.fontSize.md,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
  },
  tabLabelActive: {
    color: theme.colors.textPrimary,
    fontWeight: theme.typography.fontWeight.medium,
  },
  content: {
    flex: 1,
  },
  section: {
    padding: theme.spacing.lg,
  },
  card: {
    backgroundColor: theme.colors.muted,
    padding: theme.spacing.lg,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
    marginBottom: theme.spacing.lg,
  },
  message: {
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.sm,
    marginBottom: theme.spacing.md,
  },
  messageSuccess: {
    backgroundColor: theme.colors.successBg,
    borderWidth: 1,
    borderColor: theme.colors.success,
  },
  messageError: {
    backgroundColor: theme.colors.errorBg,
    borderWidth: 1,
    borderColor: theme.colors.error,
  },
  messageText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
  },
  inputGroup: {
    marginBottom: theme.spacing.lg,
  },
  label: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
    marginBottom: theme.spacing.sm,
  },
  input: {
    backgroundColor: theme.colors.formBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    padding: theme.spacing.md,
    fontSize: theme.typography.fontSize.md,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
  },
  inputDisabled: {
    backgroundColor: theme.colors.muted,
    color: theme.colors.textTertiary,
  },
  helperText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
    marginTop: theme.spacing.xs,
  },
  codeBlock: {
    backgroundColor: theme.colors.muted,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  codeText: {
    fontSize: theme.typography.fontSize.xs,
    fontFamily: theme.typography.mono,
    color: theme.colors.textPrimary,
  },
  emptyText: {
    fontSize: theme.typography.fontSize.md,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
    textAlign: 'center',
    paddingVertical: theme.spacing.xxl,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.lg,
  },
  dangerText: {
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.error,
    fontFamily: theme.typography.serif,
    marginBottom: theme.spacing.sm,
  },
  button: {
    backgroundColor: theme.colors.primary,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
    marginTop: theme.spacing.md,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: theme.colors.primaryForeground,
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.medium,
    fontFamily: theme.typography.serif,
  },
  buttonDanger: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.colors.error,
  },
  buttonDangerText: {
    color: theme.colors.error,
  },
  signOutButton: {
    backgroundColor: theme.colors.error,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
    margin: theme.spacing.lg,
  },
  signOutText: {
    color: theme.colors.primaryForeground,
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.semibold,
    fontFamily: theme.typography.serif,
  },
});

export default ProfileScreen;
