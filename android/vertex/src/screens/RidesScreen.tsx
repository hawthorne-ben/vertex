/**
 * Rides Screen
 *
 * Lists all recorded rides
 */

import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { theme as staticTheme } from '../styles/theme';

const RidesScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

  // Placeholder rides data
  const rides = [
    { name: 'Mountain Ride', date: '2 days ago', distance: '12.3 mi', duration: '45 min' },
    { name: 'Track Day Session 1', date: '5 days ago', distance: '5.8 mi', duration: '28 min' },
    { name: 'City Commute', date: '1 week ago', distance: '8.1 mi', duration: '32 min' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Fixed Header */}
      <View style={[styles.header, {
        paddingTop: insets.top,
        backgroundColor: theme.colors.background,
        borderBottomColor: theme.colors.border
      }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
          Rides
        </Text>
      </View>

      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          {rides.map((ride, index) => (
            <View key={index} style={[styles.rideCard, {
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border
            }]}>
              <View style={styles.rideHeader}>
                <Text style={[styles.rideName, { color: theme.colors.textPrimary }]}>
                  {ride.name}
                </Text>
                <Text style={[styles.rideDate, { color: theme.colors.textSecondary }]}>
                  {ride.date}
                </Text>
              </View>
              <View style={styles.rideDetails}>
                <Text style={[styles.rideDetail, { color: theme.colors.textSecondary }]}>
                  Distance: {ride.distance}
                </Text>
                <Text style={[styles.rideDetail, { color: theme.colors.textSecondary }]}>
                  Duration: {ride.duration}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 32,
    fontWeight: '300',
    fontFamily: staticTheme.typography.serif,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 24,
  },
  rideCard: {
    padding: 24,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
  },
  rideHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  rideName: {
    fontSize: 18,
    fontWeight: '600',
    fontFamily: staticTheme.typography.serif,
  },
  rideDate: {
    fontSize: 14,
    fontFamily: staticTheme.typography.serif,
  },
  rideDetails: {
    gap: 8,
  },
  rideDetail: {
    fontSize: 14,
    fontFamily: staticTheme.typography.serif,
  },
});

export default RidesScreen;
