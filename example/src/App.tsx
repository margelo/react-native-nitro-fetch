import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { fetch } from 'react-native-nitro-fetch';

export default function App() {
  const [text, setText] = React.useState('Loading...');

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('https://httpbin.org/get');
        const json = await res.json();
        if (!cancelled) setText(`Status ${res.status} • Origin ${json.origin}`);
      } catch (e: any) {
        if (!cancelled) setText(`Error: ${e?.message ?? String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <View style={styles.container}>
      <Text>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
