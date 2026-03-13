import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { fetch, TextDecoder } from 'react-native-nitro-fetch';
import { theme } from '../theme';

export function StreamScreen() {
    const [chunks, setChunks] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const startStream = async () => {
        setLoading(true);
        setError(null);
        setChunks([]);

        try {
            // httpbin provides a stream endpoint where we stream N lines
            const response = await fetch('https://httpbin.org/stream/10');

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error("No reader available - this browser/environment may not support streams!");
            }

            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    setChunks((prev) => [...prev, '\n[Stream finished]']);
                    break;
                }

                const chunk = decoder.decode(value as ArrayBuffer, { stream: true });
                setChunks((prev) => [...prev, chunk]);
            }
        } catch (e: any) {
            setError(e.message || String(e));
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={styles.container}>
            <View style={styles.actions}>
                <Pressable
                    style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                    onPress={startStream}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color={theme.colors.card} />
                    ) : (
                        <Text style={styles.buttonText}>Start HTTP Stream</Text>
                    )}
                </Pressable>
            </View>

            {error ? (
                <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>Error: {error}</Text>
                </View>
            ) : null}

            <ScrollView style={styles.logContainer} contentContainerStyle={styles.logContent}>
                {chunks.map((chunk, idx) => (
                    <Text key={idx} style={styles.logText}>
                        {chunk}
                    </Text>
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background,
    },
    actions: {
        padding: theme.spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
    },
    button: {
        backgroundColor: theme.colors.primary,
        padding: theme.spacing.md,
        borderRadius: theme.borderRadius.md,
        alignItems: 'center',
    },
    buttonPressed: {
        opacity: 0.8,
    },
    buttonText: {
        color: theme.colors.card,
        fontWeight: '600',
        fontSize: 16,
    },
    errorContainer: {
        padding: theme.spacing.md,
        backgroundColor: '#ffebee',
        borderBottomWidth: 1,
        borderBottomColor: '#ef9a9a',
    },
    errorText: {
        color: '#c62828',
        fontSize: 14,
    },
    logContainer: {
        flex: 1,
        backgroundColor: theme.colors.card,
        margin: theme.spacing.md,
        borderRadius: theme.borderRadius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    logContent: {
        padding: theme.spacing.md,
    },
    logText: {
        fontFamily: 'Courier',
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginBottom: 4,
    },
});
