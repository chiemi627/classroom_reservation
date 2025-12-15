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

    // ストアを初期化（初回はディスクから読み込むか、fetchをトリガー）
    await calendarStore.initStore(calendarUrl);

    // 即時更新トリガ（管理用）：?refresh=1 を付けると外部ICSをフェッチしてキャッシュを更新する
    // セキュリティ: 環境変数 `CALENDAR_REFRESH_TOKEN` が設定されている場合は
    // ?token=... または ヘッダ x-refresh-token: ... による認証を必須とする
    const { refresh } = req.query;
    if (refresh && String(refresh) !== '0' && String(refresh).toLowerCase() !== 'false') {
      const configuredToken = process.env.CALENDAR_REFRESH_TOKEN;
      const tokenFromQuery = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token;
      const tokenFromHeader = req.headers['x-refresh-token'] || req.headers['x-refresh-token'.toLowerCase()];
      const suppliedToken = tokenFromQuery || tokenFromHeader;

      if (configuredToken) {
        if (!suppliedToken || String(suppliedToken) !== String(configuredToken)) {
          return res.status(401).json({ error: '刷新トークンが無効です' });
        }
      } else {
        // 環境変数が未設定の場合は警告をログに出すが、互換性のため許可する
        console.warn('CALENDAR_REFRESH_TOKEN is not set; refresh endpoint is unprotected');
      }

      // 強制更新は非同期でトリガ（ワークフローがタイムアウトするのを防ぐため、即時に 202 を返す）
      // 実行中の結果はログに記録される
      // Allow callers to pass optional fetch overrides via query params (only for refresh).
      const rqTimeout = req.query.fetchTimeoutMs ? Number(req.query.fetchTimeoutMs) : undefined;
      const rqRetries = req.query.fetchRetries ? Number(req.query.fetchRetries) : undefined;

      calendarStore.fetchAndStore(calendarUrl, { timeoutMs: rqTimeout, retries: rqRetries })
        .then(r => {
          if (!r.ok) console.error('Forced refresh failed:', r.error);
          else console.log(`Forced refresh completed, ${r.count} events`);
        })
        .catch(err => console.error('Forced refresh exception:', err));

      return res.status(202).json({ ok: true, message: 'Refresh started' });
    }

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