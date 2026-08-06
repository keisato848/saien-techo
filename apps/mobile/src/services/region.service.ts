/**
 * 地域帯の設定 — §9 / WBS 3.6
 *
 * 栽培暦（crop_calendars）は寒冷地・中間地・暖地の 3 区分で持つ（R08/R09）。
 * どの区分で引くかをここで決める。初回起動の聞き取り（オンボーディング）で
 * 保存し、設定からいつでも変えられる。
 *
 * 県単位にしないのは、栽培暦の元データが 3 区分でしか意味を持たないため。
 * 細かく聞くほど正確に見えるが、答えの粒度が変わらないなら質問だけ重くなる。
 */
import { getAppMeta, setAppMeta } from './app-meta.service';

export const REGIONS = ['cold', 'temperate', 'warm'] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LABEL: Record<Region, string> = {
  cold: '寒冷地',
  temperate: '中間地',
  warm: '暖地',
};

/** 聞き取りで迷わないための目安。行政区分ではなく気候の区分 */
export const REGION_DESCRIPTION: Record<Region, string> = {
  cold: '北海道・東北・標高の高い地域',
  temperate: '関東〜近畿の平野部など',
  warm: '四国・九州・沖縄など',
};

/** 未設定のときに使う区分。日本の人口の多くが属する中間地に倒す */
export const DEFAULT_REGION: Region = 'temperate';

const REGION_KEY = 'garden_region';

function isRegion(value: string | null): value is Region {
  return value != null && (REGIONS as readonly string[]).includes(value);
}

/** 保存済みの地域帯。未設定（= 聞き取りがまだ）なら null */
export async function getRegion(): Promise<Region | null> {
  const stored = await getAppMeta(REGION_KEY);
  return isRegion(stored) ? stored : null;
}

/** 栽培暦を引くときはこちら。未設定なら中間地として扱う */
export async function getRegionOrDefault(): Promise<Region> {
  return (await getRegion()) ?? DEFAULT_REGION;
}

export async function setRegion(region: Region): Promise<void> {
  await setAppMeta(REGION_KEY, region);
}
