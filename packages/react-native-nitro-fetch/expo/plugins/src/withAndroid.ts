import { withMainApplication } from '@expo/config-plugins';

const withAndroidAutoPrefetch = (config: any) => {
  return withMainApplication(config, (config) => {
    let content = config.modResults.contents;

    // Add import for AutoPrefetcher
    if (
      !content.includes('import com.margelo.nitro.nitrofetch.AutoPrefetcher')
    ) {
      content = content.replace(
        /import android.app.Application/g,
        `import android.app.Application
import com.margelo.nitro.nitrofetch.AutoPrefetcher`
      );
    }

    // Add prefetchOnStart call in onCreate before loadReactNative
    if (!content.includes('AutoPrefetcher.prefetchOnStart')) {
      content = content.replace(
        /super\.onCreate\(\)/,
        `super.onCreate()
    try { AutoPrefetcher.prefetchOnStart(this) } catch (_: Throwable) {}`
      );
    }

    config.modResults.contents = content;
    return config;
  });
};

export default withAndroidAutoPrefetch;
