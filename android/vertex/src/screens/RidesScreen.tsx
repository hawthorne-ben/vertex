/**
 * Rides Screen
 * 
 * Lists all recorded rides
 */

import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../styles/theme';

const RidesScreen: React.FC = () => {
  const insets = useSafeAreaInsets();

  // Placeholder rides data
  const rides = [
    { name: 'Mountain Ride', date: '2 days ago', distance: '12.3 mi', duration: '45 min' },
    { name: 'Track Day Session 1', date: '5 days ago', distance: '5.8 mi', duration: '28 min' },
    { name: 'City Commute', date: '1 week ago', distance: '8.1 mi', duration: '32 min' },
  ];

  return (
    <ScrollView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.content}>
        <Text style={styles.title}>Rides</Text>

        {rides.map((ride, index) => (
          <View key={index} style={styles.rideCard}>
            <View style={styles.rideHeader}>
              <Text style={styles.rideName}>{ride.name}</Text>
              <Text style={styles.rideDate}>{ride.date}</Text>
            </View>
            <View style={styles.rideDetails}>
              <Text style={styles.rideDetail}>Distance: {ride.distance}</Text>
              <Text style={styles.rideDetail}>Duration: {ride.duration}</Text>
            </View>
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
  rideCard: {
    backgroundColor: theme.colors.muted,
    padding: theme.spacing.lg,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rideHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  rideName: {
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.serif,
  },
  rideDate: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
  },
  rideDetails: {
    flexDirection: 'row',
    gap: theme.spacing.lg,
  },
  rideDetail: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.serif,
  },
});

export default RidesScreen;

