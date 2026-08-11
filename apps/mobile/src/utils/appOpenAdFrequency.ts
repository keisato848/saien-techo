/**
 * 起動広告を出してよいかの判定（§8.2 / WBS 3.7）
 *
 * 純ロジックにしているのは、ここが**出しすぎても出なさすぎても気づきにくい**から。
 * 実機で何日か回さないと体感できないので、境界はテストで固定する。
 *
 * 方針（docs/広告・収益化方針.md）: バナー常設はやらず、起動広告だけを控えめに出す。
 * 記録アプリは 1 日に何度も開くので、**開くたびに出すと確実に嫌われる**。
 */

/** 前回表示からこれだけ空くまで出さない */
export const APP_OPEN_MIN_INTERVAL_MINUTES = 60;

/** 1 日に出す上限 */
export const APP_OPEN_MAX_PER_DAY = 3;

/**
 * 初回起動からこれだけは出さない。
 * 入れた直後に広告が出ると「広告アプリ」の印象で消される。
 * まず使ってもらう。
 */
export const APP_OPEN_GRACE_HOURS = 24;

export interface AppOpenAdState {
  /** 初回起動時刻（ISO 8601）。未記録なら null */
  firstLaunchAt: string | null;
  /** 最後に起動広告を出した時刻（ISO 8601）。未表示なら null */
  lastShownAt: string | null;
  /** lastShownAt と同じ日に出した回数 */
  shownToday: number;
}

export interface AppOpenAdDecision {
  show: boolean;
  /** 出さない理由。ログと実機確認のために持つ */
  reason:
    | 'ok'
    | 'disabled'
    | 'within-grace'
    | 'too-soon'
    | 'daily-cap'
    | 'onboarding'
    | 'no-consent';
}

const MINUTE_MS = 60_000;

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export interface AppOpenAdContext {
  /** EXPO_PUBLIC_ADMOB_ENABLED。false なら常に出さない */
  enabled: boolean;
  /** UMP の同意が取れて広告を要求できるか */
  canRequestAds: boolean;
  /** オンボーディング中（地域未設定）は出さない */
  onboarding: boolean;
  state: AppOpenAdState;
}

/**
 * 起動広告を出すか。
 *
 * 順番に意味がある — 無効・同意なしを先に弾き、次に「そもそも新規利用者か」、
 * 最後に頻度を見る。理由を返すのは、実機で「出ない」ときに原因を切り分けるため。
 */
export function decideAppOpenAd(
  context: AppOpenAdContext,
  now: Date = new Date(),
): AppOpenAdDecision {
  if (!context.enabled) return { show: false, reason: 'disabled' };
  if (!context.canRequestAds) return { show: false, reason: 'no-consent' };
  if (context.onboarding) return { show: false, reason: 'onboarding' };

  const { firstLaunchAt, lastShownAt, shownToday } = context.state;

  // 初回起動から一定時間は出さない（入れた直後の離脱を避ける）
  if (firstLaunchAt) {
    const first = new Date(firstLaunchAt);
    if (!Number.isNaN(first.getTime())) {
      const elapsedHours = (now.getTime() - first.getTime()) / (60 * MINUTE_MS);
      if (elapsedHours < APP_OPEN_GRACE_HOURS) return { show: false, reason: 'within-grace' };
    }
  }

  if (lastShownAt) {
    const last = new Date(lastShownAt);
    if (!Number.isNaN(last.getTime())) {
      const elapsedMinutes = (now.getTime() - last.getTime()) / MINUTE_MS;
      if (elapsedMinutes < APP_OPEN_MIN_INTERVAL_MINUTES)
        return { show: false, reason: 'too-soon' };
      // 日が変わったら回数はリセット（shownToday は lastShownAt の日の回数）
      if (isSameLocalDay(last, now) && shownToday >= APP_OPEN_MAX_PER_DAY) {
        return { show: false, reason: 'daily-cap' };
      }
    }
  }

  return { show: true, reason: 'ok' };
}

/** 表示した後の状態。日をまたいだら数え直す */
export function recordAppOpenAdShown(
  state: AppOpenAdState,
  now: Date = new Date(),
): AppOpenAdState {
  const last = state.lastShownAt ? new Date(state.lastShownAt) : null;
  const sameDay = last && !Number.isNaN(last.getTime()) && isSameLocalDay(last, now);
  return {
    firstLaunchAt: state.firstLaunchAt,
    lastShownAt: now.toISOString(),
    shownToday: sameDay ? state.shownToday + 1 : 1,
  };
}
