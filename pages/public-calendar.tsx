// pages/public-calendar.tsx
import type { NextPage } from 'next';
import { PublicCalendar } from '../components/PublicCalendar';

const PublicCalendarPage: NextPage = () => {
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <PublicCalendar />
    </div>
  );
};

export default PublicCalendarPage;