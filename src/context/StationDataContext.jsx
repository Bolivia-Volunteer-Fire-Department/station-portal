import React, { createContext, useContext, useMemo } from 'react';
import { readStationMetaCache, isStationMetaStale } from '../utils/stationCache';

const StationDataContext = createContext(null);

export function StationDataProvider({
  ranks = [],
  roles = [],
  shifts = [],
  systemSettings = [],
  departmentName = '',
  departmentLogo = '',
  children,
}) {
  const systemSettingsMap = useMemo(() => {
    if (!Array.isArray(systemSettings)) return {};
    return systemSettings.reduce((acc, s) => {
      if (s && s.key !== undefined) acc[s.key] = s.value;
      return acc;
    }, {});
  }, [systemSettings]);

  const value = useMemo(
    () => {
      const cached = readStationMetaCache();
      return {
        ranks,
        roles,
        shifts,
        systemSettings,
        systemSettingsMap,
        departmentName,
        departmentLogo,
        cacheSavedAt: cached?.savedAt || null,
        isStale: isStationMetaStale(cached?.savedAt),
      };
    },
    [ranks, roles, shifts, systemSettings, systemSettingsMap, departmentName, departmentLogo]
  );

  return <StationDataContext.Provider value={value}>{children}</StationDataContext.Provider>;
}

export function useStationData() {
  const context = useContext(StationDataContext);
  return context || {};
}

export default StationDataContext;

