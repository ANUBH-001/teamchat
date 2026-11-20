import { resolveVersion, BUNDLE_VERSION_CODE, BUNDLE_VERSION_NAME } from '../version';

describe('resolveVersion', () => {
  it('uses the installed APK version (an OTA on a 0.6.0 APK still reports 6)', () => {
    expect(resolveVersion('6', '0.6.0')).toEqual({ code: 6, name: '0.6.0' });
  });
  it('falls back to the bundle constants when the native value is missing or invalid', () => {
    expect(resolveVersion(null, null)).toEqual({ code: BUNDLE_VERSION_CODE, name: BUNDLE_VERSION_NAME });
    expect(resolveVersion('abc', undefined)).toEqual({ code: BUNDLE_VERSION_CODE, name: BUNDLE_VERSION_NAME });
  });
});
