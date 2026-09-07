/**
 * 「去年の今ごろ」（R27 / WBS 4.9）。
 *
 * 狙いは v1.6「春支度」の柱、**2 シーズン目の継続（G5）**。去年の自分が
 * 何をしていたかを見せて、翌シーズンも戻ってくる動機にする。
 * 紙の『菜園 2 年手帳』が見開きで去年と今年を並べていた体験のデジタル版。
 *
 * ## 新しいクエリを足さない
 *
 * 期間で絞った記録は `getTimeline({ from, to })` が作業ログ・収穫の両方から
 * 集め、写真まで解決して返す。成長記録（growth-compare.service）と同じ方針で、
 * ここは**並べ替えと文言づくりだけ**を持つ。
 *
 * ## 初年度をどう扱うか（この機能の一番の設計判断）
 *
 * インストールから 1 年未満の利用者が大多数で、その人たちの去年は**必ず空**。
 * 「まだ記録がありません」を毎日出すのは場所を取るだけで価値が無いので、
 * **既定は「何も描かない」**（`none`）。
 *
 * ただし何も出さないと、去年の記録が貯まる仕組みがあること自体が伝わらない。
 * そこで**今年のこの時期に記録がある人にだけ**「来年の今ごろ、ここに並びます」
 * を出す（`this_year`）。すでに記録している人へ「その記録は来年に効く」と
 * 返す作りで、記録していない人を急かす作りにはしない。
 * 件数のしきい値（`PROMISE_MIN_ENTRIES`）を置いたのも同じ理由 — 1 件しかない
 * 人に出しても約束が薄く、カードが常設の飾りになってしまう。
 */
import { CARE_KIND_LABEL } from './care-log.service';
import { getTimeline } from './garden-timeline.service';
import { localDayKey } from '../utils/monthMatrix';
import type { CareLogKind, GardenTimelineEntry } from './types';

/**
 * 「今ごろ」の幅（前後の日数）。
 *
 * 菜園の作業は週末に寄るので、±7 日だと去年の同じ週末を外すことがある。
 * ±14 日なら去年の週末が最低 4 回入る。広げすぎると「今ごろ」ではなくなるので
 * 要件（R27: 前後 1〜2 週間）の上限に置いた。
 */
export const LAST_YEAR_WINDOW_DAYS = 14;

/** 「来年の今ごろ」を出す最低件数。これ未満なら何も描かない */
export const PROMISE_MIN_ENTRIES = 3;

/** カードに並べる写真の最大枚数。ホームは既に縦に長いので 1 行に収める */
export const LAST_YEAR_MAX_PHOTOS = 6;

export interface LastYearPhoto {
  /** 表示に使う絶対 URI（photo-path で解決済み） */
  uri: string;
  /** タップ先を決めるための出所 */
  entryId: string;
  plantingId: string;
  type: 'care_log' | 'harvest';
}

/** カードの見出し文になる 1 件 */
export interface LastYearHighlight {
  entryId: string;
  plantingId: string;
  type: 'care_log' | 'harvest';
  kind: CareLogKind | null;
  cropName: string;
  /** 端末ローカルの 'YYYY-MM-DD' */
  date: string;
}

export type LastYearCard =
  | {
      state: 'last_year';
      highlight: LastYearHighlight;
      photos: LastYearPhoto[];
      /** 窓に入った記録の総数（見出しの 1 件を含む） */
      entryCount: number;
    }
  | { state: 'this_year'; entryCount: number }
  | { state: 'none' };

export interface DateWindow {
  /** ISO 8601（getTimeline にそのまま渡す） */
  from: string;
  to: string;
  /** 窓の中心。「去年の 9 月 7 日」の 9 月 7 日 */
  anchor: Date;
}

/**
 * 基準日から `yearsAgo` 年前の同じ月日を中心にした窓を作る。
 *
 * **-365 日ではなく月日で合わせる。** 菜園は季節の営みなので、
 * 「去年の同じ日付」に意味がある。閏年を挟むと -365 日は 1 日ずれ、
 * 4 年で 1 日ずつ積み上がっていく。
 *
 * 2 月 29 日だけは 1 年前に同じ月日が無い。`new Date(y-1, 1, 29)` は
 * 3 月 1 日へ繰り上がってしまうので、2 月 28 日へ寄せる（繰り上げると
 * 「去年の 3 月 1 日」と表示されて、季節がひと月ぶんずれて見える）。
 */
export function seasonWindow(
  now: Date,
  yearsAgo: number,
  windowDays: number = LAST_YEAR_WINDOW_DAYS,
): DateWindow {
  const year = now.getFullYear() - yearsAgo;
  const month = now.getMonth();
  const day = now.getDate();

  const anchor = new Date(year, month, day);
  // 月が動いていたら繰り上がった（2/29 → 3/1）。その月の末日へ戻す
  if (anchor.getMonth() !== month) anchor.setDate(0);

  const from = new Date(anchor);
  from.setDate(from.getDate() - windowDays);
  from.setHours(0, 0, 0, 0);

  const to = new Date(anchor);
  to.setDate(to.getDate() + windowDays);
  to.setHours(23, 59, 59, 999);

  return { from: from.toISOString(), to: to.toISOString(), anchor };
}

/** 窓の中心からの隔たり（日）。近いものを優先するために使う */
function distanceFromAnchor(entry: GardenTimelineEntry, anchor: Date): number {
  const logged = new Date(entry.loggedAt);
  logged.setHours(0, 0, 0, 0);
  const center = new Date(anchor);
  center.setHours(0, 0, 0, 0);
  return Math.abs(Math.round((logged.getTime() - center.getTime()) / 86_400_000));
}

/**
 * 見出しにする 1 件を選ぶ。
 *
 * 1. **写真があるもの**を最優先 — カードは写真を主役にすると決めているので、
 *    見出しと 1 枚目の写真が同じ記録を指していないと文と絵が食い違う
 * 2. 次に**窓の中心に近いもの** — 「今ごろ」が売りなので日付の近さが効く
 * 3. 同着なら収穫を先に — まとめて記録した日は収穫のほうが見たい情報
 *    （garden-timeline.service の並べ替えと同じ判断）
 */
export function rankEntries(entries: GardenTimelineEntry[], anchor: Date): GardenTimelineEntry[] {
  return [...entries].sort((a, b) => {
    const photos = Number(b.photoUris.length > 0) - Number(a.photoUris.length > 0);
    if (photos !== 0) return photos;
    const distance = distanceFromAnchor(a, anchor) - distanceFromAnchor(b, anchor);
    if (distance !== 0) return distance;
    if (a.type !== b.type) return a.type === 'harvest' ? -1 : 1;
    return b.loggedAt.localeCompare(a.loggedAt);
  });
}

/**
 * 「去年の 9 月 7 日、キュウリを収穫していました」。
 *
 * 断定せず、しかし出来事として言い切る。専門用語は使わない。
 * `other`（その他）だけは「その他をしていました」が日本語にならないので
 * 「記録をつけていました」に逃がす。
 */
export function describeLastYear(highlight: LastYearHighlight): string {
  const [, month, day] = highlight.date.split('-').map(Number);
  const when = `去年の${month}月${day}日`;

  if (highlight.type === 'harvest') return `${when}、${highlight.cropName}を収穫していました`;
  if (!highlight.kind || highlight.kind === 'other') {
    return `${when}、${highlight.cropName}の記録をつけていました`;
  }
  return `${when}、${highlight.cropName}の${CARE_KIND_LABEL[highlight.kind]}をしていました`;
}

/**
 * カードに出すものを決める。呼び出し側（画面）は state で描き分けるだけ。
 *
 * 去年が空のときだけ今年を引く。2 シーズン目以降の人は 1 クエリで済む。
 */
export async function getLastYearCard(now: Date = new Date()): Promise<LastYearCard> {
  const lastYear = seasonWindow(now, 1);
  const entries = await getTimeline({ from: lastYear.from, to: lastYear.to });

  if (entries.length === 0) {
    const thisYear = seasonWindow(now, 0);
    const current = await getTimeline({ from: thisYear.from, to: thisYear.to });
    if (current.length < PROMISE_MIN_ENTRIES) return { state: 'none' };
    return { state: 'this_year', entryCount: current.length };
  }

  const ranked = rankEntries(entries, lastYear.anchor);
  const top = ranked[0];

  // 見出しの記録の写真から先に詰める。文と 1 枚目が一致していないと
  // 「これは何の写真か」が読めない
  const photos: LastYearPhoto[] = [];
  for (const entry of ranked) {
    for (const uri of entry.photoUris) {
      if (photos.length >= LAST_YEAR_MAX_PHOTOS) break;
      photos.push({
        uri,
        entryId: entry.id,
        plantingId: entry.plantingId,
        type: entry.type,
      });
    }
    if (photos.length >= LAST_YEAR_MAX_PHOTOS) break;
  }

  return {
    state: 'last_year',
    highlight: {
      entryId: top.id,
      plantingId: top.plantingId,
      type: top.type,
      kind: top.kind,
      cropName: top.cropName,
      date: localDayKey(new Date(top.loggedAt)),
    },
    photos,
    entryCount: entries.length,
  };
}

/** 記録の詳細への遷移先。ホームのタイムラインと同じ規則 */
export function recordPath(entry: {
  plantingId: string;
  entryId: string;
  type: 'care_log' | 'harvest';
}): string {
  return entry.type === 'harvest'
    ? `/plantings/${entry.plantingId}/harvests/${entry.entryId}`
    : `/plantings/${entry.plantingId}/care-logs/${entry.entryId}`;
}
