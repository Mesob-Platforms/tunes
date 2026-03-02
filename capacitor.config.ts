import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mesob.tunes',
  appName: 'Tunes',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#000000',
    allowMixedContent: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      backgroundColor: '#021f45',
      launchAutoHide: true,
      launchShowDuration: 2000,
      launchFadeOutDuration: 400,
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false,
      style: 'DARK',          // white icons on dark app
      backgroundColor: '#000000',
    },
  },
};

export default config;
