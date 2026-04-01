import React from 'react';
import styles from './styles.module.css';

interface Feature {
  title: string;
  description: string;
  icon: string;
}

const features: Feature[] = [
  {
    title: 'HTTP/3 + QUIC',
    icon: '\u26A1',
    description:
      'Powered by Cronet on Android and URLSession on iOS. Supports HTTP/1, HTTP/2, HTTP/3 over QUIC, Brotli compression, and disk caching.',
  },
  {
    title: 'Prefetching',
    icon: '\u23F1\uFE0F',
    description:
      'Start requests before your screen mounts. Auto-prefetch on app startup yields ~220ms faster TTI on mid-range devices.',
  },
  {
    title: 'WebSockets',
    icon: '\uD83D\uDD0C',
    description:
      'High-performance WebSockets via libwebsockets + mbedTLS. Browser-like API with prewarm support for cold-start connections.',
  },
  {
    title: 'Worklet Mapping',
    icon: '\uD83E\uDDF5',
    description:
      'Parse and transform response data off the JS thread using react-native-worklets. Keep your UI buttery smooth.',
  },
  {
    title: 'Streaming',
    icon: '\uD83C\uDF0A',
    description:
      'ReadableStream body support with TextDecoder for incremental UTF-8 chunk processing. Stream large responses efficiently.',
  },
  {
    title: 'Drop-in Replacement',
    icon: '\uD83D\uDD04',
    description:
      'Same fetch() API you already know. Swap one import and get native performance — no code changes needed.',
  },
];

function FeatureCard({ title, description, icon }: Feature): React.JSX.Element {
  return (
    <div className={styles.card}>
      <div className={styles.icon}>{icon}</div>
      <h3 className={styles.cardTitle}>{title}</h3>
      <p className={styles.cardDescription}>{description}</p>
    </div>
  );
}

export default function HomepageFeatures(): React.JSX.Element {
  return (
    <section className={styles.features}>
      <div className={styles.container}>
        <h2 className={styles.sectionTitle}>Why Nitro Fetch?</h2>
        <div className={styles.grid}>
          {features.map((feature) => (
            <FeatureCard key={feature.title} {...feature} />
          ))}
        </div>
      </div>
    </section>
  );
}
