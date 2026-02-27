import React, { createContext, useContext, useState, useEffect } from 'react';
import { login as apiLogin } from './api';

interface AuthUser { id: string; email: string; role: string; }
interface AuthCtx {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginDirect: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('lr_user');
    const token = localStorage.getItem('lr_token');
    if (stored && token) {
      try { setUser(JSON.parse(stored) as AuthUser); } catch { localStorage.clear(); }
    }
    setIsLoading(false);
  }, []);

  async function login(email: string, password: string) {
    const { token, user } = await apiLogin(email, password);
    localStorage.setItem('lr_token', token);
    localStorage.setItem('lr_user', JSON.stringify(user));
    setUser(user);
  }

  function loginDirect(token: string, user: AuthUser) {
    localStorage.setItem('lr_token', token);
    localStorage.setItem('lr_user', JSON.stringify(user));
    setUser(user);
  }

  function logout() {
    localStorage.removeItem('lr_token');
    localStorage.removeItem('lr_user');
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, loginDirect, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

