import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import {
  fetch as nitroFetch,
  nitroFetchOnWorklet,
} from 'react-native-nitro-fetch';
import { theme } from '../theme';

export function PostAndUploadScreen() {
  const [result, setResult] = React.useState<string>(
    'Press a button to test POST/Upload requests'
  );

  const logResult = (text: string) => setResult(text);

  const sendPostWorklet = async () => {
    logResult('Sending POST request via Worklet...');
    const url = 'https://httpbin.org/post';
    const requestBody = {
      message: 'Hello from Nitro Fetch!',
      timestamp: Date.now(),
      data: { userId: 123, action: 'test' },
    };

    const mapper = (payload: { bodyString?: string; status: number }) => {
      'worklet';
      if (payload.status !== 200) {
        return { success: false, error: `HTTP ${payload.status}` };
      }
      const txt = payload.bodyString ?? '';
      const json = JSON.parse(txt) as {
        json?: typeof requestBody;
        data?: string;
      };
      const sentData = json.json ?? (json.data ? JSON.parse(json.data) : null);
      return {
        success: true,
        sent: sentData,
        received: json,
      };
    };

    try {
      const data = await nitroFetchOnWorklet(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        },
        mapper,
        { preferBytes: false }
      );
      logResult(
        `Success! Target received:\n${JSON.stringify(data.sent, null, 2)}`
      );
    } catch (e: any) {
      logResult(`Error: ${e?.message ?? String(e)}`);
    }
  };

  const sendFormDataText = async () => {
    try {
      logResult('Sending FormData (text fields)...');
      const fd = new FormData();
      fd.append('username', 'nitro_user');
      fd.append('message', 'Hello from Nitro Fetch FormData!');
      fd.append('timestamp', String(Date.now()));

      const res = await nitroFetch('https://httpbin.org/post', {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      const form = json.form ?? {};
      logResult(
        `FormData OK!\n\nParsed Form Data:\n${JSON.stringify(form, null, 2)}`
      );
    } catch (e: any) {
      logResult(`FormData error: ${e?.message ?? String(e)}`);
    }
  };

  const sendFormDataImage = async () => {
    try {
      logResult('Uploading image via FormData...');
      const fd = new FormData();
      fd.append('caption', 'Test image upload');
      fd.append('photo', {
        uri: 'https://picsum.photos/id/1/100/100.jpg',
        type: 'image/jpeg',
        name: 'test_photo.jpg',
      } as any);

      const res = await nitroFetch('https://httpbin.org/post', {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      logResult(
        `Image upload OK!\n\nFiles uploaded: ${Object.keys(json.files ?? {}).join(', ') || 'none'}` +
          `\nText fields: ${Object.keys(json.form ?? {}).join(', ')}`
      );
    } catch (e: any) {
      logResult(`Image FormData error: ${e?.message ?? String(e)}`);
    }
  };

  const sendFormDataPdf = async () => {
    try {
      logResult('Uploading PDF via FormData...');
      const fd = new FormData();
      fd.append('title', 'Test PDF document');
      fd.append('document', {
        uri: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        type: 'application/pdf',
        name: 'test_document.pdf',
      } as any);

      const res = await nitroFetch('https://httpbin.org/post', {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      logResult(
        `PDF upload OK!\n\nFiles uploaded: ${Object.keys(json.files ?? {}).join(', ') || 'none'}` +
          `\nText fields: ${Object.keys(json.form ?? {}).join(', ')}`
      );
    } catch (e: any) {
      logResult(`PDF FormData error: ${e?.message ?? String(e)}`);
    }
  };

  const buttons = [
    { title: 'JSON POST (Worklet)', onPress: sendPostWorklet, icon: '🚀' },
    { title: 'FormData (Fields)', onPress: sendFormDataText, icon: '📝' },
    { title: 'FormData (Image)', onPress: sendFormDataImage, icon: '🖼️' },
    { title: 'FormData (PDF)', onPress: sendFormDataPdf, icon: '📄' },
  ];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.grid}>
          {buttons.map((btn, i) => (
            <Pressable
              key={i}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed,
              ]}
              onPress={btn.onPress}
            >
              <Text style={styles.buttonIcon}>{btn.icon}</Text>
              <Text style={styles.buttonText}>{btn.title}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.consoleContainer}>
          <View style={styles.consoleHeader}>
            <Text style={styles.consoleTitle}>Output Console</Text>
          </View>
          <ScrollView style={styles.consoleScroll}>
            <Text style={styles.consoleText}>{result}</Text>
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.md,
    gap: theme.spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
  },
  button: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: theme.colors.card,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  buttonPressed: {
    opacity: 0.7,
    backgroundColor: '#F8F8F8',
  },
  buttonIcon: {
    fontSize: 24,
    marginBottom: theme.spacing.xs,
  },
  buttonText: {
    fontSize: 14,
    color: theme.colors.text,
    fontWeight: '600',
    textAlign: 'center',
  },
  consoleContainer: {
    backgroundColor: '#1E1E1E',
    borderRadius: theme.borderRadius.md,
    overflow: 'hidden',
    height: 350,
    marginTop: theme.spacing.sm,
  },
  consoleHeader: {
    backgroundColor: '#323232',
    padding: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#000',
  },
  consoleTitle: {
    color: '#AAABAD',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  consoleScroll: {
    padding: theme.spacing.md,
  },
  consoleText: {
    color: '#D4D4D4',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 18,
  },
});
