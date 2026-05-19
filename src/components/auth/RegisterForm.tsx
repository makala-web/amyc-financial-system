'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  UserPlus,
  AlertCircle,
  Check,
  X,
  Mail,
  Shield,
  Building2,
} from 'lucide-react';
import type { OrgLevel, UserRole } from '@/lib/types';
import { SECURITY_QUESTIONS, validatePasswordStrength } from '@/lib/types';
import { registerLocalOfflineAccount } from '@/lib/auth/local-register';
import { Capacitor } from '@capacitor/core';

interface RegisterFormProps {
  onSwitchToLogin: () => void;
}

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'simple', label: 'Mtumiaji' },
  { value: 'mudir', label: 'Mudir' },
  { value: 'katibu', label: 'Katibu' },
  { value: 'mweka_hazina', label: 'Mwekahazina' },
  { value: 'muhasibu', label: 'Muhasibu' },
];

const ORG_LEVELS: { value: OrgLevel; label: string; parentLabel: string }[] = [
  { value: 'markaz', label: 'Markaz Kuu', parentLabel: '' },
  { value: 'jimbo', label: 'Jimbo', parentLabel: '' },
  { value: 'tawi', label: 'Tawi', parentLabel: 'Jimbo' },
];

// Password criteria labels in Swahili
const PASSWORD_CRITERIA_LABELS = [
  { key: 'length', label: 'Herufi 8+' },
  { key: 'uppercase', label: 'Herufi kubwa (A-Z)' },
  { key: 'lowercase', label: 'Herufi ndogo (a-z)' },
  { key: 'number', label: 'Namba (0-9)' },
  { key: 'special', label: 'Herufi maalum (!@#$%...)' },
];

function checkPasswordCriteria(password: string) {
  return {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function RegisterForm({ onSwitchToLogin }: RegisterFormProps) {
  // Personal info
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [securityQuestion, setSecurityQuestion] = useState('');
  const [securityAnswer, setSecurityAnswer] = useState('');

  // Org fields - simple typing, no dropdowns
  const [orgLevel, setOrgLevel] = useState<OrgLevel | ''>('');
  const [parentName, setParentName] = useState(''); // e.g. name of Jimbo (for Tawi) or Markaz (for Jimbo)
  const [orgName, setOrgName] = useState(''); // e.g. name of own Tawi/Jimbo/Markaz

  // UI state
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // Password criteria real-time check
  const passwordCriteria = useMemo(() => checkPasswordCriteria(password), [password]);
  const passwordValidation = useMemo(() => validatePasswordStrength(password), [password]);

  const selectedLevel = ORG_LEVELS.find((l) => l.value === orgLevel);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // --- Validation ---
    if (!fullName.trim()) {
      setError('Tafadhali jaza jina kamili.');
      return;
    }
    if (!username.trim()) {
      setError('Tafadhali jaza jina la mtumiaji.');
      return;
    }
    if (username.trim().length < 3) {
      setError('Jina la mtumiaji lazima liwe na herufi 3 au zaidi.');
      return;
    }
    if (!email.trim()) {
      setError('Tafadhali jaza barua pepe.');
      return;
    }
    if (!isValidEmail(email.trim())) {
      setError('Muundo wa barua pepe si sahihi.');
      return;
    }
    if (!password) {
      setError('Tafadhali jaza nenosiri.');
      return;
    }
    if (!passwordValidation.valid) {
      setError('Nenosiri halikidhi vigezo vyote vya usalama.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Nenosiri na uthibitisho wa nenosiri havifanani.');
      return;
    }
    if (!role) {
      setError('Tafadhali chagua nafasi yako.');
      return;
    }
    if (!securityQuestion) {
      setError('Tafadhali chagua swali la usalama.');
      return;
    }
    if (!securityAnswer.trim()) {
      setError('Tafadhali jaza jibu la swali la usalama.');
      return;
    }
    if (!orgLevel) {
      setError('Tafadhali chagua ngazi ya taasisi.');
      return;
    }

    // For Jimbo: parent Markaz name is optional; default is Markaz Kuu.
    // For Tawi: must provide Jimbo name.
    if (orgLevel === 'tawi' && !parentName.trim()) {
      setError(`Tafadhali jaza jina la ${selectedLevel?.parentLabel || 'taasisi mzazi'}.`);
      return;
    }

    // Must provide own org name
    if (!orgName.trim()) {
      setError(`Tafadhali jaza jina la ${selectedLevel?.label || 'taasisi'}.`);
      return;
    }

    setLoading(true);

    try {
      const payload = {
        fullName: fullName.trim(),
        username: username.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
        password,
        role: role as UserRole,
        orgLevel: orgLevel as OrgLevel,
        orgName: orgName.trim(),
        parentName: parentName.trim(),
        securityQuestion,
        securityAnswer: securityAnswer.trim(),
      };

      if (Capacitor.isNativePlatform() || !navigator.onLine) {
        await registerLocalOfflineAccount(payload);
        setSuccess('Akaunti imeundwa kwenye kifaa hiki. Unaweza kuingia offline sasa.');
        setTimeout(onSwitchToLogin, 1200);
        return;
      }

      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        setError(result.message || 'Usajili umeshindikana. Jaribu tena.');
        setLoading(false);
        return;
      }

      // Success - switch to login
      onSwitchToLogin();
    } catch (err) {
      console.error('Registration error:', err);
      try {
        await registerLocalOfflineAccount({
          fullName: fullName.trim(),
          username: username.trim().toLowerCase(),
          email: email.trim().toLowerCase(),
          password,
          role: role as UserRole,
          orgLevel: orgLevel as OrgLevel,
          orgName: orgName.trim(),
          parentName: parentName.trim(),
          securityQuestion,
          securityAnswer: securityAnswer.trim(),
        });
        setSuccess('Seva haikupatikana, lakini akaunti imeundwa local kwenye kifaa hiki.');
        setTimeout(onSwitchToLogin, 1200);
      } catch (localError) {
        setError(localError instanceof Error ? localError.message : 'Kuna hitilafu iliyotokea. Jaribu tena.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-lg shadow-xl border-0 mx-2 sm:mx-0 overflow-hidden">
      {/* Green gradient top bar */}
      <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-400" />

      <CardHeader className="text-center pb-2 p-4 sm:p-6">
        {/* AMYC Logo in form */}
        <div className="mx-auto mb-3 w-12 h-12 sm:w-14 sm:h-14 relative bg-emerald-50 rounded-xl border border-emerald-100 p-1 shadow-sm">
          <Image
            src="/logo-amyc.png"
            alt="AMYC Logo"
            fill
            className="object-contain"
            priority
          />
        </div>
        <CardTitle className="text-xl sm:text-2xl font-bold text-emerald-800">
          Jisajili
        </CardTitle>
        <CardDescription className="text-muted-foreground text-sm mt-1">
          Unda akaunti yako mpya ya AMYC
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0">
        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {success && (
            <Alert className="mb-4 border-emerald-200 bg-emerald-50 text-emerald-800">
              <Check className="h-4 w-4" />
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          {/* === Section 1: Taarifa za Kibinafsi === */}
          <div>
            <h3 className="text-sm font-semibold text-emerald-700 mb-3 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                1
              </span>
              Taarifa za Kibinafsi
            </h3>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="fullName" className="text-sm font-medium">
                  Jina Kamili
                </Label>
                <Input
                  id="fullName"
                  type="text"
                  placeholder="Weka jina lako kamili"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  disabled={loading}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg-username" className="text-sm font-medium">
                  Jina la Mtumiaji
                </Label>
                <Input
                  id="reg-username"
                  type="text"
                  placeholder="Weka jina la mtumiaji"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  className="h-11"
                  autoComplete="username"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg-email" className="text-sm font-medium">
                  <span className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" />
                    Barua Pepe
                  </span>
                </Label>
                <Input
                  id="reg-email"
                  type="email"
                  placeholder="mfano@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  className="h-11"
                  autoComplete="email"
                />
                {email && !isValidEmail(email) && (
                  <p className="text-xs text-red-500 mt-1">Muundo wa barua pepe si sahihi</p>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* === Section 2: Nenosiri === */}
          <div>
            <h3 className="text-sm font-semibold text-emerald-700 mb-3 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                2
              </span>
              Nenosiri
            </h3>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="reg-password" className="text-sm font-medium">
                  Nenosiri
                </Label>
                <Input
                  id="reg-password"
                  type="password"
                  placeholder="Weka nenosiri imara"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  className="h-11"
                  autoComplete="new-password"
                />
              </div>

              {/* Password strength checklist */}
              {password.length > 0 && (
                <div className="rounded-lg border bg-gray-50 p-3 space-y-1.5">
                  <p className="text-xs font-semibold text-gray-600 mb-2">Vigezo vya nenosiri:</p>
                  {PASSWORD_CRITERIA_LABELS.map((criterion) => {
                    const met = passwordCriteria[criterion.key as keyof typeof passwordCriteria];
                    return (
                      <div key={criterion.key} className="flex items-center gap-2">
                        {met ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <X className="h-3.5 w-3.5 text-red-400 shrink-0" />
                        )}
                        <span
                          className={`text-xs ${
                            met ? 'text-emerald-700 font-medium' : 'text-gray-500'
                          }`}
                        >
                          {criterion.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword" className="text-sm font-medium">
                  Thibitisha Nenosiri
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Weka nenosiri tena"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  className="h-11"
                  autoComplete="new-password"
                />
                {confirmPassword && password !== confirmPassword && (
                  <p className="text-xs text-red-500 mt-1">Nenosiri hazifanani</p>
                )}
                {confirmPassword && password === confirmPassword && (
                  <p className="text-xs text-emerald-600 mt-1">Nenosiri zinafanana ✓</p>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* === Section 3: Swali la Usalama === */}
          <div>
            <h3 className="text-sm font-semibold text-emerald-700 mb-3 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                3
              </span>
              <Shield className="h-4 w-4" />
              Swali la Usalama
            </h3>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Swali la Usalama</Label>
                <Select
                  value={securityQuestion}
                  onValueChange={setSecurityQuestion}
                  disabled={loading}
                >
                  <SelectTrigger className="w-full h-11">
                    <SelectValue placeholder="Chagua swali la usalama" />
                  </SelectTrigger>
                  <SelectContent>
                    {SECURITY_QUESTIONS.map((q) => (
                      <SelectItem key={q} value={q}>
                        {q}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="securityAnswer" className="text-sm font-medium">
                  Jibu la Swali
                </Label>
                <Input
                  id="securityAnswer"
                  type="text"
                  placeholder="Weka jibu la swali la usalama"
                  value={securityAnswer}
                  onChange={(e) => setSecurityAnswer(e.target.value)}
                  disabled={loading}
                  className="h-11"
                />
                <p className="text-xs text-muted-foreground">
                  Jibu hili litatumika kurejesha nenosiri ukilisahau
                </p>
              </div>
            </div>
          </div>

          <Separator />

          {/* === Section 4: Taasisi na Nafasi (OFFLINE FLOW) === */}
          <div>
            <h3 className="text-sm font-semibold text-emerald-700 mb-3 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                4
              </span>
              <Building2 className="h-4 w-4" />
              Taasisi na Nafasi
            </h3>
            <div className="space-y-3">
              {/* Role */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Nafasi</Label>
                <Select
                  value={role}
                  onValueChange={(val) => setRole(val as UserRole)}
                  disabled={loading}
                >
                  <SelectTrigger className="w-full h-11">
                    <SelectValue placeholder="Chagua nafasi" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Org Level */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Ngazi ya Taasisi</Label>
                <Select
                  value={orgLevel}
                  onValueChange={(val) => {
                    setOrgLevel(val as OrgLevel);
                    setParentName('');
                    // Autofill orgName for Markaz since there's only one
                    if (val === 'markaz') {
                      setOrgName('Markaz Kuu');
                    } else {
                      setOrgName('');
                    }
                  }}
                  disabled={loading}
                >
                  <SelectTrigger className="w-full h-11">
                    <SelectValue placeholder="Chagua ngazi" />
                  </SelectTrigger>
                  <SelectContent>
                    {ORG_LEVELS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* OFFLINE FLOW: Type parent name and own name */}
              {orgLevel && (
                <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50 p-4 space-y-4">
                  {/* Info banner */}
                  <div className="flex items-start gap-2 text-emerald-800">
                    <Building2 className="h-5 w-5 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold">
                        Usajili wa {selectedLevel?.label}
                      </p>
                      <p className="text-xs text-emerald-700 mt-0.5">
                        Andika jina la taasisi yako. Mfumo utaunda moja kwa moja kama haipo.
                      </p>
                    </div>
                  </div>

                  {/* For Jimbo: ask for optional Markaz name */}
                  {/* For Tawi: ask for Jimbo name */}
                  {(orgLevel === 'jimbo' || orgLevel === 'tawi') && (
                    <div className="space-y-1.5">
                      <Label className="text-sm font-semibold text-amber-800">
                        Jina la {orgLevel === 'jimbo' ? 'Markaz Kuu' : selectedLevel?.parentLabel} (Mzazi)
                      </Label>
                      <Input
                        type="text"
                        placeholder={orgLevel === 'jimbo' ? 'Markaz Kuu' : `Weka jina la ${selectedLevel?.parentLabel} lako`}
                        value={parentName}
                        onChange={(e) => setParentName(e.target.value)}
                        disabled={loading}
                        className="h-11 border-amber-300 bg-white focus:border-amber-500"
                      />
                      <p className="text-xs text-amber-700">
                        {orgLevel === 'jimbo'
                          ? 'Ukiiacha wazi, mfumo utatumia Markaz Kuu'
                          : 'Andika jina la Jimbo ambapo Tawi lako linahusishwa'}
                      </p>
                    </div>
                  )}

                  {/* Own org name */}
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold text-emerald-800">
                      Jina la {selectedLevel?.label} lako
                    </Label>
                    <Input
                      type="text"
                      placeholder={`Weka jina la ${selectedLevel?.label} yako`}
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      disabled={loading}
                      className="h-11 border-emerald-300 bg-white focus:border-emerald-500"
                    />
                    {orgLevel === 'markaz' && (
                      <p className="text-xs text-emerald-700">
                        Andika jina la Markaz Kuu yako
                      </p>
                    )}
                    {orgLevel === 'jimbo' && (
                      <p className="text-xs text-emerald-700">
                        Andika jina la Jimbo lako
                      </p>
                    )}
                    {orgLevel === 'tawi' && (
                      <p className="text-xs text-emerald-700">
                        Andika jina la Tawi lako
                      </p>
                    )}
                  </div>

                  {/* Preview summary */}
                  {orgName.trim() && (orgLevel !== 'tawi' || parentName.trim()) && (
                    <div className="rounded-md border border-emerald-300 bg-white p-3 text-sm">
                      <p className="font-semibold text-emerald-800 mb-1">Muhtasari wa Taasisi:</p>
                      {orgLevel === 'markaz' && (
                        <p className="text-emerald-700">
                          🏛️ <strong>{orgName.trim()}</strong> — Markaz Kuu
                        </p>
                      )}
                      {orgLevel === 'jimbo' && (
                        <>
                          <p className="text-amber-700">
                            🏛️ <strong>{parentName.trim() || 'Markaz Kuu'}</strong> — Markaz Kuu
                          </p>
                          <p className="text-emerald-700 ml-4">
                            └─ 🏢 <strong>{orgName.trim()}</strong> — Jimbo
                          </p>
                        </>
                      )}
                      {orgLevel === 'tawi' && (
                        <>
                          <p className="text-amber-700">
                            🏢 <strong>{parentName.trim()}</strong> — Jimbo
                          </p>
                          <p className="text-emerald-700 ml-4">
                            └─ 🌿 <strong>{orgName.trim()}</strong> — Tawi
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Submit */}
          <Button
            type="submit"
            className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Inasajili...
              </>
            ) : (
              <>
                <UserPlus className="mr-2 h-4 w-4" />
                Jisajili
              </>
            )}
          </Button>

          <div className="text-center pt-1">
            <p className="text-sm text-muted-foreground">
              Tayari una akaunti?{' '}
              <button
                type="button"
                onClick={onSwitchToLogin}
                className="text-emerald-600 hover:text-emerald-700 font-semibold underline underline-offset-2"
              >
                Ingia
              </button>
            </p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
