// Device test 2026-11-20: a message the server rejected showed red "✓✓", which reads as delivered.
// Failed must look failed and say how to retry.
import React from 'react';
import { render } from '@testing-library/react-native';
import Tick from '../components/Tick';

test('failed shows a warning + retry hint, never ticks', () => {
  const r = render(<Tick status="failed" color="#fff" onBubble />);
  expect(r.queryByText('✓✓')).toBeNull();
  expect(r.getByText(/Nahi gaya/)).toBeTruthy();
  expect(r.getByText(/retry/i)).toBeTruthy();
});

test('pending / sent / delivered glyphs unchanged', () => {
  expect(render(<Tick status="pending" color="#fff" />).getByText('◷')).toBeTruthy();
  expect(render(<Tick status="sent" color="#fff" />).getByText('✓')).toBeTruthy();
  expect(render(<Tick status="delivered" color="#fff" />).getByText('✓✓')).toBeTruthy();
  expect(render(<Tick status="read" color="#fff" />).getByText('✓✓')).toBeTruthy();
});
