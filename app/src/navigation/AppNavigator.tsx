/**
 * App Navigator
 * 
 * Handles navigation between auth screens and tab navigation
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../contexts/AuthContext';
import LandingScreen from '../screens/LandingScreen';
import LoginScreen from '../screens/LoginScreen';
import TabNavigator from './TabNavigator';
import LoadingScreen from '../components/LoadingScreen';
import DeviceDetailScreen from '../screens/DeviceDetailScreen';
import RecordScreen from '../screens/RecordScreen';
import DataDetailScreen from '../screens/DataDetailScreen';
import RideDetailScreen from '../screens/RideDetailScreen';
import DeviceDetailV2Screen from '../screens/DeviceDetailV2Screen';

export type RootStackParamList = {
  Landing: undefined;
  Login: undefined;
  Tabs: undefined;
  DeviceDetail: { deviceId: string; deviceName: string; autoConnect?: boolean };
  DeviceDetailV2: { deviceId: string; deviceName: string };
  Record: { deviceId: string; deviceName: string };
  DataDetail: { fileName: string; filePath: string };
  RideDetail: { rideId: string };
};

const AuthStack = createNativeStackNavigator<RootStackParamList>();
const AppStack = createNativeStackNavigator<RootStackParamList>();

const AppNavigator: React.FC = () => {
  const { user, loading } = useAuth();

  // Show loading screen while checking auth
  if (loading) {
    return <LoadingScreen />;
  }

  // Conditionally render different navigators
  if (user) {
    return (
      <AppStack.Navigator
        screenOptions={{ headerShown: false }}>
        <AppStack.Screen name="Tabs" component={TabNavigator} />
        <AppStack.Screen name="DeviceDetail" component={DeviceDetailScreen} />
        <AppStack.Screen name="DeviceDetailV2" component={DeviceDetailV2Screen} />
        <AppStack.Screen name="Record" component={RecordScreen} />
        <AppStack.Screen name="DataDetail" component={DataDetailScreen} />
        <AppStack.Screen name="RideDetail" component={RideDetailScreen} />
      </AppStack.Navigator>
    );
  }

  return (
    <AuthStack.Navigator
      screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Landing" component={LandingScreen} />
      <AuthStack.Screen name="Login" component={LoginScreen} />
    </AuthStack.Navigator>
  );
};

export default AppNavigator;

