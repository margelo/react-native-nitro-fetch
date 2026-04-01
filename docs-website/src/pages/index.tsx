import React from 'react';
import Layout from '@theme/Layout';
import HomepageHero from '../components/HomepageHero';
import HomepageFeatures from '../components/HomepageFeatures';
import styles from './index.module.css';

function QuickExample(): React.JSX.Element {
  return (
    <section className={styles.quickExample}>
      <div className={styles.container}>
        <h2 className={styles.sectionTitle}>One-line swap</h2>
        <p className={styles.subtitle}>
          Replace your import and get native performance instantly.
        </p>
        <div className={styles.codeComparison}>
          <div className={styles.codeBlock}>
            <div className={styles.codeLabel}>Before</div>
            <pre className={styles.code}>
              <code>{`// Built-in fetch (JS polyfill)
const res = await fetch('https://api.example.com/data')
const json = await res.json()`}</code>
            </pre>
          </div>
          <div className={styles.codeBlock}>
            <div className={`${styles.codeLabel} ${styles.codeLabelAfter}`}>
              After
            </div>
            <pre className={styles.code}>
              <code>{`import { fetch } from 'react-native-nitro-fetch'

const res = await fetch('https://api.example.com/data')
const json = await res.json()`}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home(): React.JSX.Element {
  return (
    <Layout
      title="Blazing-fast networking for React Native"
      description="Drop-in fetch() replacement powered by Cronet & URLSession. HTTP/3, QUIC, prefetching, WebSockets, and worklet mapping."
    >
      <HomepageHero />
      <main>
        <HomepageFeatures />
        <QuickExample />
      </main>
    </Layout>
  );
}
