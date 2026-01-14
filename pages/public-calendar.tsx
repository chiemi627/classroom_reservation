// pages/public-calendar.tsx
import type { NextPage } from 'next';
import { PublicCalendar } from '../components/PublicCalendar';

const PublicCalendarPage: NextPage = () => {
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-3xl mx-auto mb-6 bg-white p-4 rounded shadow">
        <h1 className="text-lg font-semibold mb-2">公開カレンダーについて</h1>
        <p className="text-sm text-gray-700 mb-2">カレンダーの同期には最大で10分ほどかかる場合があります。また、同期が失敗することがあります。最新の予定は以下のOutlookカレンダーでも確認できます。</p>
        <p className="text-sm">
          <a
            href="https://outlook.office365.com/owa/calendar/276483ab2fa2402694edcf0328d98c55@a.tsukuba-tech.ac.jp/00027ef3555a42adaf7eb9ed90dafc1d9686583739844037569/calendar.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline break-words"
          >
            Outlookの公開カレンダーを開く
          </a>
        </p>
      </div>
      <PublicCalendar />
    </div>
  );
};

export default PublicCalendarPage;