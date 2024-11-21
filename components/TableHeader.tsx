// components/TableHeader.tsx
import { TIME_SLOTS } from '../constants/timetable';

export const TableHeader: React.FC = () => (
  <thead className="sticky top-0 z-20">
    <tr>
      <th className="sticky left-0 z-30 bg-gray-100 border-b border-r border-gray-200 p-4 text-gray-700 font-semibold text-left min-w-[120px]">
        日付
      </th>
      {TIME_SLOTS.map(slot => (
        <th key={slot.name} 
            className="bg-gray-100 border-b border-r border-gray-200 p-4 text-gray-700 font-semibold text-center min-w-[180px] last:border-r-0">
          {slot.name}
        </th>
      ))}
    </tr>
  </thead>
);