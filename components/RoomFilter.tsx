// components/RoomFilter.tsx
import { ROOMS } from '../constants/rooms';

interface RoomFilterProps {
  selectedRooms: string[];
  onRoomChange: (rooms: string[]) => void;
}

export const RoomFilter: React.FC<RoomFilterProps> = ({ selectedRooms, onRoomChange }) => {
  const handleCheckboxChange = (roomId: string) => {
    if (selectedRooms.includes(roomId)) {
      onRoomChange(selectedRooms.filter(id => id !== roomId));
    } else {
      onRoomChange([...selectedRooms, roomId]);
    }
  };

  return (
    <div className="mb-4">
      <h3 className="text-sm font-medium text-gray-700 mb-2">表示する部屋</h3>
      <div className="flex flex-wrap gap-3">
        {ROOMS.map(room => (
          <label key={room.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selectedRooms.includes(room.id)}
              onChange={() => handleCheckboxChange(room.id)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-600">{room.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
};