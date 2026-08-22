/**
 * ホームのタイムライン見出し（R05 / WBS 1.9）の日付表記。
 *
 * 画面全体のテストは T1 の担当。ここは純関数の境界だけを見る。
 * **7 日目が相対表記に入ること**が要点 — 記録フォームの「1週間前」チップ
 * （DateField の quickPicks）はちょうど 7 日前を作るので、ここが 7 未満だと
 * 押した言葉（1週間前）と見出し（8月3日）が対応しなくなる。
 */
import { formatDayLabel } from '../index';

// 画面本体を読み込むので、ネイティブ依存だけ黙らせる
jest.mock('expo-router', () => ({ useRouter: () => ({}), useFocusEffect: () => undefined }));

const NOW = new Date(2026, 7, 10, 9, 30); // 2026-08-10 09:30 ローカル

function daysBefore(days: number): string {
  const date = new Date(NOW);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

describe('formatDayLabel', () => {
  it('今日ときのうは言葉で出す', () => {
    expect(formatDayLabel(daysBefore(0), NOW)).toBe('今日');
    expect(formatDayLabel(daysBefore(1), NOW)).toBe('きのう');
  });

  it('2〜6 日前は「◯日前」', () => {
    expect(formatDayLabel(daysBefore(2), NOW)).toBe('2日前');
    expect(formatDayLabel(daysBefore(6), NOW)).toBe('6日前');
  });

  it('ちょうど 7 日前も相対表記（「1週間前」チップと対応させる）', () => {
    expect(formatDayLabel(daysBefore(7), NOW)).toBe('7日前');
  });

  it('8 日以上前は月日で出す', () => {
    expect(formatDayLabel(daysBefore(8), NOW)).toBe('8月2日');
    expect(formatDayLabel('2026-05-12', NOW)).toBe('5月12日');
  });
});
