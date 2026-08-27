import { withMainApplication, type ConfigPlugin } from '@expo/config-plugins';

const withAndroidAutoPrefetch: ConfigPlugin = (config) => {
  return withMainApplication(config, (mod) => {
    let content = mod.modResults.contents;
    const isJava = mod.modResults.language === 'java';

    // Add import for AutoPrefetcher
    if (
      !content.includes('import com.margelo.nitro.nitrofetch.AutoPrefetcher')
    ) {
      content = content.replace(
        /^(\s*package\s+[^\r\n]+)$/m,
        `$1\n\nimport com.margelo.nitro.nitrofetch.AutoPrefetcher${
          isJava ? ';' : ''
        }`
      );
    }

    // Add prefetchOnStart call in onCreate before loadReactNative
    if (!/AutoPrefetcher(?:\.INSTANCE)?\.prefetchOnStart/.test(content)) {
      content = content.replace(
        /super\.onCreate\(\);?/,
        isJava
          ? 'super.onCreate();\n    try { AutoPrefetcher.INSTANCE.prefetchOnStart(this); } catch (Throwable ignored) {}'
          : 'super.onCreate()\n    try { AutoPrefetcher.prefetchOnStart(this) } catch (_: Throwable) {}'
      );
    }

    mod.modResults.contents = content;
    return mod;
  });
};

export default withAndroidAutoPrefetch;
