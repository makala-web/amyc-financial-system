import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.amyc.finance',
  appName: 'AMYC Financial Management',
  webDir: 'out',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: true,
      androidBiometric: {
        biometricAuth: false,
      },
    },
    Filesystem: {
      androidPermissions: true,
    },
  },
};

export default config;
