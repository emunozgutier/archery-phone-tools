import { create } from 'zustand';

interface CalibrationStoreState {
  isCalibrated: boolean;
  calibrationDate: string | null;
  completeCalibration: () => void;
  resetCalibration: () => void;
}

const getTodayDateString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const useCalibration = create<CalibrationStoreState>((set) => {
  let initialCalibrated = false;
  let initialDate: string | null = null;
  
  try {
    initialCalibrated = localStorage.getItem('archery_calibrated') === 'true';
    initialDate = localStorage.getItem('archery_calibration_date');
  } catch (e) {
    // ignore
  }

  return {
    isCalibrated: initialCalibrated,
    calibrationDate: initialDate,
    completeCalibration: () => {
      const today = getTodayDateString();
      try {
        localStorage.setItem('archery_calibrated', 'true');
        localStorage.setItem('archery_calibration_date', today);
      } catch (e) {
        // ignore
      }
      set({ isCalibrated: true, calibrationDate: today });
    },
    resetCalibration: () => {
      try {
        localStorage.removeItem('archery_calibrated');
        localStorage.removeItem('archery_calibration_date');
      } catch (e) {
        // ignore
      }
      set({ isCalibrated: false, calibrationDate: null });
    }
  };
});
