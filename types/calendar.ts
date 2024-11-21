export type CalendarEvent = {
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

export interface TimeSlot {
  name: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}
