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

export type RootStackParamList = {
  Landing: undefined;
  Login: undefined;
  Tabs: undefined;
};

const AuthStack = createNativeStackNavigator<RootStackParamList>();
const AppStack = createNativeStackNavigator<RootStackParamList>();

const AppNavigator: React.FC = () => {
  const { user, loading } = useAuth();

  // Show nothing while checking auth
  if (loading) {
    return null;
  }

  // Conditionally render different navigators
  if (user) {
    return (
      <AppStack.Navigator
        screenOptions={{ headerShown: false }}>
        <AppStack.Screen name="Tabs" component={TabNavigator} />
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

