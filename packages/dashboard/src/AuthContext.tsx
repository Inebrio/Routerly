import React, { createContext, useContext, useState, useEffect } from 'react';
import { login as apiLogin } from './api';

interface AuthUser { id: string; email: string; role: string; permissions?: string[]; }
interface AuthCtx {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginDirect: (token: string, user: AuthUser) => void;
  logout: () => void;
  updateUser: (partial: Partial<AuthUser>) => void;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('lr_user');
    const token = localStorage.getItem('lr_token');
    if (stored && token) {
      if (stored === 'undefined') {
        localStorage.removeItem('lr_user');
      } else {
        try {
          setUser(JSON.parse(stored) as AuthUser);
        } catch (err) {
          console.error('Failed to parse user from localStorage:', err);
          localStorage.removeItem('lr_user');
        }
      }
    }
    setIsLoading(false);
  }, []);

  async function login(email: string, password: string) {
    const { token, refreshToken, user } = await apiLogin(email, password);
    localStorage.setItem('lr_token', token);
    localStorage.setItem('lr_user', JSON.stringify(user));
    // Persist refresh token and expiry for silent renewal
    if (refreshToken) localStorage.setItem('lr_refresh_token', refreshToken);
    try {
      const payload = JSON.parse(atob(token.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
      if (payload.exp) localStorage.setItem('lr_expires_at', String(payload.exp * 1000));
    } catch { /* expiry decoding is best-effort */ }
    setUser(user);
  }

  function loginDirect(token: string, user: AuthUser) {
    localStorage.setItem('lr_token', token);
    localStorage.setItem('lr_user', JSON.stringify(user));
    try {
      const payload = JSON.parse(atob(token.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
      if (payload.exp) localStorage.setItem('lr_expires_at', String(payload.exp * 1000));
    } catch { /* best-effort */ }
    setUser(user);
  }

  function logout() {
    localStorage.removeItem('lr_token');
    localStorage.removeItem('lr_user');
    localStorage.removeItem('lr_refresh_token');
    localStorage.removeItem('lr_expires_at');
    setUser(null);
  }

  function updateUser(partial: Partial<AuthUser>) {
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...partial };
      localStorage.setItem('lr_user', JSON.stringify(next));
      return next;
    });
  }

  function can(permission: string): boolean {
    if (!user) return false;
    // admin role has all permissions
    if (user.role === 'admin') return true;
    return user.permissions?.includes(permission) ?? false;
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, loginDirect, logout, updateUser, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

