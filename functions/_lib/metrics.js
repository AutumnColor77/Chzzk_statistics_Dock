import { getEnvValue, timingSafeEqual, updateSession } from './security.js';

export const CHANNEL_ID_PATTERN = /^[a-f0-9]{10,64}$/i;

const DAY_KEY_PREFIX = 'metrics:day:';
const SEEN_KEY = 'metrics:seen';
const VISIT_KEY_PREFIX = 'metrics:v:';
const DAU_KEY_PREFIX = 'metrics:d:';
const SEEN_HASH_PREFIX = 'metrics:s:';
const UNIQ_KEY_PREFIX = 'metrics:uniq:';
const DAY_TTL_SECONDS = 90 * 24 * 60 * 60; // 90일
const HISTORY_DAYS = 30;
const VISIT_BUCKET_MS = 5 * 60 * 1000; // 5분 버킷 — isolate 간 RMW 충돌 구간을 좁힘
const KV_READ_CHUNK = 40;
const CHZZK_USERS_ME = 'https://openapi.chzzk.naver.com/open/v1/users/me';

/** isolate 로컬 방문 카운터. 같은 버킷 키에 대해 단조성(put-if-greater)을 보장. */
const visitCounters = new Map();
const dauSeenInIsolate = new Map();

let isolateId = '';

function getIsolateId() {
  if (!isolateId) {
    isolateId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return isolateId;
}

function getMetricsKv(env) {
  return env.LIVE_STATUS_CACHE || env.SESSION_STORE || null;
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** KST 달력 날짜 YYYY-MM-DD */
export function kstDateString(ms = Date.now()) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

export function listKstDates(days = HISTORY_DAYS) {
  const today = kstDateString();
  const [year, month, day] = today.split('-').map(Number);
  const dates = [];
  for (let i = 0; i < days; i++) {
    const dt = new Date(Date.UTC(year, month - 1, day - i));
    const yyyy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  return dates;
}

export function extractChannelId(payload) {
  const id = payload?.content?.channelId;
  if (typeof id !== 'string' || !CHANNEL_ID_PATTERN.test(id)) return null;
  return id.toLowerCase();
}

async function hashChannelId(channelId) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(channelId.toLowerCase())
  );
  return toHex(buf).slice(0, 32);
}

export async function isAdminChannelId(channelId, env) {
  const raw = (env.ADMIN_CHANNEL_ID || '').trim().toLowerCase();
  const id = typeof channelId === 'string' && CHANNEL_ID_PATTERN.test(channelId)
    ? channelId.toLowerCase()
    : '';
  if (!raw || !id) {
    await timingSafeEqual(id || '0', '1');
    return false;
  }
  for (const allowed of raw.split(/\s+/).filter(Boolean)) {
    if (await timingSafeEqual(allowed, id)) return true;
  }
  return false;
}

export function isAdminConfigured(env) {
  const hasChannel = (env.ADMIN_CHANNEL_ID || '').trim().length > 0;
  const hasSecret = Boolean(getEnvValue(env, 'ADMIN_SECRET'));
  return hasChannel && hasSecret;
}

/**
 * 세션에 저장된 channelId를 쓰거나, 없으면 치지직 users/me로 확인 후 세션에 저장합니다.
 */
export async function resolveSessionChannelId(env, session) {
  const cached = session?.data?.channelId;
  if (typeof cached === 'string' && CHANNEL_ID_PATTERN.test(cached)) {
    return cached.toLowerCase();
  }

  const accessToken = session?.data?.accessToken;
  if (!accessToken) return null;

  let payload;
  try {
    const upstream = await fetch(CHZZK_USERS_ME, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });
    payload = await upstream.json();
    if (!upstream.ok) return null;
  } catch (_e) {
    return null;
  }

  const channelId = extractChannelId(payload);
  if (!channelId) return null;

  if (session.sessionId) {
    await updateSession(env, session.sessionId, { channelId });
  }
  return channelId;
}

function emptyDay(date) {
  return {
    date,
    dau: 0,
    visits: 0,
    newUsers: 0,
    returningUsers: 0,
    hashes: {}
  };
}

function summarizeDay(date, raw) {
  return {
    date,
    dau: Number(raw?.dau) || 0,
    visits: Number(raw?.visits) || 0,
    newUsers: Number(raw?.newUsers) || 0,
    returningUsers: Number(raw?.returningUsers) || 0
  };
}

function visitShardKey(date) {
  const bucket = Math.floor(Date.now() / VISIT_BUCKET_MS);
  return `${VISIT_KEY_PREFIX}${date}:${bucket}:${getIsolateId()}`;
}

function writeAnalyticsEngine(env, date, hash) {
  const ae = env.METRICS || env.ANALYTICS;
  if (!ae || typeof ae.writeDataPoint !== 'function') return;
  try {
    ae.writeDataPoint({
      blobs: [date, hash],
      doubles: [1],
      indexes: [date]
    });
  } catch (_e) {
    // Analytics Engine 미바인딩·한도 초과는 지표 경로를 막지 않음
  }
}

async function flushVisitShard(kv, key, count) {
  const existing = Number((await kv.get(key)) || '0');
  if (count <= existing) return;
  await kv.put(key, String(count), { expirationTtl: DAY_TTL_SECONDS });
}

async function flushDauHash(kv, date, hash) {
  const seenKey = `${SEEN_HASH_PREFIX}${hash}`;
  let firstSeen = await kv.get(seenKey);
  if (!firstSeen) {
    firstSeen = date;
    const uniqKey = `${UNIQ_KEY_PREFIX}${getIsolateId()}`;
    const prevUniq = Number((await kv.get(uniqKey)) || '0');
    await Promise.all([
      kv.put(seenKey, date),
      kv.put(uniqKey, String(prevUniq + 1))
    ]);
  }

  const dauKey = `${DAU_KEY_PREFIX}${date}:${getIsolateId()}`;
  const prev = (await kv.get(dauKey, { type: 'json' })) || {};
  const hashes = prev.hashes && typeof prev.hashes === 'object' ? { ...prev.hashes } : {};
  hashes[hash] = firstSeen;
  await kv.put(dauKey, JSON.stringify({ hashes }), { expirationTtl: DAY_TTL_SECONDS });
}

/**
 * 인증된 독 사용자를 오늘(KST) 지표에 반영합니다.
 * 채널 ID는 SHA-256 해시로만 저장합니다.
 * 호출부는 반드시 context.waitUntil() 또는 scheduleDailyActiveUser()로 응답 경로 밖에서 실행하세요.
 */
export async function recordDailyActiveUser(env, channelId) {
  const kv = getMetricsKv(env);
  if (!kv || typeof channelId !== 'string' || !CHANNEL_ID_PATTERN.test(channelId)) return;

  const hash = await hashChannelId(channelId);
  const date = kstDateString();
  const visitKey = visitShardKey(date);
  const nextVisits = (visitCounters.get(visitKey) || 0) + 1;
  visitCounters.set(visitKey, nextVisits);

  const dauKey = `${date}:${hash}`;
  const firstInIsolate = !dauSeenInIsolate.has(dauKey);
  if (firstInIsolate) dauSeenInIsolate.set(dauKey, 1);

  writeAnalyticsEngine(env, date, hash);

  await flushVisitShard(kv, visitKey, nextVisits);
  if (firstInIsolate) {
    await flushDauHash(kv, date, hash);
  }
}

/**
 * 지표 기록을 응답 전송 이후 백그라운드로 넘깁니다.
 * context.waitUntil 을 분해하지 않습니다 (Illegal invocation 방지).
 */
export function scheduleDailyActiveUser(context, env, channelId) {
  const task = recordDailyActiveUser(env, channelId).catch(() => {});
  if (context && typeof context.waitUntil === 'function') {
    context.waitUntil(task);
    return;
  }
  return task;
}

async function listKeyNames(kv, prefix) {
  const names = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    for (const key of page.keys) names.push(key.name);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return names;
}

async function getMany(kv, keys, type) {
  const rows = [];
  for (let i = 0; i < keys.length; i += KV_READ_CHUNK) {
    const chunk = keys.slice(i, i + KV_READ_CHUNK);
    const part = await Promise.all(
      chunk.map((key) => (type ? kv.get(key, { type }) : kv.get(key)))
    );
    rows.push(...part);
  }
  return rows;
}

function mergeDayFromShards(date, oldDay, visitValues, dauRows) {
  const hasShards = visitValues.length > 0 || dauRows.length > 0;
  const hashes = {};

  if (!hasShards && oldDay && typeof oldDay === 'object') {
    return {
      date,
      dau: Number(oldDay.dau) || 0,
      visits: Number(oldDay.visits) || 0,
      newUsers: Number(oldDay.newUsers) || 0,
      returningUsers: Number(oldDay.returningUsers) || 0
    };
  }

  if (oldDay?.hashes && typeof oldDay.hashes === 'object') {
    for (const [hash, firstSeen] of Object.entries(oldDay.hashes)) {
      hashes[hash] = firstSeen === 1 ? date : firstSeen;
    }
  }

  let visits = 0;
  for (const value of visitValues) visits += Number(value) || 0;
  if (visits === 0 && oldDay) visits = Number(oldDay.visits) || 0;

  for (const row of dauRows) {
    if (!row?.hashes || typeof row.hashes !== 'object') continue;
    for (const [hash, firstSeen] of Object.entries(row.hashes)) {
      hashes[hash] = firstSeen;
    }
  }

  const dau = Object.keys(hashes).length;
  let newUsers = 0;
  for (const firstSeen of Object.values(hashes)) {
    if (firstSeen === date) newUsers += 1;
  }
  const returningUsers = Math.max(0, dau - newUsers);

  return { date, dau, visits, newUsers, returningUsers };
}

export async function readDailyMetrics(env, days = HISTORY_DAYS) {
  const kv = getMetricsKv(env);
  const dates = listKstDates(days);
  if (!kv) {
    return {
      timezone: 'Asia/Seoul',
      today: summarizeDay(dates[0], null),
      totals: { uniqueUsers: 0 },
      days: dates.map((date) => summarizeDay(date, null))
    };
  }

  const [uniqKeys, ...dayPacks] = await Promise.all([
    listKeyNames(kv, UNIQ_KEY_PREFIX),
    ...dates.map(async (date) => {
      const [visitKeys, dauKeys, oldDay] = await Promise.all([
        listKeyNames(kv, `${VISIT_KEY_PREFIX}${date}:`),
        listKeyNames(kv, `${DAU_KEY_PREFIX}${date}:`),
        kv.get(`${DAY_KEY_PREFIX}${date}`, { type: 'json' })
      ]);
      const [visitValues, dauRows] = await Promise.all([
        getMany(kv, visitKeys),
        getMany(kv, dauKeys, 'json')
      ]);
      return mergeDayFromShards(date, oldDay, visitValues, dauRows);
    })
  ]);

  const history = dayPacks;
  let uniqueUsers = 0;
  if (uniqKeys.length) {
    const uniqValues = await getMany(kv, uniqKeys);
    for (const value of uniqValues) uniqueUsers += Number(value) || 0;
  } else {
    const seen = await kv.get(SEEN_KEY, { type: 'json' });
    uniqueUsers = seen && typeof seen === 'object' ? Object.keys(seen).length : 0;
  }

  return {
    timezone: 'Asia/Seoul',
    today: history[0] || summarizeDay(dates[0], emptyDay(dates[0])),
    totals: { uniqueUsers },
    days: history
  };
}
