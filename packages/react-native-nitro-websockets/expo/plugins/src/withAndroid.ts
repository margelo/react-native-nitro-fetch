import { withMainApplication } from '@expo/config-plugins'

const withAndroidPrewarm = (config: any) => {
  return withMainApplication(config, (config) => {
    let content = config.modResults.contents

    // Add import for NitroWebSocketAutoPrewarmer
    if (
      !content.includes(
        'import com.margelo.nitro.nitrofetchwebsockets.NitroWebSocketAutoPrewarmer'
      )
    ) {
      content = content.replace(
        /import android.app.Application/g,
        `import android.app.Application
import com.margelo.nitro.nitrofetchwebsockets.NitroWebSocketAutoPrewarmer`
      )
    }

    // Add prewarmOnStart call in onCreate before loadReactNative
    if (!content.includes('NitroWebSocketAutoPrewarmer.prewarmOnStart')) {
      content = content.replace(
        /super\.onCreate\(\)/,
        `super.onCreate()
    NitroWebSocketAutoPrewarmer.prewarmOnStart(this)`
      )
    }

    config.modResults.contents = content
    return config
  })
}

export default withAndroidPrewarm
