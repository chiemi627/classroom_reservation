// components/TimeSlotCell.tsx
import { CalendarEventComponent } from './CalendarEvent';

interface TimeSlotCellProps {
  events: CalendarEvent[];
  isToday: boolean;
}

export const TimeSlotCell: React.FC<TimeSlotCellProps> = ({ events, isToday }) => (
  <td className={`border-b border-r border-gray-200 p-3 align-top last:border-r-0
    ${isToday ? 'bg-yellow-50/20' : ''}`}>
    <div className="min-h-[80px]">
      {events.map(event => (
        <CalendarEventComponent key={event.id} event={event} />
      ))}
    </div>
  </td>
);