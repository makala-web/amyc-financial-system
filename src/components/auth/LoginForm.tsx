'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, LogIn, Mail, KeyRound, WifiOff } from 'lucide-react';
import { useAuthStore } from '@/lib/store';
import { loginOffline, mirrorSessionToDexie } from '@/lib/offline-auth';
import { toast } from 'sonner';
import { Capacitor } from '@capacitor/core';

interface LoginFormProps {
  onSwitchToRegister: () => void;
  onSwitchToForgotPassword: () => void;
}

async function tryOnlineLogin(email: string, password: string) {
  const response = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  const result = await response.json();
  return { response, result };
}

export default function LoginForm({ onSwitchToRegister, onSwitchToForgotPassword }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);

  const login = useAuthStore((state) => state.login);
  const setAuthToken = useAuthStore((state) => state.setAuthToken);

  const completeOfflineLogin = async () => {
    const result = await loginOffline(email, password);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    login(result.user, result.org);
    setAuthToken(null);
    setOfflineMode(true);
    toast.success('Umeingia nje ya mtandao. Data yako iko kwenye kifaa hiki.');
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setOfflineMode(false);

    if (!email.trim() || !password.trim()) {
      setError('Tafadhali jaza barua pepe na nenosiri.');
      return;
    }

    setLoading(true);

    try {
      if (Capacitor.isNativePlatform()) {
        const offlineOk = await completeOfflineLogin();
        if (!offlineOk) {
          setError('Akaunti haipo kwenye kifaa hiki. Jisajili kwanza au ingia mara moja kwenye web ili kuhifadhi akaunti.');
        }
        return;
      }

      if (!navigator.onLine) {
        await completeOfflineLogin();
        return;
      }

      try {
        const { response, result } = await tryOnlineLogin(email, password);

        if (response.ok && result.success) {
          const { user: userData, token } = result.data;
          if (!userData?.orgUnit) {
            setError('Akaunti haina taarifa sahihi ya taasisi. Wasiliana na msimamizi.');
            return;
          }

          if (token) {
            setAuthToken(token);
          }

          await mirrorSessionToDexie(userData, userData.orgUnit, password);
          login(userData, userData.orgUnit);
          toast.success('Umeingia kwa mafanikio.');
          return;
        }

        if (response.status === 401 || response.status === 403) {
          setError(result.message || 'Barua pepe au nenosiri si sahihi.');
          return;
        }

        const offlineOk = await completeOfflineLogin();
        if (!offlineOk) {
          setError(
            result.message || 'Seva haipatikani. Jaribu tena au tumia akaunti iliyohifadhiwa kwenye kifaa.'
          );
        }
      } catch {
        const offlineOk = await completeOfflineLogin();
        if (!offlineOk) {
          setError('Haujaunganishwa na seva haipatikani. Tumia akaunti uliyohifadhi kwenye kifaa.');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md shadow-xl border-0 mx-2 sm:mx-0 overflow-hidden">
      <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-400" />

      <CardHeader className="text-center pb-2 p-5 sm:p-7">
        <div className="mx-auto mb-4 w-14 h-14 sm:w-16 sm:h-16 relative bg-emerald-50 rounded-xl border border-emerald-100 p-1.5 shadow-sm">
          <Image
            src="/logo-amyc.png"
            alt="AMYC Logo"
            fill
            className="object-contain"
            priority
          />
        </div>
        <CardTitle className="text-xl sm:text-2xl font-bold text-emerald-800">
          Ingia kwenye Akaunti
        </CardTitle>
        <CardDescription className="text-muted-foreground text-sm mt-1">
          Weka taarifa zako ili kupata mfumo
        </CardDescription>
        {typeof navigator !== 'undefined' && !navigator.onLine && (
          <p className="mt-2 text-xs text-amber-700 flex items-center justify-center gap-1">
            <WifiOff className="h-3.5 w-3.5" />
            Nje ya mtandao — utatumia akaunti iliyohifadhiwa kwenye kifaa
          </p>
        )}
      </CardHeader>
      <CardContent className="p-5 sm:p-7 pt-0 sm:pt-0">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {offlineMode && (
            <Alert className="border-amber-200 bg-amber-50">
              <WifiOff className="h-4 w-4 text-amber-700" />
              <AlertDescription className="text-amber-800 text-sm">
                Umeingia nje ya mtandao. Ingia tena ukiwa mtandaoni ili kusawazisha na seva.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium">
              Barua Pepe
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                placeholder="Weka barua pepe"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                className="h-11 pl-10 min-h-[44px] border-emerald-200 focus:border-emerald-400 focus:ring-emerald-200"
                autoComplete="email"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium">
              Nenosiri
            </Label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                placeholder="Weka nenosiri"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className="h-11 pl-10 min-h-[44px] border-emerald-200 focus:border-emerald-400 focus:ring-emerald-200"
                autoComplete="current-password"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onSwitchToForgotPassword}
              className="text-sm text-emerald-600 hover:text-emerald-700 font-medium underline underline-offset-2 transition-colors"
            >
              Umesahau Nenosiri?
            </button>
          </div>

          <Button
            type="submit"
            className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold min-h-[44px] shadow-sm hover:shadow transition-all"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Inasubiri...
              </>
            ) : (
              <>
                <LogIn className="mr-2 h-4 w-4" />
                Ingia
              </>
            )}
          </Button>

          <div className="text-center pt-2">
            <p className="text-sm text-muted-foreground">
              Huna Akaunti?{' '}
              <button
                type="button"
                onClick={onSwitchToRegister}
                className="text-emerald-600 hover:text-emerald-700 font-semibold underline underline-offset-2 transition-colors"
              >
                Jisajili
              </button>
            </p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
