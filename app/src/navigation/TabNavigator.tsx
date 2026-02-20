/**
 * Tab Navigator
 *
 * Bottom tab navigation for authenticated users
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { Home, Bike, FileText, Wifi, User } from 'lucide-react-native';

// Screens
import DashboardScreen from '../screens/DashboardScreen';
import RidesScreen from '../screens/RidesScreen';
import DataScreen from '../screens/DataScreen';
import DevicesScreen from '../screens/DevicesScreen';
import ProfileScreen from '../screens/ProfileScreen';

export type TabParamList = {
  Dashboard: undefined;
  Rides: undefined;
  Data: undefined;
  Devices: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

function TabIcon({ children, focused, activeColor }: { children: React.ReactNode; focused: boolean; activeColor: string }) {
  return (
    <View style={[styles.iconWrapper, focused && { backgroundColor: activeColor }]}>
      {children}
    </View>
  );
}

const TabNavigator: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();

  const activeBg = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          paddingBottom: insets.bottom,
          paddingTop: 8,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          backgroundColor: theme.colors.background,
        },
        tabBarActiveTintColor: theme.colors.textPrimary,
        tabBarInactiveTintColor: theme.colors.textTertiary,
        tabBarShowLabel: false,
      }}>
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} activeColor={activeBg}>
              <Home size={size || 20} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tab.Screen
        name="Rides"
        component={RidesScreen}
        options={{
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} activeColor={activeBg}>
              <Bike size={size || 20} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tab.Screen
        name="Data"
        component={DataScreen}
        options={{
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} activeColor={activeBg}>
              <FileText size={size || 20} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tab.Screen
        name="Devices"
        component={DevicesScreen}
        options={{
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} activeColor={activeBg}>
              <Wifi size={size || 20} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused} activeColor={activeBg}>
              <User size={size || 20} color={color} />
            </TabIcon>
          ),
        }}
      />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  iconWrapper: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
  },
});

export default TabNavigator;
