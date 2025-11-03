/**
 * Navigation Type Definitions
 *
 * Type-safe navigation props for all screens
 */

import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { RouteProp } from '@react-navigation/native';

// Root Stack (AppNavigator)
export type RootStackParamList = {
  Landing: undefined;
  Login: undefined;
  Tabs: undefined;
  DeviceDetail: { deviceId: string; deviceName: string; autoConnect?: boolean };
  Record: { deviceId: string; deviceName: string };
  DataDetail: { fileName: string; filePath: string };
};

// Tab Stack (TabNavigator)
export type TabParamList = {
  Dashboard: undefined;
  Rides: undefined;
  Data: undefined;
  Devices: undefined;
  Profile: undefined;
};

// Navigation Props
export type RootStackNavigationProp<T extends keyof RootStackParamList> =
  NativeStackNavigationProp<RootStackParamList, T>;

export type TabNavigationProp<T extends keyof TabParamList> =
  BottomTabNavigationProp<TabParamList, T>;

// Route Props
export type RootStackRouteProp<T extends keyof RootStackParamList> =
  RouteProp<RootStackParamList, T>;

export type TabRouteProp<T extends keyof TabParamList> =
  RouteProp<TabParamList, T>;

// Combined Props for screens
export interface RootStackScreenProps<T extends keyof RootStackParamList> {
  navigation: RootStackNavigationProp<T>;
  route: RootStackRouteProp<T>;
}

export interface TabScreenProps<T extends keyof TabParamList> {
  navigation: TabNavigationProp<T>;
  route: TabRouteProp<T>;
}
