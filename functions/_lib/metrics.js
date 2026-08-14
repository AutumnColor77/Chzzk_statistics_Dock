import { timingSafeEqual, updateSession } from './security.js';

export const CHANNEL_ID_PATTERN = /^[a-f0-9]{10,64}$/i;

const DAY_KEY_PREFIX = 'metrics:day:';
const SEEN_KEY = 'metrics:seen';
const DAY_TTL_SECONDS = 90 * 24 * 60 * 60; // 90일
const HISTORY_DAYS = 30;
const CHZZK_USERS_ME = 'https://openapi.chzzk.naver.com/open/v1/users/me';

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

export function isAdminChannelId(channelId, env) {
  if (typeof channelId !== 'string' || !CHANNEL_ID_PATTERN.test(channelId)) return false;
  const raw = (env.ADMIN_CHANNEL_ID || '').trim().toLowerCase();
  if (!raw) return false;
  const id = channelId.toLowerCase();
  for (const allowed of raw.split(/\s+/).filter(Boolean)) {
    if (allowed.length === id.length && timingSafeEqual(allowed, id)) return true;
  }
  return false;
}

export function isAdminConfigured(env) {
  return (env.ADMIN_CHANNEL_ID || '').trim().length > 0;
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

/**
 * 인증된 독 사용자를 오늘(KST) 지표에 반영합니다.
 * 채널 ID는 SHA-256 해시로만 저장합니다.
 */
export async function recordDailyActiveUser(env, channelId) {
  const kv = getMetricsKv(env);
  if (!kv || typeof channelId !== 'string' || !CHANNEL_ID_PATTERN.test(channelId)) return;

  const hash = await hashChannelId(channelId);
  const date = kstDateString();
  const dayKey = `${DAY_KEY_PREFIX}${date}`;

  const [dayRaw, seenRaw] = await Promise.all([
    kv.get(dayKey, { type: 'json' }),
    kv.get(SEEN_KEY, { type: 'json' })
  ]);

  const day = dayRaw && typeof dayRaw === 'object' ? dayRaw : emptyDay(date);
  if (!day.hashes || typeof day.hashes !== 'object') day.hashes = {};
  day.date = date;
  day.visits = (Number(day.visits) || 0) + 1;

  const seen = seenRaw && typeof seenRaw === 'object' ? seenRaw : {};
  const alreadyToday = Object.prototype.hasOwnProperty.call(day.hashes, hash);
  const seenBefore = Object.prototype.hasOwnProperty.call(seen, hash);

  if (!alreadyToday) {
    day.hashes[hash] = 1;
    day.dau = (Number(day.dau) || 0) + 1;
    if (seenBefore) {
      day.returningUsers = (Number(day.returningUsers) || 0) + 1;
    } else {
      day.newUsers = (Number(day.newUsers) || 0) + 1;
      seen[hash] = date;
    }
  }

  const writes = [
    kv.put(dayKey, JSON.stringify(day), { expirationTtl: DAY_TTL_SECONDS })
  ];
  if (!alreadyToday && !seenBefore) {
    writes.push(kv.put(SEEN_KEY, JSON.stringify(seen)));
  }
  await Promise.all(writes);
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

  const [seen, ...dayRows] = await Promise.all([
    kv.get(SEEN_KEY, { type: 'json' }),
    ...dates.map((date) => kv.get(`${DAY_KEY_PREFIX}${date}`, { type: 'json' }))
  ]);

  const history = dates.map((date, i) => summarizeDay(date, dayRows[i]));
  const uniqueUsers = seen && typeof seen === 'object' ? Object.keys(seen).length : 0;

  return {
    timezone: 'Asia/Seoul',
    today: history[0],
    totals: { uniqueUsers },
    days: history
  };
}
