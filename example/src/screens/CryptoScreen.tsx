import React from 'react';
import { View, Text, StyleSheet, Button, ScrollView } from 'react-native';
import { nitroFetchOnWorklet } from 'react-native-nitro-fetch';
import { theme } from '../theme';

export function CryptoScreen() {
  const [prices, setPrices] = React.useState<
    Array<{ id: string; usd: number }>
  >([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadPrices = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const ids = [
      'bitcoin',
      'ethereum',
      'solana',
      'dogecoin',
      'litecoin',
      'cardano',
      'ripple',
      'polkadot',
      'chainlink',
      'polygon-pos',
    ];
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd`;

    const mapper = (payload: { body?: string }) => {
      'worklet';
      console.log('payload', payload);
      const txt = payload.body ?? '';
      const json = JSON.parse(txt) as Record<string, { usd: number }>;
      const entries = Object.entries(json);
      const arr = [];
      for (let i = 0; i < entries.length; ++i) {
        const entry = entries[i];
        arr.push({ id: entry[0], usd: entry[1].usd });
      }
      for (let i = 0; i < arr.length - 1; ++i) {
        for (let j = i + 1; j < arr.length; ++j) {
          if (arr[i].id > arr[j].id) {
            const tmp = arr[i] as { id: string; usd: number };
            arr[i] = arr[j];
            arr[j] = tmp;
          }
        }
      }
      return arr;
    };

    try {
    
      const data = await nitroFetchOnWorklet(url, undefined, mapper, {
        preferBytes: false,
      });
      setPrices(data);
    } catch (e: any) {
      setError(`Failed to load: ${e?.message ?? String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadPrices();
  }, [loadPrices]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Button
          title={loading ? 'Refreshing...' : 'Refresh Prices'}
          onPress={loadPrices}
          disabled={loading}
        />
      </View>

      {error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.list}>
        {prices.map((p) => (
          <View key={p.id} style={styles.card}>
            <View style={styles.iconContainer}>
              <Text style={styles.icon}>{p.id.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.info}>
              <Text style={styles.name}>{p.id}</Text>
              <Text style={styles.symbol}>
                {p.id.substring(0, 3).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.price}>
              ${p.usd.toLocaleString(undefined, { maximumFractionDigits: 6 })}
            </Text>
          </View>
        ))}
        {prices.length === 0 && !loading && !error && (
          <Text style={styles.emptyText}>No data available</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  errorContainer: {
    padding: theme.spacing.md,
    backgroundColor: '#FFE5E5',
    margin: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 14,
  },
  list: {
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: `${theme.colors.primary}15`,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  icon: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.primary,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    textTransform: 'capitalize',
  },
  symbol: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  price: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.text,
    fontVariant: ['tabular-nums'],
  },
  emptyText: {
    textAlign: 'center',
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xl,
  },
});
