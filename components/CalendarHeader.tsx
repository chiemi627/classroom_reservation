// components/CalendarHeader.tsx
interface CalendarHeaderProps {
  currentDate: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onCurrentMonth: () => void;
}

export const CalendarHeader: React.FC<CalendarHeaderProps> = ({
  currentDate,
  onPrevMonth,
  onNextMonth,
  onCurrentMonth
}) => (
  <>
    <div className="mb-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">
        {currentDate.getFullYear()}年{currentDate.getMonth() + 1}月
      </h2>
      <div className="flex flex-wrap gap-4 items-center">
        <a
          href="https://forms.office.com/r/qhvcJiXUq5"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center px-6 py-2.5 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition-colors shadow-sm"
        >
          ✏️ 予約する
        </a>
      </div>
    </div>

    <div className="flex justify-end mb-6">
      <div className="space-x-2">
        <button
          onClick={onPrevMonth}
          className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
        >
          前月
        </button>
        <button
          onClick={onCurrentMonth}
          className="px-4 py-2 text-sm font-medium text-white bg-gray-600 rounded-md hover:bg-gray-700 transition-colors"
        >
          今月
        </button>
        <button
          onClick={onNextMonth}
          className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
        >
          翌月
        </button>
      </div>
    </div>
  </>
);