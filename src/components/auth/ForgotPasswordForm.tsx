'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Mail, KeyRound, ShieldCheck, ArrowLeft, CheckCircle2, XCircle, Check, X } from 'lucide-react';
import { db, verifyPassword, hashPassword, findUserByEmail } from '@/lib/db-offline';
import { validatePasswordStrength, SECURITY_QUESTIONS } from '@/lib/types';
import type { User } from '@/lib/types';

interface ForgotPasswordFormProps {
  onSwitchToLogin: () => void;
}

export default function ForgotPasswordForm({ onSwitchToLogin }: ForgotPasswordFormProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState('');
  const [foundUser, setFoundUser] = useState<User | null>(null);
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Password criteria checks for real-time feedback
  const passwordChecks = useMemo(() => {
    const checks = [
      { label: 'Herufi 8+', met: newPassword.length >= 8 },
      { label: 'Herufi kubwa (A-Z)', met: /[A-Z]/.test(newPassword) },
      { label: 'Herufi ndogo (a-z)', met: /[a-z]/.test(newPassword) },
      { label: 'Namba (0-9)', met: /[0-9]/.test(newPassword) },
      { label: 'Herufi maalum (!@#$%...)', met: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword) },
    ];
    return checks;
  }, [newPassword]);

  // Step 1: Find user by email
  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Tafadhali weka barua pepe yako.');
      return;
    }

    setLoading(true);
    try {
      const user = await findUserByEmail(email);
      if (!user) {
        setError('Barua pepe hii haipo kwenye mfumo');
        setLoading(false);
        return;
      }
      setFoundUser(user);
      setStep(2);
    } catch (err) {
      console.error('Find user error:', err);
      setError('Kuna hitilafu iliyotokea. Jaribu tena.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify security answer
  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!securityAnswer.trim()) {
      setError('Tafadhali jaza jibu la swali la usalama.');
      return;
    }

    setLoading(true);
    try {
      const isCorrect = await verifyPassword(securityAnswer, foundUser!.securityAnswer);
      if (!isCorrect) {
        setError('Jibu si sahihi. Jaribu tena');
        setLoading(false);
        return;
      }
      setStep(3);
    } catch (err) {
      console.error('Verify answer error:', err);
      setError('Kuna hitilafu iliyotokea. Jaribu tena.');
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Set new password
  const handleStep3Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!newPassword.trim() || !confirmPassword.trim()) {
      setError('Tafadhali jaza nyeneno zote za nenosiri.');
      return;
    }

    const strengthResult = validatePasswordStrength(newPassword);
    if (!strengthResult.valid) {
      setError('Nenosiri si imara kutosha. Angalia vigezo hapa chini.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Nenosiri halilingani. Jaribu tena.');
      return;
    }

    setLoading(true);
    try {
      const hashedNewPassword = await hashPassword(newPassword);
      await db.users.update(foundUser!.id!, {
        password: hashedNewPassword,
        updatedAt: new Date().toISOString(),
      });
      setSuccess(true);
      // Auto-redirect to login after 3 seconds
      setTimeout(() => {
        onSwitchToLogin();
      }, 3000);
    } catch (err) {
      console.error('Password update error:', err);
      setError('Kuna hitilafu iliyotokea wakati wa kubadilisha nenosiri. Jaribu tena.');
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    setError('');
    if (step === 1) {
      onSwitchToLogin();
    } else if (step === 2) {
      setStep(1);
      setSecurityAnswer('');
    } else if (step === 3) {
      setStep(2);
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  // Success screen
  if (success) {
    return (
      <Card className="w-full max-w-md shadow-xl border-0 overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-400" />
        <CardContent className="pt-8 pb-8">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
            <h2 className="text-xl font-bold text-emerald-800">
              Nenosiri Limebadilishwa!
            </h2>
            <p className="text-muted-foreground text-sm">
              Nenosiri lako limebadilishwa kwa mafanikio. Sasa unaweza kuingia kwenye akaunti yako kwa nenosiri jipya.
            </p>
            <Button
              onClick={onSwitchToLogin}
              className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              Elekea kwenye Ukurasa wa Kuingia
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md shadow-xl border-0 overflow-hidden">
      {/* Green gradient top bar */}
      <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-400" />

      <CardHeader className="text-center pb-2 p-5 sm:p-7">
        {/* AMYC Logo */}
        <div className="mx-auto mb-3 w-12 h-12 sm:w-14 sm:h-14 relative bg-emerald-50 rounded-xl border border-emerald-100 p-1 shadow-sm">
          <Image
            src="/logo-amyc.png"
            alt="AMYC Logo"
            fill
            className="object-contain"
            priority
          />
        </div>
        <CardTitle className="text-2xl font-bold text-emerald-800">
          {step === 1 && 'Kurejesha Nenosiri'}
          {step === 2 && 'Swali la Usalama'}
          {step === 3 && 'Weka Nenosiri Jipya'}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {step === 1 && 'Weka barua pepe yako ili kupata akaunti yako'}
          {step === 2 && 'Jibu swali la usalama kuthibitisha utambulisho wako'}
          {step === 3 && 'Weka nenosiri jipya la siri'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  s < step
                    ? 'bg-emerald-600 text-white'
                    : s === step
                    ? 'bg-emerald-600 text-white ring-2 ring-emerald-200'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {s < step ? <Check className="h-4 w-4" /> : s}
              </div>
              {s < 3 && (
                <div
                  className={`h-0.5 w-8 transition-colors ${
                    s < step ? 'bg-emerald-600' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Enter Email */}
        {step === 1 && (
          <form onSubmit={handleStep1Submit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="forgot-email" className="text-sm font-medium">
                Barua Pepe
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="Weka barua pepe yako"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  className="h-11 pl-10"
                  autoComplete="email"
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Inatafuta...
                </>
              ) : (
                'Endelea'
              )}
            </Button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={onSwitchToLogin}
                className="text-sm text-emerald-600 hover:text-emerald-700 font-medium inline-flex items-center gap-1 transition-colors"
              >
                <ArrowLeft className="h-3 w-3" />
                Rudi kwenye Ukurasa wa Kuingia
              </button>
            </div>
          </form>
        )}

        {/* Step 2: Answer Security Question */}
        {step === 2 && (
          <form onSubmit={handleStep2Submit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Swali la Usalama
              </Label>
              <div className="h-11 px-3 flex items-center rounded-md border bg-muted/50 text-sm text-foreground">
                {foundUser?.securityQuestion}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="security-answer" className="text-sm font-medium">
                Jibu lako
              </Label>
              <Input
                id="security-answer"
                type="text"
                placeholder="Weka jibu la swali la usalama"
                value={securityAnswer}
                onChange={(e) => setSecurityAnswer(e.target.value)}
                disabled={loading}
                className="h-11"
                autoComplete="off"
              />
            </div>

            <Button
              type="submit"
              className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Inathibitisha...
                </>
              ) : (
                'Thibitisha Jibu'
              )}
            </Button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={goBack}
                className="text-sm text-emerald-600 hover:text-emerald-700 font-medium inline-flex items-center gap-1 transition-colors"
              >
                <ArrowLeft className="h-3 w-3" />
                Rudi nyuma
              </button>
            </div>
          </form>
        )}

        {/* Step 3: Set New Password */}
        {step === 3 && (
          <form onSubmit={handleStep3Submit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="new-password" className="text-sm font-medium">
                Nenosiri Jipya
              </Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="new-password"
                  type="password"
                  placeholder="Weka nenosiri jipya"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={loading}
                  className="h-11 pl-10"
                  autoComplete="new-password"
                />
              </div>
            </div>

            {/* Password Strength Criteria Checklist */}
            {newPassword.length > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground mb-2">
                  Vigezo vya Nenosiri:
                </p>
                {passwordChecks.map((check) => (
                  <div key={check.label} className="flex items-center gap-2 text-xs">
                    {check.met ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                    )}
                    <span className={check.met ? 'text-emerald-700 font-medium' : 'text-muted-foreground'}>
                      {check.label}
                    </span>
                    <span className="ml-auto">
                      {check.met ? (
                        <span className="text-emerald-600 font-bold">&#10003;</span>
                      ) : (
                        <span className="text-red-400 font-bold">&#10007;</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="confirm-password" className="text-sm font-medium">
                Thibitisha Nenosiri
              </Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="Weka tena nenosiri jipya"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  className="h-11 pl-10"
                  autoComplete="new-password"
                />
              </div>
              {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                <p className="text-xs text-red-500 font-medium">Nenosiri halilingani</p>
              )}
              {confirmPassword.length > 0 && newPassword === confirmPassword && (
                <p className="text-xs text-emerald-600 font-medium">Nenosiri linalingana &#10003;</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Inahifadhi...
                </>
              ) : (
                'Badilisha Nenosiri'
              )}
            </Button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={goBack}
                className="text-sm text-emerald-600 hover:text-emerald-700 font-medium inline-flex items-center gap-1 transition-colors"
              >
                <ArrowLeft className="h-3 w-3" />
                Rudi nyuma
              </button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
