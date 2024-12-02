import { useState, useRef, useEffect } from 'react';
import { useCalendarEvents } from '../hooks/useCalendarEvents';
import { useRoomFilter } from '../hooks/useRoomFilter'; 
import { CalendarHeader } from './CalendarHeader';
import { TableHeader } from './TableHeader';
import { DateCell } from './DateCell';
import { TimeSlotCell } from './TimeSlotCell';
import { RoomFilter } from './RoomFilter';
import { TIME_SLOTS } from '../constants/timetable';
import { getDaysInMonth, isToday } from '../utils/dateUtils';
import type { CalendarEvent, TimeSlot } from '../types/calendar';
import { ROOMS } from '../constants/rooms';


export const TimetableCalendar = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
//  const [selectedRooms, setSelectedRooms] = useState<string[]>(ROOMS.map(room => room.id)); // 初期値は全ての部屋を選択

  const { events, loading, error } = useCalendarEvents(currentDate);
  const tableRef = useRef<HTMLDivElement>(null);
  const todayRowRef = useRef<HTMLTableRowElement>(null);
  
  const {selectedRooms,updateRooms} = useRoomFilter();
 
  // useEffect(() => {
  //   if (!loading && tableRef.current && todayRowRef.current) {
  //     const today = new Date();
  //     if (
  //       today.getMonth() === currentDate.getMonth() &&
  //       today.getFullYear() === currentDate.getFullYear()
  //     ) {
  //       const tableTop = tableRef.current.getBoundingClientRect().top;
  //       const rowTop = todayRowRef.current.getBoundingClientRect().top;

        
  //       const scrollTop = rowTop - tableTop - 100;

  //       tableRef.current.scrollTo({
  //         top: scrollTop,
  //         behavior: 'smooth'
  //       });
  //     }
  //   }
  // }, [loading, currentDate]);

  const getEventsForTimeSlot = (date: Date, timeSlot: TimeSlot): CalendarEvent[] => {
    return events.filter(event => {
      const eventDate = new Date(event.start.dateTime);
      const eventHour = eventDate.getHours();
      const eventMinute = eventDate.getMinutes();

      const roomMatch = selectedRooms.includes(event.room);

      return (
        roomMatch &&
        eventDate.getDate() === date.getDate() &&
        eventDate.getMonth() === date.getMonth() &&
        eventDate.getFullYear() === date.getFullYear() &&
        eventHour === timeSlot.startHour &&
        eventMinute === timeSlot.startMinute
      );
    });
  };

  if (loading) return <div className="text-center py-8">読み込み中...</div>;
  if (error) return <div className="text-red-500 text-center py-8">エラー: {error}</div>;

  const days = getDaysInMonth(currentDate);

  return (
    <div className="p-6 bg-white rounded-xl shadow-lg">
      <CalendarHeader
        currentDate={currentDate}
        onPrevMonth={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() - 1)))}
        onNextMonth={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() + 1)))}
        onCurrentMonth={() => setCurrentDate(new Date())}
        />      

        <RoomFilter 
          selectedRooms={selectedRooms}
          onRoomChange={updateRooms}
        />
      
      <div className="border border-gray-200 rounded-lg">
        <div 
          ref={tableRef}
          className="max-h-[600px] overflow-auto scroll-smooth"
        >
          <table className="w-full border-collapse relative">
            <TableHeader />
            <tbody>
              {days.map((day, rowIndex) => {
                const isTodayRow = isToday(day);
                return (
                  <tr 
                    key={day.getTime()} 
                    ref={isToday ? todayRowRef : null}
                    className={`
                      ${rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                      ${isTodayRow ? 'relative' : ''}
                    `}
                  >
                    <DateCell
                      date={day}
                      isToday={isTodayRow}
                      rowIndex={rowIndex}
                      />
                    {TIME_SLOTS.map(slot => (
                      <TimeSlotCell 
                        key={`${day.getTime()}-${slot.name}`}
                        events={getEventsForTimeSlot(day,slot)}
                        isToday={isTodayRow}                        
                        />
                    ))
                      
                    }
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TimetableCalendar;