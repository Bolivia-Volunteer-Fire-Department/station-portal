import React, { useState, useEffect } from 'react';
import { User, Settings } from 'lucide-react';
import CenteredContent from './CenteredContent';
import { ProfilePictureCard, PersonalInformationCard, PasswordChangeCard } from './MySettings';
import CertificationsModule from './CertificationsModule';
import AssignedEquipmentCard from './AssignedEquipmentCard';
import UserSettings from './MySettings';
import { useAuth } from '../context/AuthContext';
import { useStationData } from '../context/StationDataContext';

const TABS = [
  { id: 'profile', label: 'My Profile', icon: User },
  { id: 'settings', label: 'My Settings', icon: Settings },
];

export default function UserProfile({
  currentUser: propUser,
  currentRole: propRole,
  currentRank: propRank,
  ranks: propRanks,
  token: propToken,
  userSettings = [],
  systemSettings: propSystemSettings,
  canApproveShifts: propCanApproveShifts,
  canUseChat: propCanUseChat,
  canManageWorkOrders: propCanManageWorkOrders,
  onSaveSettings,
  onFontScalePreview,
  onPasswordChange,
  pushDeviceApi,
  initialTab = 'profile',
}) {
  const auth = useAuth();
  const station = useStationData();

  const currentUser = propUser || auth.currentUser;
  const currentRole = propRole || auth.currentRole;
  const ranks = propRanks || station.ranks || [];
  const token = propToken || auth.authToken;
  const systemSettings = propSystemSettings || station.systemSettingsMap || {};
  const canApproveShifts = propCanApproveShifts !== undefined ? propCanApproveShifts : Boolean(auth.permissions?.canApproveShifts);
  const canUseChat = propCanUseChat !== undefined ? propCanUseChat : Boolean(auth.permissions?.canUseChat);
  const canManageWorkOrders = propCanManageWorkOrders !== undefined ? propCanManageWorkOrders : Boolean(auth.permissions?.canManageWorkOrders);
  const currentRank = propRank;
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Determine user rank if not explicitly provided
  const rank = currentRank || ranks.find((r) => String(r.id) === String(currentUser?.rank_id));

  return (
    <CenteredContent className="space-y-6">
      {/* Tab Switcher */}
      <div role="tablist" aria-label="User Profile" className="flex flex-wrap gap-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const selected = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition cursor-pointer ${
                selected
                  ? 'border-red-600 bg-red-600 text-white shadow-lg shadow-red-600/20'
                  : 'border-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab 1: My Profile */}
      {activeTab === 'profile' && (
        <div className="space-y-6">
          <ProfilePictureCard currentUser={currentUser} />

          <PersonalInformationCard
            currentUser={currentUser}
            currentRole={currentRole}
            currentRank={rank}
          />

          <AssignedEquipmentCard
            currentUser={currentUser}
            token={token}
          />

          <CertificationsModule
            token={token}
            collapsible
            defaultCollapsed
            unwrap
          />

          <PasswordChangeCard onPasswordChange={onPasswordChange} systemSettings={systemSettings} />
        </div>
      )}

      {/* Tab 2: My Settings */}
      {activeTab === 'settings' && (
        <UserSettings
          currentUser={currentUser}
          userSettings={userSettings}
          systemSettings={systemSettings}
          currentRole={currentRole}
          canApproveShifts={canApproveShifts}
          canUseChat={canUseChat}
          canManageWorkOrders={canManageWorkOrders}
          onSaveSettings={onSaveSettings}
          onFontScalePreview={onFontScalePreview}
          pushDeviceApi={pushDeviceApi}
        />
      )}
    </CenteredContent>
  );
}

