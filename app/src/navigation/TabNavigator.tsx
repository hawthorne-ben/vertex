/**
 * Tab Navigator
 * 
 * Bottom tab navigation for authenticated users
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { theme as staticTheme } from '../styles/theme';
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

const TabNavigator: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          paddingBottom: insets.bottom,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          backgroundColor: theme.colors.background,
        },
        tabBarActiveTintColor: theme.colors.textPrimary,
        tabBarInactiveTintColor: theme.colors.textTertiary,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
          fontFamily: staticTheme.typography.serif,
        },
      }}>
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Home size={size || 20} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Rides"
        component={RidesScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Bike size={size || 20} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Data"
        component={DataScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <FileText size={size || 20} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Devices"
        component={DevicesScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Wifi size={size || 20} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <User size={size || 20} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

export default TabNavigator;

