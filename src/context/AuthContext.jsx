import React, { createContext, useContext, useMemo } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({
  currentUser,
  currentRole,
  currentRank,
  authToken,
  isAdmin = false,
  canAdminister = false,
  permissions = {},
  onLogout,
  children,
}) {
  const value = useMemo(
    () => ({
      currentUser,
      currentRole,
      currentRank,
      authToken,
      isAdmin,
      canAdminister,
      permissions,
      can: (key) => Boolean(permissions[key]),
      onLogout,
    }),
    [currentUser, currentRole, currentRank, authToken, isAdmin, canAdminister, permissions, onLogout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  return context || {};
}

export default AuthContext;

