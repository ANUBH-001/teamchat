// Native modules that have no JS implementation under Jest.
// Official in-memory mock (real read/write semantics, used by outbox/prefs/stars tests).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
