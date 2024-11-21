interface CalendarEventProps {
  event: CalendarEvent;
}

export const CalendarEventComponent: React.FC<CalendarEventProps> = ({ event }) => (
  <div 
    className="mb-2 last:mb-0 rounded-lg p-2.5 shadow-sm hover:shadow-md transition-all duration-200"
  >
    <div className="font-medium flex items-center gap-1.5 mb-1">
      <span>[{event.room}]{event.subject}</span>
    </div>
  </div>
);