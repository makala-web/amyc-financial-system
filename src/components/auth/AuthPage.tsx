'use client';

import { useState } from 'react';
import AMYCLogo from '@/components/brand/AMYCLogo';
import LoginForm from './LoginForm';
import RegisterForm from './RegisterForm';
import ForgotPasswordForm from './ForgotPasswordForm';

type AuthView = 'login' | 'register' | 'forgot-password';

export default function AuthPage() {
  const [view, setView] = useState<AuthView>('login');

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-emerald-100 p-3 sm:p-4 relative overflow-hidden">
      {/* Subtle SVG dot pattern background */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23065f46' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
      }} />

      {/* Decorative background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-200/30 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-emerald-300/20 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-1/4 w-60 h-60 bg-emerald-100/40 rounded-full blur-2xl" />
        <div className="absolute bottom-1/3 left-1/4 w-40 h-40 bg-emerald-200/30 rounded-full blur-2xl" />
      </div>

      {/* Logo and Branding */}
      <div className="relative z-10 flex flex-col items-center mb-6 sm:mb-8">
        <div className="w-20 h-20 sm:w-24 sm:h-24 relative mb-3 sm:mb-4 bg-white rounded-2xl shadow-lg p-2 border border-emerald-100">
          <AMYCLogo
            alt="AMYC Logo"
            className="absolute inset-0 h-full w-full object-contain"
          />
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-emerald-800 tracking-tight">
          AMYC
        </h1>
        <p className="text-emerald-600 mt-1 text-center text-sm sm:text-base font-medium">
          Ansaar Muslim Youth Centre
        </p>
        <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-100/80 border border-emerald-200 px-3 py-1">
          <span className="text-emerald-700 text-xs sm:text-sm font-semibold">
            Mfumo wa Fedha
          </span>
        </div>
      </div>

      {/* Form Container */}
      <div className="relative z-10 w-full flex justify-center px-1">
        {view === 'login' && (
          <LoginForm
            onSwitchToRegister={() => setView('register')}
            onSwitchToForgotPassword={() => setView('forgot-password')}
          />
        )}
        {view === 'register' && (
          <RegisterForm onSwitchToLogin={() => setView('login')} />
        )}
        {view === 'forgot-password' && (
          <ForgotPasswordForm onSwitchToLogin={() => setView('login')} />
        )}
      </div>

      {/* Footer */}
      <div className="relative z-10 mt-6 sm:mt-8 text-center">
        <p className="text-xs text-emerald-700/50">
          &copy; {new Date().getFullYear()} AMYC - Ansaar Muslim Youth Centre
        </p>
        <p className="text-[10px] text-emerald-700/30 mt-0.5">
          Mfumo wa Fedha v2.0
        </p>
      </div>
    </div>
  );
}
