import type { TimeSlot } from '../types/calendar';

export const TIME_SLOTS: TimeSlot[] = [
  { name: "1限", startHour: 8, startMinute: 50, endHour: 10, endMinute: 20 },
  { name: "2限", startHour: 10, startMinute: 30, endHour: 12, endMinute: 0 },
  { name: "昼休み", startHour: 12, startMinute: 0, endHour: 13, endMinute: 0 },
  { name: "3限", startHour: 13, startMinute: 0, endHour: 14, endMinute: 30 },
  { name: "4限", startHour: 14, startMinute: 40, endHour: 16, endMinute: 10 },
  { name: "5限", startHour: 16, startMinute: 20, endHour: 17, endMinute: 50 }
];