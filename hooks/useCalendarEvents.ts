import { useState, useEffect, useRef } from 'react';
import type { CalendarEvent,TimeSlot } from '../types/calendar';


export const useCalendarEvents = (currentDate: Date) => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = async () => {
    try {
      const response = await fetch('/api/public-calendar');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'カレンダーの取得に失敗しました');
      }
      setEvents(data.value || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知のエラー');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [currentDate]);

  return {events, loading, error};
  
}