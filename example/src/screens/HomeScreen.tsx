import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { theme } from '../theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const EXAMPLES = [
  {
    id: 'crypto',
    title: 'Crypto Prices',
    description: 'Fetch and parse crypto prices using a worklet.',
    screen: 'CryptoScreen' as const,
    icon: '💰',
  },
  {
    id: 'post-upload',
    title: 'POST & Uploads',
    description: 'Send POST requests and upload FormData (Text, Image, PDF).',
    screen: 'PostAndUploadScreen' as const,
    icon: '📤',
  },
  {
    id: 'prefetch',
    title: 'Prefetching',
    description: 'Test manual and scheduled prefetching capabilities.',
    screen: 'PrefetchScreen' as const,
    icon: '⚡',
  },
  {
    id: 'abort',
    title: 'Abort Handling',
    description: 'Test AbortController signaling and timeouts.',
    screen: 'AbortScreen' as const,
    icon: '🛑',
  },
  {
    id: 'basic',
    title: 'Basic Fetch',
    description: 'Simple get, text, json, and image fetching examples.',
    screen: 'BasicFetchScreen' as const,
    icon: '🌐',
  },
];

export function HomeScreen() {
  const navigation = useNavigation<NavigationProp>();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Nitro Fetch</Text>
        <Text style={styles.subtitle}>
          Lightning fast networking for React Native
        </Text>
      </View>

      <View style={styles.grid}>
        {EXAMPLES.map((item) => (
          <Pressable
            key={item.id}
            style={({ pressed }) => [
              styles.card,
              pressed && styles.cardPressed,
            ]}
            onPress={() => navigation.navigate(item.screen)}
          >
            <Text style={styles.cardIcon}>{item.icon}</Text>
            <View style={styles.cardTextContainer}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardDesc}>{item.description}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.xl * 2,
  },
  header: {
    marginVertical: theme.spacing.xl,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  subtitle: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  grid: {
    gap: theme.spacing.md,
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  cardIcon: {
    fontSize: 32,
    marginRight: theme.spacing.md,
  },
  cardTextContainer: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    lineHeight: 20,
  },
});
