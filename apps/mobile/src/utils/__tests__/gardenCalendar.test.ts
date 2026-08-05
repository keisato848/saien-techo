import type { GardenTimelineEntry } from '../../services/types';
import { flattenGardenPhotos, groupGardenEntriesByDay } from '../gardenCalendar';
import { localDayKey } from '../monthMatrix';

function entry(overrides: Partial<GardenTimelineEntry> & { id: string }): GardenTimelineEntry {
  return {
    type: 'care_log',
    plantingId: 'planting-1',
    cropName: 'トマト',
    variety: null,
    kind: 'water',
    quantity: null,
    unit: null,
    loggedAt: new Date().toISOString(),
    note: null,
    photoUris: [],
    ...overrides,
  };
}

/** 端末ローカルで N 日前の 12:00 */
function daysAgoNoon(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(12, 0, 0, 0);
  return d;
}

describe('groupGardenEntriesByDay', () => {
  it('同じ日の記録をまとめる', () => {
    const day = daysAgoNoon(1);
    const map = groupGardenEntriesByDay([
      entry({ id: 'a', loggedAt: day.toISOString() }),
      entry({ id: 'b', loggedAt: day.toISOString() }),
      entry({ id: 'c', loggedAt: daysAgoNoon(2).toISOString() }),
    ]);

    expect(map.size).toBe(2);
    expect(map.get(localDayKey(day))?.entries).toHaveLength(2);
  });

  it('収穫があった日を hasHarvest で示す', () => {
    const day = daysAgoNoon(1);
    const map = groupGardenEntriesByDay([
      entry({ id: 'a', loggedAt: day.toISOString() }),
      entry({ id: 'b', type: 'harvest', kind: null, loggedAt: day.toISOString() }),
    ]);

    expect(map.get(localDayKey(day))?.hasHarvest).toBe(true);
  });

  it('作業だけの日は hasHarvest が false', () => {
    const day = daysAgoNoon(3);
    const map = groupGardenEntriesByDay([entry({ id: 'a', loggedAt: day.toISOString() })]);

    expect(map.get(localDayKey(day))?.hasHarvest).toBe(false);
  });

  it('作業と収穫の両方があった日は両方の印が立つ', () => {
    const day = daysAgoNoon(1);
    const map = groupGardenEntriesByDay([
      entry({ id: 'a', loggedAt: day.toISOString() }),
      entry({ id: 'b', type: 'harvest', kind: null, loggedAt: day.toISOString() }),
    ]);

    const summary = map.get(localDayKey(day));
    expect(summary?.hasCareLog).toBe(true);
    expect(summary?.hasHarvest).toBe(true);
  });

  it('収穫だけの日は作業の印が立たない', () => {
    const day = daysAgoNoon(4);
    const map = groupGardenEntriesByDay([
      entry({ id: 'a', type: 'harvest', kind: null, loggedAt: day.toISOString() }),
    ]);

    expect(map.get(localDayKey(day))?.hasCareLog).toBe(false);
  });

  it('端末のタイムゾーンで日を決める', () => {
    // 0:30 の記録。toISOString() の日付で束ねると前日のマスに入る
    const local = new Date();
    local.setHours(0, 30, 0, 0);
    const map = groupGardenEntriesByDay([entry({ id: 'a', loggedAt: local.toISOString() })]);

    expect([...map.keys()]).toEqual([localDayKey(local)]);
  });

  it('空配列なら空', () => {
    expect(groupGardenEntriesByDay([]).size).toBe(0);
  });
});

describe('flattenGardenPhotos', () => {
  it('1 件の記録の複数枚をすべて並べる', () => {
    const photos = flattenGardenPhotos([
      entry({ id: 'a', photoUris: ['/1.jpg', '/2.jpg', '/3.jpg'] }),
    ]);

    expect(photos.map((photo) => photo.uri)).toEqual(['/1.jpg', '/2.jpg', '/3.jpg']);
  });

  it('同じ記録の写真でも key が重複しない', () => {
    const photos = flattenGardenPhotos([entry({ id: 'a', photoUris: ['/1.jpg', '/2.jpg'] })]);
    expect(new Set(photos.map((photo) => photo.key)).size).toBe(2);
  });

  it('新しい順に並ぶ', () => {
    const photos = flattenGardenPhotos([
      entry({ id: 'old', loggedAt: daysAgoNoon(10).toISOString(), photoUris: ['/old.jpg'] }),
      entry({ id: 'new', loggedAt: daysAgoNoon(1).toISOString(), photoUris: ['/new.jpg'] }),
    ]);

    expect(photos.map((photo) => photo.uri)).toEqual(['/new.jpg', '/old.jpg']);
  });

  it('作業ログと収穫の写真が混ざり、種別が保たれる', () => {
    const photos = flattenGardenPhotos([
      entry({ id: 'a', loggedAt: daysAgoNoon(1).toISOString(), photoUris: ['/care.jpg'] }),
      entry({
        id: 'b',
        type: 'harvest',
        kind: null,
        loggedAt: daysAgoNoon(2).toISOString(),
        photoUris: ['/harvest.jpg'],
      }),
    ]);

    expect(photos.map((photo) => photo.type)).toEqual(['care_log', 'harvest']);
  });

  it('写真の無い記録は 1 枚も出さない', () => {
    expect(flattenGardenPhotos([entry({ id: 'a' })])).toEqual([]);
  });

  it('栽培への参照を保つ（写真から記録へ戻れる）', () => {
    const [photo] = flattenGardenPhotos([
      entry({ id: 'a', plantingId: 'p9', cropName: 'キュウリ', photoUris: ['/x.jpg'] }),
    ]);

    expect(photo.plantingId).toBe('p9');
    expect(photo.entryId).toBe('a');
    expect(photo.cropName).toBe('キュウリ');
  });
});
