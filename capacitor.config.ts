import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.uniclass.app',
  appName: 'UniClass',
  webDir: 'dist',
  android: {
    // Serve the bundled application over a secure origin so the existing
    // camera-based QR flow can use browser media APIs inside the WebView.
    allowMixedContent: false,
  },
};

export default config;
