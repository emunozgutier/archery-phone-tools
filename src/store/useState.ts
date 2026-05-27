import { create } from 'zustand';
import { useErrorLog } from './useErrorLog';
import { usePermission } from './usePermission';
import { useCalibration } from './useCalibration';

export type AppState = 'permissions' | 'calibrating' | 'active' | 'post_shot';

export type TrackerState = 
  | 'idle' 
  | 'enter_state_armed' 
  | 'stable_state_armed' 
  | 'moving_to_state_aim' 
  | 'enter_aiming_aim' 
  | 'stable_state_aim' 
  | 'exit_aiming_aim';

export type ActiveTab = 'tracker' | 'sessions' | 'calibration';

interface StateMachineStore {
  appState: AppState;
  trackerState: TrackerState;
  triggerState: 'IDLE' | 'ARMED' | 'AIMING';
  activeTab: ActiveTab;
  
  setAppState: (state: AppState) => void;
  setTrackerState: (state: TrackerState) => void;
  setActiveTab: (tab: ActiveTab) => void;
}

export const useStateStore = create<StateMachineStore>((set) => {
  const getTodayDateString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const initialAppState = (() => {
    const permissionStore = usePermission.getState();
    const calibrationStore = useCalibration.getState();
    const today = getTodayDateString();

    const hasPermissionToday = permissionStore.approvalDate === today;
    const hasCalibrationToday = calibrationStore.calibrationDate === today;

    if (!hasPermissionToday) {
      return 'permissions';
    }
    if (!hasCalibrationToday) {
      return 'calibrating';
    }
    return 'active';
  })();

  return {
    appState: initialAppState,
    trackerState: 'idle',
    triggerState: 'IDLE',
    activeTab: 'tracker',
  
  setAppState: (appState) => {
    useErrorLog.getState().addLog(`State machine transition to: ${appState.toUpperCase()}`);
    set({ appState });
  },
  
  setTrackerState: (trackerState) => {
    let triggerState: 'IDLE' | 'ARMED' | 'AIMING' = 'IDLE';
    if (trackerState === 'stable_state_armed' || trackerState === 'moving_to_state_aim') {
      triggerState = 'ARMED';
    } else if (trackerState === 'enter_aiming_aim' || trackerState === 'stable_state_aim' || trackerState === 'exit_aiming_aim') {
      triggerState = 'AIMING';
    }
    set({ trackerState, triggerState });
  },
  setActiveTab: (activeTab) => set({ activeTab })
  };
});
