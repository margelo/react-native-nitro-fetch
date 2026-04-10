import withAndroidPrewarm from './withAndroid'

const withNitroWebSockets: any = (config: any) => {
  config = withAndroidPrewarm(config)
  return config
}

export default withNitroWebSockets
