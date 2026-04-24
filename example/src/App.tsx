import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import type { RootStackParamList, MainTabParamList } from './navigation';
import { theme } from './theme';

import { HomeScreen } from './screens/HomeScreen';
import { BenchmarkScreen } from './screens/BenchmarkScreen';
import { CryptoScreen } from './screens/CryptoScreen';
import { PostAndUploadScreen } from './screens/PostAndUploadScreen';
import { PrefetchScreen } from './screens/PrefetchScreen';
import { AbortScreen } from './screens/AbortScreen';
import { BasicFetchScreen } from './screens/BasicFetchScreen';
import { StreamingScreen } from './screens/StreamingScreen';
import { WebSocketScreen } from './screens/WebSocketScreen';
import { WebSocketBenchmarkScreen } from './screens/WebSocketBenchmarkScreen';
import { NetworkInspectorScreen } from './screens/NetworkInspectorScreen';
import { DevToolsDemoScreen } from './screens/DevToolsDemoScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

const ExamplesIcon = ({ color }: { color: string }) => (
  <TabBarIcon icon="📱" color={color} />
);
const BenchmarkIcon = ({ color }: { color: string }) => (
  <TabBarIcon icon="⚡" color={color} />
);

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.colors.card,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
        },
      }}
    >
      <Tab.Screen
        name="Examples"
        component={HomeScreen}
        options={{
          tabBarIcon: ExamplesIcon,
        }}
      />
      <Tab.Screen
        name="Benchmark"
        component={BenchmarkScreen}
        options={{
          tabBarIcon: BenchmarkIcon,
        }}
      />
    </Tab.Navigator>
  );
}

const TabBarIcon = ({ icon, color }: { icon: string; color: string }) => (
  <React.Fragment>
    {/* Using text emoji due to lack of vector icons in raw setup, colored via wrapper if possible */}
    <Text
      style={[
        styles.tabIcon,
        color === theme.colors.primary && styles.tabIconActive,
      ]}
    >
      {icon}
    </Text>
  </React.Fragment>
);

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: {
            backgroundColor: theme.colors.card,
          },
          headerTintColor: theme.colors.text,
          headerShadowVisible: false,
          headerBackTitle: 'Back',
        }}
      >
        <Stack.Screen
          name="MainTabs"
          component={MainTabs}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="CryptoScreen"
          component={CryptoScreen}
          options={{ title: 'Crypto Prices' }}
        />
        <Stack.Screen
          name="PostAndUploadScreen"
          component={PostAndUploadScreen}
          options={{ title: 'POST & Uploads' }}
        />
        <Stack.Screen
          name="PrefetchScreen"
          component={PrefetchScreen}
          options={{ title: 'Prefetching' }}
        />
        <Stack.Screen
          name="AbortScreen"
          component={AbortScreen}
          options={{ title: 'Abort Handling' }}
        />
        <Stack.Screen
          name="BasicFetchScreen"
          component={BasicFetchScreen}
          options={{ title: 'Basic Fetch' }}
        />
        <Stack.Screen
          name="StreamingScreen"
          component={StreamingScreen}
          options={{ title: 'Streaming' }}
        />
        <Stack.Screen
          name="WebSocketScreen"
          component={WebSocketScreen}
          options={{ title: 'WebSocket' }}
        />
        <Stack.Screen
          name="WebSocketBenchmarkScreen"
          component={WebSocketBenchmarkScreen}
          options={{ title: 'WS Benchmark' }}
        />
        <Stack.Screen
          name="NetworkInspectorScreen"
          component={NetworkInspectorScreen}
          options={{ title: 'Network Inspector' }}
        />
        <Stack.Screen
          name="DevToolsDemoScreen"
          component={DevToolsDemoScreen}
          options={{ title: 'DevTools Demo' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabIcon: {
    fontSize: 20,
    opacity: 0.5,
  },
  tabIconActive: {
    opacity: 1,
  },
});
