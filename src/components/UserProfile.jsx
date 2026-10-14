import React, { useState, useEffect } from 'react';
import { User, Settings } from 'lucide-react';
import CenteredContent from './CenteredContent';
import { ProfilePictureCard, PersonalInformationCard, PasswordChangeCard } from './MySettings';
import CertificationsModule from './CertificationsModule';
import UserSettings from './MySettings';

const TABS = [
  { id: 'profile', label: 'My Profile', icon: User },
  { id: 'settings', label: 'My Settings', icon: Settings },
];

export default function UserProfile({
  currentUser,
  currentRole,
  currentRank,
  ranks = [],
  token,
  userSettings = [],
  systemSettings = {},
  canApproveShifts = false,
  canUseChat = false,
  onSaveSettings,
  onFontScalePreview,
  onPasswordChange,
  pushDeviceApi,
  initialTab = 'profile',
}) {
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

          <CertificationsModule
            token={token}
            collapsible
            defaultCollapsed
            unwrap
          />

          <PasswordChangeCard onPasswordChange={onPasswordChange} />
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
          onSaveSettings={onSaveSettings}
          onFontScalePreview={onFontScalePreview}
          pushDeviceApi={pushDeviceApi}
        />
      )}
    </CenteredContent>
  );
}

