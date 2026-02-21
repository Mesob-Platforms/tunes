import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mesob.tunes',
  appName: 'Tunes by Mesob',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#000000',
  },
  plugins: {
    SplashScreen: {
      backgroundColor: '#000000',
      launchAutoHide: true,
      launchShowDuration: 0,
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
