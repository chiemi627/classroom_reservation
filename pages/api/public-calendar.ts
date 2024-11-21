// pages/api/public-calendar.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import ical from 'node-ical';

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

    // カレンダーを取得
    const [events] = await Promise.all([ical.async.fromURL(calendarUrl)]);

    // イベントを整形して、どのカレンダーかを示すsourceプロパティを追加
    const formatEvents = (events: Record<string, any>) => {      
      return Object.values(events)
        .filter((event): event is ICalEvent => event.type === 'VEVENT')
        .map(event => {
          const [, room, eventName] = event.summary.match(/\[(\d+)\]\s*(.*)/) || [null, '', event.summary];
          return {
          id: event.uid,
          subject: eventName,
          room: room,
          start: {
            dateTime: event.start.toISOString(),
            timeZone: 'Asia/Tokyo'
          },
          end: {
            dateTime: event.end.toISOString(),
            timeZone: 'Asia/Tokyo'
          },
          location: event.location ? {
            displayName: event.location
          } : undefined,
          description: event.description
        }
        });
    };

    const formatedevents = formatEvents(events);

    res.status(200).json({ value: formatedevents });

  } catch (error) {
    console.error('Calendar fetch error:', error);
    res.status(500).json({ 
      error: "カレンダーの取得に失敗しました",
      details: error instanceof Error ? error.message : '未知のエラー'
    });
  }
}