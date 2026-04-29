import React from 'react';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

export default function HomepageHero(): React.JSX.Element {
  return (
    <header className={styles.hero}>
      <div className={styles.container}>
        <div className={styles.content}>
          <h1 className={styles.title}>
            Blazing-fast networking
            <br />
            for React Native
          </h1>
          <p className={styles.tagline}>
            Drop-in <code>fetch()</code> replacement powered by Cronet &amp;
            URLSession. HTTP/3, QUIC, prefetching, WebSockets, and worklet
            mapping.
          </p>
          <div className={styles.install}>
            <code>
              npm i react-native-nitro-fetch react-native-nitro-modules
            </code>
          </div>
          <div className={styles.buttons}>
            <Link
              className="button button--primary button--lg"
              to="/docs/getting-started"
            >
              Get Started
            </Link>
            <Link
              className="button button--secondary button--outline button--lg"
              href="https://github.com/margelo/react-native-nitro-fetch"
            >
              GitHub
            </Link>
          </div>
        </div>
        <div className={styles.logoContainer}>
          <img
            src="/img/logo.png"
            alt="Nitro Fetch"
            className={styles.logo}
          />
        </div>
      </div>
    </header>
  );
}
