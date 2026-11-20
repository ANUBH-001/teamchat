// Owner request: an admin can be set to not show the "Admin" label in chats (UI only; the role stays 'boss').
import React from 'react';
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { showsAdminLabel } from '../adminLabel';
import { PeopleSheet } from '../components/ComposerSheets';

test('showsAdminLabel: only admins, unless the server flag says hide', () => {
  expect(showsAdminLabel({ role: 'boss', showAdminLabel: true })).toBe(true);
  expect(showsAdminLabel({ role: 'boss' })).toBe(true); // old server without the flag
  expect(showsAdminLabel({ role: 'boss', showAdminLabel: false })).toBe(false);
  expect(showsAdminLabel({ role: 'member', showAdminLabel: true })).toBe(false);
  expect(showsAdminLabel(null)).toBe(false);
});

test('people picker: ADMIN badge hidden for the flagged admin, kept for the other', () => {
  const people = [
    { id: 1, name: 'Prashant Sharma', phone: '9000000001', role: 'boss', showAdminLabel: true, inChat: true },
    { id: 2, name: 'Anubhav', phone: '9000000002', role: 'boss', showAdminLabel: false, inChat: true },
    { id: 3, name: 'Uzair', phone: '9000000003', role: 'member', showAdminLabel: false, inChat: true },
  ];
  const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
  const r = render(
    <SafeAreaProvider initialMetrics={metrics}>
      <PeopleSheet visible onClose={() => {}} title="Pick" people={people} onPick={() => {}} />
    </SafeAreaProvider>);
  expect(r.getByText('Prashant Sharma')).toBeTruthy();
  expect(r.getByText('Anubhav')).toBeTruthy();
  expect(r.getAllByText('ADMIN')).toHaveLength(1); // Prashant only
});
