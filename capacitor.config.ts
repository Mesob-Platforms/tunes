import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tunes.app',
  appName: 'Tunes',
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
      launchShowDuration: 1500,
      showSpinner: false,
    },
  },
};

export default config;
