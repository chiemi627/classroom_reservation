import type { NextPage } from 'next';
import { TimetableCalendar } from '../components/TimetableCalendar';

const TimetablePage: NextPage = () => {
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto">
        <TimetableCalendar />
      </div>
    </div>
  );
};

export default TimetablePage;