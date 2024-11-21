// components/DateCell.tsx
interface DateCellProps {
  date: Date;
  isToday: boolean;
  rowIndex: number;
}

export const DateCell: React.FC<DateCellProps> = ({ date, isToday, rowIndex }) => (
  <td className={`
    sticky left-0 z-10 border-b border-r border-gray-200 p-4 font-medium
    ${date.getDay() === 0 ? 'bg-red-50 text-red-800' : 
      date.getDay() === 6 ? 'bg-blue-50 text-blue-800' : 
      rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
    ${isToday ? 'bg-yellow-50 font-bold' : ''}
  `}>
    <div className="flex items-center gap-2">
      <span className="text-lg">
        {date.getDate()}
        {isToday && <span className="ml-2 text-sm text-orange-600">Today</span>}
      </span>
      <span className="text-sm text-gray-600">
        ({['日', '月', '火', '水', '木', '金', '土'][date.getDay()]})
      </span>
    </div>
    {isToday && (
      <div className="absolute left-0 w-full h-full bg-yellow-100 opacity-10 pointer-events-none" />
    )}
  </td>
);