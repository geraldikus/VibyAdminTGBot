import { describe, expect, it } from 'vitest';
import { fromSerial, normDate, normDateTime } from '../src/sheets/dates.js';

describe('Google Sheets date import', () => {
  it('converts Sheets serial numbers', () => {
    // 45940 days after 1899-12-30 = 2025-10-10; .5 = noon
    expect(fromSerial(45940, false)).toBe('2025-10-10');
    expect(fromSerial(45940.5, true)).toBe('2025-10-10 12:00:00');
  });

  it('accepts ISO and European formats regardless of the sheet locale', () => {
    expect(normDate('2026-10-13', 'x')).toBe('2026-10-13');
    expect(normDate('3.10.2026', 'x')).toBe('2026-10-03');
    expect(normDateTime('2026-10-13 15:25', 'x')).toBe('2026-10-13 15:25:00');
    expect(normDateTime('13.10.2026, 9:05:07', 'x')).toBe('2026-10-13 09:05:07');
    expect(normDate('', 'x')).toBe('');
  });

  it('reports values it cannot parse instead of guessing', () => {
    const warnings: string[] = [];
    expect(normDate('Oct 13', 'lesson 1', (w) => warnings.push(w))).toBe('Oct 13');
    expect(warnings).toEqual(['lesson 1: unrecognised date "Oct 13" kept as is']);
  });
});
