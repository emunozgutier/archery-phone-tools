import { create } from 'zustand';
import { useGlobal } from './useGlobal';

interface PermissionState {
  cameraApproved: boolean;
  sensorApproved: boolean;
  approvalDate: string | null;
  approvePermissions: () => void;
  resetPermissions: () => void;
}

const getTodayDateString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const usePermission = create<PermissionState>((set) => {
  let initialCamera = false;
  let initialSensor = false;
  let initialDate: string | null = null;
  
  try {
    initialCamera = localStorage.getItem('archery_camera_approved') === 'true';
    initialSensor = localStorage.getItem('archery_sensor_approved') === 'true';
    initialDate = localStorage.getItem('archery_permission_date');
  } catch (e) {
    // ignore
  }

  return {
    cameraApproved: initialCamera,
    sensorApproved: initialSensor,
    approvalDate: initialDate,
    approvePermissions: () => {
      const today = getTodayDateString();
      try {
        localStorage.setItem('archery_camera_approved', 'true');
        localStorage.setItem('archery_sensor_approved', 'true');
        localStorage.setItem('archery_permission_date', today);
      } catch (e) {
        // ignore
      }
      set({ cameraApproved: true, sensorApproved: true, approvalDate: today });
    },
    resetPermissions: () => {
      try {
        localStorage.removeItem('archery_camera_approved');
        localStorage.removeItem('archery_sensor_approved');
        localStorage.removeItem('archery_permission_date');
        localStorage.removeItem('archery_onboarded');
      } catch (e) {
        // ignore
      }
      set({ cameraApproved: false, sensorApproved: false, approvalDate: null });
      useGlobal.getState().setIsOnboarded(false);
    }
  };
});
