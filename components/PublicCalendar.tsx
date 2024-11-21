// components/PublicCalendar.tsx
import { useState, useEffect } from 'react';
import { Calendar, Clock, MapPin } from 'lucide-react';

interface CalendarEvent {
  id: string;
  subject: string;
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
}

export const PublicCalendar = () => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiResponse, setApiResponse] = useState<any>(null); // APIレスポンス全体を保存

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      const response = await fetch('/api/public-calendar');
      const data = await response.json();
      console.log('API Response:', data); // コンソールに出力
      setApiResponse(data); // レスポンス全体を保存

      if (!response.ok) {
        throw new Error(data.error || 'カレンダーの取得に失敗しました');
      }

      setEvents(data.value || []);
    } catch (err) {
      console.error('Error:', err);
      setError(err instanceof Error ? err.message : '未知のエラー');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Intl.DateTimeFormat('ja-JP', {
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    }).format(new Date(dateString));
  };

  const formatTime = (dateString: string) => {
    return new Intl.DateTimeFormat('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(dateString));
  };

  // 日付でイベントをグループ化
  const groupedEvents = events.reduce((groups, event) => {
    const date = formatDate(event.start.dateTime);
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(event);
    return groups;
  }, {} as Record<string, CalendarEvent[]>);

  if (loading) {
    return <div className="text-center py-8">読み込み中...</div>;
  }

  if (error) {
    return (
      <div className="text-red-500 text-center py-8">
        <div>エラー: {error}</div>
        {apiResponse && (
          <pre className="mt-4 text-left bg-gray-100 p-4 rounded overflow-auto text-sm">
            {JSON.stringify(apiResponse, null, 2)}
          </pre>
        )}
      </div>
    );
  }
  return (
    <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg overflow-hidden">
      <div className="p-6 bg-gray-50 border-b">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Calendar className="w-6 h-6" />
          今週の予定
        </h2>
      </div>

      <div className="p-6">
        <div className="space-y-6">
          {Object.entries(groupedEvents).map(([date, dayEvents]) => (
            <div key={date} className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 border-b pb-2">
                {date}
              </h3>
              {dayEvents.map((event) => (
                <div 
                  key={event.id} 
                  className="bg-white rounded-lg p-4 border-l-4 border-blue-500 hover:shadow-md transition-shadow"
                >
                  <div className="font-medium text-lg">{event.subject}</div>
                  <div className="flex items-center gap-2 text-gray-600 mt-2">
                    <Clock className="w-4 h-4" />
                    <span>
                      {formatTime(event.start.dateTime)} - {formatTime(event.end.dateTime)}
                    </span>
                  </div>
                  {event.location?.displayName && (
                    <div className="flex items-center gap-2 text-gray-600 mt-1">
                      <MapPin className="w-4 h-4" />
                      <span>{event.location.displayName}</span>
                    </div>
                  )}
                  {event.description && (
                    <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">
                      {event.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
          {events.length === 0 && (
            <div className="text-center text-gray-500 py-4">
              今週の予定はありません
            </div>
          )}
        </div>
      </div>
    </div>
  );
};