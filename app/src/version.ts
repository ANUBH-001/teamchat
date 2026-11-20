// The version reported to the server (X-App-Version, update banner) must be the INSTALLED APK's version, not the JS
// bundle's: an OTA update ships this file to older APKs too. So read the native versionCode/versionName (expo-application;
// its native module is already in every APK since 0.6.0) and fall back to the bundle constants only if it is missing.
import * as Application from 'expo-application';

// Keep in sync with app.json (expo.version and expo.android.versionCode) for the APK being built.
export const BUNDLE_VERSION_CODE = 7;
export const BUNDLE_VERSION_NAME = '0.7.0';

export function resolveVersion(nativeCode: string | null | undefined, nativeName: string | null | undefined) {
  const code = Number(nativeCode);
  return {
    code: Number.isInteger(code) && code > 0 ? code : BUNDLE_VERSION_CODE,
    name: nativeName || BUNDLE_VERSION_NAME,
  };
}

const resolved = resolveVersion(Application.nativeBuildVersion, Application.nativeApplicationVersion);
export const VERSION_CODE = resolved.code;
export const VERSION_NAME = resolved.name;
