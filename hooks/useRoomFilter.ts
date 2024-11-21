// hooks/useRoomFilter.ts
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { ROOMS } from '../constants/rooms';

const STORAGE_KEY = 'selectedRooms';

export const useRoomFilter = () => {
  const router = useRouter();
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // 初期化: URLパラメータ -> LocalStorage -> デフォルト値
  useEffect(() => {
    const initializeRooms = () => {
      // URLからの読み込み
      const roomsParam = router.query.rooms;
      if (roomsParam) {
        const roomsFromUrl = typeof roomsParam === 'string' 
          ? roomsParam.split(',')
          : roomsParam;
        setSelectedRooms(roomsFromUrl);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(roomsFromUrl));
        setIsInitialized(true);
        return;
      }

      // LocalStorageからの読み込み
      const storedRooms = localStorage.getItem(STORAGE_KEY);
      if (storedRooms) {
        setSelectedRooms(JSON.parse(storedRooms));
        setIsInitialized(true);
        return;
      }

      // デフォルト値（全ての部屋）
      const allRooms = ROOMS.map(room => room.id);
      setSelectedRooms(allRooms);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allRooms));
      setIsInitialized(true);
    };

    initializeRooms();
  }, [router.query.rooms]);

  // 選択状態が変更されたときの処理
  const updateRooms = (newRooms: string[]) => {
    setSelectedRooms(newRooms);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newRooms));

    // URLパラメータの更新
    const newUrl = {
      pathname: router.pathname,
      query: { ...router.query, rooms: newRooms.join(',') }
    };
    router.push(newUrl, undefined, { shallow: true });
  };

  const selectAll = () => {
    const allRooms = ROOMS.map(room => room.id);
    updateRooms(allRooms);
  };

  const deselectAll = () => {
    updateRooms([]);
  };

  return {
    selectedRooms,
    updateRooms,
    selectAll,
    deselectAll,
    isInitialized
  };
};