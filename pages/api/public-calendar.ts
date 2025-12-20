// pages/api/public-calendar.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import calendarStore from '../../utils/calendarStore';

// iCalのイベント型定義
interface ICalEvent {
  type: string;
  uid: string;
  summary: string;
  start: Date;
  end: Date;
  location?: string;
  description?: string;
  source?: string;
}

type CalendarEvent = {
  id: string;
  subject: string;
  room: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  location?: {
    displayName: string;
  };
  description?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    // カレンダーのURL
    const calendarUrl = process.env.PUBLIC_CALENDAR_URL;

    if (!calendarUrl) {
      return res.status(400).json({ error: "カレンダーURLが設定されていません" });
    }

    // ストア初期化（同期 fetch を非同期に変更）
    await calendarStore.initStore(calendarUrl);

    // キャッシュが空ならバックグラウンドで更新トリガだけ行う（ブロッキング禁止）
    const events = calendarStore.getEvents();
    if ((!events || events.length === 0)) {
      // 非同期で更新を起動するが await はしない
      (async () => {
        try {
          const timeoutMs = Number(process.env.CALENDAR_FETCH_TIMEOUT_MS ?? 120000); // デフォルト120秒
          const retries = Number(process.env.CALENDAR_FETCH_RETRIES ?? 3);
          await calendarStore.fetchAndStore(calendarUrl, { timeoutMs, retries });
          console.log('[public-calendar] background fetchAndStore finished');
        } catch (e) {
          console.warn('[public-calendar] background fetchAndStore failed', e);
        }
      })();
    }
    // ここで即座に現在のキャッシュ（空でも）を返す

    // まずはストアからイベントを取得
    let formatedevents = calendarStore.getEvents();

    // もしキャッシュが空なら、短時間だけ同期的にフェッチを試みる（Vercel の一時ファイルや初回起動で空になるため）
    if ((!formatedevents || formatedevents.length === 0)) {
      try {
  const timeoutMs = 10_000; // 10秒で打ち切る
  const fetchPromise = calendarStore.fetchAndStore(calendarUrl, { timeoutMs, retries: 1 });
        const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ ok: false, error: 'timeout' }), timeoutMs));
        // @ts-ignore
        const r = await Promise.race([fetchPromise, timeoutPromise]);
        if (r && (r as any).ok) {
          formatedevents = calendarStore.getEvents();
        } else {
          console.warn('Synchronous fetchAndStore did not complete or failed:', r);
        }
      } catch (e) {
        console.error('Synchronous fetchAndStore threw:', e);
      }
    }

    // クエリから start / end（ISO 文字列）を受け取り、範囲でフィルタする
    const { start: startQuery, end: endQuery } = req.query;

    const parseDateQuery = (q: any): Date | null => {
      if (!q) return null;
      const s = Array.isArray(q) ? q[0] : q;
      const t = Date.parse(String(s));
      if (isNaN(t)) return null;
      return new Date(t);
    };

    const startDate = parseDateQuery(startQuery);
    const endDate = parseDateQuery(endQuery);

    if ((startQuery && !startDate) || (endQuery && !endDate)) {
      return res.status(400).json({ error: 'start または end クエリが ISO 日付形式ではありません' });
    }

    const filtered = formatedevents.filter(ev => {
      const evStart = new Date(ev.start.dateTime);
      const evEnd = new Date(ev.end.dateTime);

      // イベントがクエリ期間と一切重複しない場合は除外
      if (startDate && evEnd < startDate) return false;
      if (endDate && evStart > endDate) return false;
      return true;
    });

    res.status(200).json({ value: filtered, fetchedAt: calendarStore.getLastFetched() });

  } catch (error) {
    console.error('Calendar fetch error:', error);
    res.status(500).json({ 
      error: "カレンダーの取得に失敗しました",
      details: error instanceof Error ? error.message : '未知のエラー'
    });
  }
}