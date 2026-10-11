import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { PracticeIcon } from '../../components/practice/PracticeIcon';
import { useAuth } from '../../state/useAuth';
import './account.css';

type Mode = 'signin' | 'signup';
const MIN_PASSWORD = 8;

export function AccountPage() {
  const { user, loading, available, signIn, signUp, signOut } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <EmptyState loading title="One moment…" description="Checking your sign-in." />;
  if (!available) return <EmptyState title="Accounts aren’t available here" description="You can still practice as a guest. Your session lasts until you close this tab." />;
  if (user) return <section className="account account--signed-in">
    <h1 tabIndex={-1}>You’re signed in</h1>
    <p className="muted">{user.email}</p>
    <p className="account-lede">Your sessions are saved to your account, so you can leave and come back to them any time from Home.</p>
    <div className="button-row">
      <Link className="button button--primary" to="/app">Go to your sessions</Link>
      <Button variant="secondary" onClick={() => void signOut().then(() => navigate('/', { viewTransition: true }))}>Sign out</Button>
    </div>
  </section>;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(''); setNotice('');
    if (mode === 'signup' && password.length < MIN_PASSWORD) { setError(`Use at least ${MIN_PASSWORD} characters for your password.`); return; }
    setBusy(true);
    try {
      if (mode === 'signin') { await signIn(email, password); await navigate('/app', { viewTransition: true }); }
      else if (await signUp(email, password) === 'signed-in') await navigate('/app', { viewTransition: true });
      else { setNotice(`We sent a confirmation link to ${email.trim()}. Open it, then come back and sign in.`); setMode('signin'); setPassword(''); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.'); }
    finally { setBusy(false); }
  }

  const signup = mode === 'signup';
  return <section className="account">
    <div className="account-intro">
      <h1 tabIndex={-1}>{signup ? 'Create your account' : 'Welcome back'}</h1>
      <p className="account-lede">{signup ? 'Save your practice sessions and pick them up again whenever you’re ready, on any device.' : 'Sign in to pick up where you left off.'}</p>
      <ul className="account-points">
        <li><PracticeIcon name="check" size={16} />Every session is saved as you go</li>
        <li><PracticeIcon name="check" size={16} />Return to results and your review sheet</li>
        <li><PracticeIcon name="check" size={16} />Practice on any device</li>
      </ul>
    </div>

    <form className="account-card card" onSubmit={(event) => void submit(event)} noValidate aria-labelledby="account-form-title">
      <h2 id="account-form-title" className="sr-only">{signup ? 'Create account' : 'Sign in'}</h2>
      <div className="segmented" role="tablist" aria-label="Account">
        <button type="button" role="tab" aria-selected={!signup} onClick={() => { setMode('signin'); setError(''); }}>Sign in</button>
        <button type="button" role="tab" aria-selected={signup} onClick={() => { setMode('signup'); setError(''); setNotice(''); }}>Create account</button>
      </div>
      {notice && <p className="notice notice--accent" role="status"><PracticeIcon name="info" size={16} />{notice}</p>}
      <div className="field">
        <label className="field-label" htmlFor="account-email">Email</label>
        <input id="account-email" className="input" type="email" autoComplete="email" inputMode="email" required value={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="account-password">Password</label>
        <input id="account-password" className="input" type="password" autoComplete={signup ? 'new-password' : 'current-password'} required minLength={signup ? MIN_PASSWORD : undefined} value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} aria-describedby={signup ? 'account-password-hint' : undefined} />
        {signup && <p id="account-password-hint" className="field-hint">At least {MIN_PASSWORD} characters.</p>}
      </div>
      {error && <p className="form-error" role="alert"><PracticeIcon name="alert" size={16} />{error}</p>}
      <Button type="submit" size="lg" disabled={busy || !email.trim() || !password}>{busy ? <><span className="spinner" aria-hidden="true" />{signup ? 'Creating account…' : 'Signing in…'}</> : signup ? 'Create account' : 'Sign in'}</Button>
      <p className="account-foot muted small">Prefer not to sign in? <Link className="text-link" to="/app">Practice as a guest</Link>. Guest sessions aren’t saved.</p>
    </form>
  </section>;
}
