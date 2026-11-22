import { ReactFlowProvider } from '@xyflow/react';
import { ArrowRight, CheckCircle2, Eye, EyeOff, Globe2, Lightbulb, LockKeyhole, Mail, Sparkles, StickyNote, User as UserIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import WorkspacePage from '../pages/WorkspacePage';
import DashboardPage from '../pages/DashboardPage';
import { api, ApiError, listWorkspaces } from './api';
import type { User, Workspace } from './api';
import { PreferencesProvider, usePreferences } from './Preferences';

function AppContent() {
  const { locale, setLocale, t } = usePreferences();
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [initialTaskId, setInitialTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [register, setRegister] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const workspacesRef = useRef(workspaces);
  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  useEffect(() => {
    const syncLocation = () => {
      const match = window.location.hash.match(/^#\/workspaces\/([^?]+)(?:\?(.*))?$/);
      const targetWsId = match?.[1] ?? null;
      if (targetWsId) {
        if (workspacesRef.current.length > 0 && !workspacesRef.current.some((w) => w.id === targetWsId)) {
          setWorkspaceId(null);
          setInitialTaskId(null);
          setError(t('accessDeniedWorkspace'));
          window.location.hash = '/dashboard';
          return;
        }
        setWorkspaceId(targetWsId);
        setInitialTaskId(new URLSearchParams(match?.[2]).get('task'));
      } else {
        setWorkspaceId(null);
        setInitialTaskId(null);
      }
    };
    window.addEventListener('hashchange', syncLocation);
    return () => window.removeEventListener('hashchange', syncLocation);
  }, [t]);

  // Form input state for controlled management and validation
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authDisplayName, setAuthDisplayName] = useState('');

  useEffect(() => {
    const activeWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);
    document.title = user
      ? `CollabCanvas · ${activeWorkspace?.name ?? t('dashboardTitle')}`
      : 'CollabCanvas';
  }, [user, workspaceId, workspaces, t]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const me = await api<User>('/auth/me');
        if (!active) return;
        setUser(me);
        const items = await listWorkspaces();
        if (!active) return;
        setWorkspaces(items);
        const match = window.location.hash.match(/^#\/workspaces\/([^?]+)(?:\?(.*))?$/);
        const targetWorkspaceId = match?.[1];
        if (targetWorkspaceId && items.some((item) => item.id === targetWorkspaceId)) {
          setWorkspaceId(targetWorkspaceId);
          setInitialTaskId(new URLSearchParams(match?.[2]).get('task'));
        } else {
          setWorkspaceId(null);
          setInitialTaskId(null);
          if (targetWorkspaceId) {
            setError(t('accessDeniedWorkspace'));
            window.location.hash = '/dashboard';
          }
        }
      } catch (cause) {
        if (!active) return;
        if (!(cause instanceof ApiError) || cause.status !== 401) {
          setError(t('loadFailed'));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [t]);

  const handleWorkspaceChange = (id: string, taskId?: string) => {
    setWorkspaceId(id);
    setInitialTaskId(taskId ?? null);
    window.location.hash = `/workspaces/${id}${taskId ? `?task=${taskId}` : ''}`;
  };

  const openDashboard = (view?: 'account' | 'invitations' | 'workspaces' | 'tasks') => {
    setWorkspaceId(null);
    setInitialTaskId(null);
    window.location.hash = view ? `/dashboard?view=${view}` : '/dashboard';
  };

  const refreshWorkspaces = async () => {
    try {
      const items = await listWorkspaces();
      setWorkspaces(items);
      setError('');
      if (workspaceId && !items.some((item) => item.id === workspaceId)) openDashboard();
    } catch {
      setError(t('loadFailed'));
    }
  };

  const handleWorkspaceAccessRevoked = async () => {
    openDashboard();
    try {
      setWorkspaces(await listWorkspaces());
    } catch {
      // Navigation remains safe even when the dashboard cannot refresh immediately.
    }
    setError(t('accessDeniedWorkspace'));
  };

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
      setUser(null);
      setWorkspaces([]);
      openDashboard();
    } catch {
      setError(t('loadFailed'));
    }
  };

  async function authenticate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = authEmail.trim().toLowerCase();
    const password = authPassword;
    const displayName = authDisplayName.trim();

    if (!email || !password) {
      setError(locale === 'vi' ? 'Vui lòng điền đầy đủ email và mật khẩu.' : 'Please enter email and password.');
      return;
    }
    if (register && !displayName) {
      setError(locale === 'vi' ? 'Vui lòng nhập họ và tên của bạn.' : 'Please enter your display name.');
      return;
    }
    if (password.length < 12) {
      setError(locale === 'vi' ? 'Mật khẩu phải chứa ít nhất 12 ký tự để đảm bảo an toàn.' : 'Password must be at least 12 characters.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const me = await api<User>(register ? '/auth/register' : '/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          ...(register ? { displayName } : {}),
        }),
      });
      setUser(me);
      const items = await listWorkspaces();
      setWorkspaces(items);

      const match = window.location.hash.match(/^#\/workspaces\/([^?]+)(?:\?(.*))?$/);
      const targetWorkspaceId = match?.[1];
      const targetTaskId = new URLSearchParams(match?.[2]).get('task');

      if (targetWorkspaceId && items.some((item) => item.id === targetWorkspaceId)) {
        handleWorkspaceChange(targetWorkspaceId, targetTaskId ?? undefined);
      } else {
        if (targetWorkspaceId) {
          setError(t('accessDeniedWorkspace'));
        }
        openDashboard();
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError(locale === 'vi' ? 'Email hoặc mật khẩu không chính xác.' : 'Invalid email or password.');
        } else if (err.status === 409) {
          setError(locale === 'vi' ? 'Email này đã được đăng ký tài khoản. Vui lòng đăng nhập.' : 'This email is already registered.');
        } else if (err.status === 400) {
          setError(locale === 'vi' ? 'Thông tin đăng ký không hợp lệ (mật khẩu tối thiểu 12 ký tự).' : 'Invalid input format.');
        } else {
          setError(locale === 'vi' ? 'Không thể kết nối đến máy chủ.' : 'Authentication error.');
        }
      } else {
        setError(locale === 'vi' ? 'Đã xảy ra lỗi, vui lòng thử lại.' : 'An error occurred.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-surface flex flex-col items-center justify-center gap-3 text-on-surface">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-primary to-primary-container flex items-center justify-center shadow-lg animate-pulse">
          <span className="material-symbols-outlined text-on-primary text-[26px]">draw</span>
        </div>
        <span className="text-sm font-semibold text-primary">{t('loading')}</span>
      </main>
    );
  }

  // ================= 1. AUTH SCREEN (LOGIN / REGISTER) =================
  if (!user) {
    return (
      <main className="auth-shell">
        {/* Left Side: Showcase Visuals */}
        <section className="auth-showcase" aria-label="CollabCanvas">
          <div className="auth-showcase-top">
            <span className="auth-live">
              <span />
              {t('authLive')}
            </span>
            <div className="auth-avatars" aria-hidden="true">
              <i>MH</i>
              <i>AN</i>
              <i>LT</i>
            </div>
          </div>
          <div className="auth-demo" aria-hidden="true">
            <div className="auth-demo-halo" />
            <div className="auth-demo-line line-one" />
            <div className="auth-demo-line line-two" />
            <div className="auth-demo-note">
              <span>
                <Lightbulb size={13} />
                {t('authIdea')}
              </span>
              <strong>{t('authIdeaTitle')}</strong>
              <p>{t('authIdeaBody')}</p>
              <small>{t('authSprint')}</small>
            </div>
            <div className="auth-demo-person person-one">{t('authPersonOne')}</div>
            <div className="auth-demo-person person-two">{t('authPersonTwo')}</div>
            <div className="auth-demo-person person-three">{t('authPersonThree')}</div>
            <div className="auth-demo-note auth-demo-note-secondary">
              <span>
                <StickyNote size={13} />
                {t('authSprintNote')}
              </span>
              <strong>{t('authSprintTitle')}</strong>
              <p>{t('authSprintBody')}</p>
            </div>
            <div className="auth-demo-board">
              <span>{t('authBoard')}</span>
              <div />
              <section>
                <i>
                  <StickyNote size={16} />
                </i>
                <i>
                  <span className="material-symbols-outlined text-[16px]">view_kanban</span>
                </i>
                <i>
                  <Sparkles size={16} />
                </i>
              </section>
            </div>
            <div className="auth-demo-toolbar">
              <span>
                <span className="material-symbols-outlined text-[15px]">draw</span>
              </span>
              <span>
                <StickyNote size={15} />
              </span>
              <span>
                <Sparkles size={15} />
              </span>
            </div>
          </div>
          <div className="auth-showcase-caption">
            <Sparkles size={18} />
            <p>{t('authQuote')}</p>
          </div>
        </section>

        {/* Right Side: Auth Form */}
        <section className="auth-form-side">
          <div className="auth-form-head">
            <div className="auth-brand flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary to-primary-container flex items-center justify-center shadow-[0_4px_16px_rgba(107,216,203,0.3)] ring-1 ring-primary/40">
                <span className="material-symbols-outlined text-on-primary text-[22px] font-bold">draw</span>
              </div>
              <div>
                <strong className="flex items-center gap-1.5 text-white font-extrabold text-[16px]">
                  CollabCanvas <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                </strong>
                <small className="text-on-surface-variant font-medium text-[11px]">Team Workspace</small>
              </div>
            </div>
            <button
              className="auth-language"
              type="button"
              aria-label={t('language')}
              onClick={() => setLocale(locale === 'vi' ? 'en' : 'vi')}
            >
              <Globe2 size={14} />
              {locale.toUpperCase()}
            </button>
          </div>

          <div className="auth-form-wrap">
            {/* Tabs */}
            <div className="auth-tabs" role="tablist" aria-label={t('authAccount')}>
              <button
                type="button"
                role="tab"
                aria-selected={!register}
                className={!register ? 'active' : ''}
                onClick={() => {
                  setRegister(false);
                  setError('');
                }}
              >
                {t('login')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={register}
                className={register ? 'active' : ''}
                onClick={() => {
                  setRegister(true);
                  setError('');
                }}
              >
                {t('register')}
              </button>
            </div>

            <h1>{register ? t('authWelcomeNew') : t('authWelcomeBack')}</h1>
            <p className="auth-subtitle">{register ? t('authRegisterIntro') : t('authLoginIntro')}</p>

            <form className="auth-form" onSubmit={authenticate}>
              {register && (
                <div className="auth-field">
                  <label htmlFor="display-name">{t('displayName')}</label>
                  <div className="auth-input">
                    <UserIcon size={18} />
                    <input
                      id="display-name"
                      name="displayName"
                      required
                      maxLength={120}
                      autoComplete="name"
                      placeholder="Minh Anh, Quốc Bảo..."
                      value={authDisplayName}
                      onChange={(e) => setAuthDisplayName(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div className="auth-field">
                <label htmlFor="email">{t('authWorkEmail')}</label>
                <div className="auth-input">
                  <Mail size={18} />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="name@example.com"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="auth-field">
                <div className="flex items-center justify-between">
                  <label htmlFor="password">{t('password')}</label>
                  {register && (
                    <span className="text-[11px] text-on-surface-variant font-mono">
                      {authPassword.length}/12+ ký tự
                    </span>
                  )}
                </div>
                <div className="auth-input">
                  <LockKeyhole size={18} />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={register ? 'new-password' : 'current-password'}
                    required
                    minLength={12}
                    maxLength={128}
                    placeholder="••••••••••••"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? t('authHidePassword') : t('authShowPassword')}
                    title={showPassword ? t('authHidePassword') : t('authShowPassword')}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {register && (
                  <small className="auth-field-hint flex items-center gap-1">
                    <CheckCircle2 size={12} className={authPassword.length >= 12 ? 'text-primary' : 'text-slate-500'} />
                    {locale === 'vi' ? 'Tối thiểu 12 ký tự để bảo mật cao' : 'At least 12 characters required'}
                  </small>
                )}
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px]">error</span>
                  <span>{error}</span>
                </div>
              )}

              {/* Quick test accounts helper chips */}
              {!register && (
                <div className="flex items-center gap-2 text-[11px] text-on-surface-variant pt-1">
                  <span>Tài khoản mẫu:</span>
                  <button
                    type="button"
                    className="px-2 py-0.5 rounded bg-surface-container border border-outline-variant/40 hover:border-primary text-slate-300 transition-colors"
                    onClick={() => {
                      setAuthEmail('designer@collabcanvas.io');
                      setAuthPassword('Password123!@#');
                    }}
                  >
                    Minh Anh
                  </button>
                  <button
                    type="button"
                    className="px-2 py-0.5 rounded bg-surface-container border border-outline-variant/40 hover:border-primary text-slate-300 transition-colors"
                    onClick={() => {
                      setAuthEmail('dev@collabcanvas.io');
                      setAuthPassword('Password123!@#');
                    }}
                  >
                    Quốc Bảo
                  </button>
                </div>
              )}

              <button className="auth-submit" type="submit" disabled={busy}>
                {busy ? t('loading') : register ? t('authCreateAccount') : t('authEnterCanvas')}
                <ArrowRight size={18} />
              </button>
            </form>

            <p className="auth-switch">
              {register ? t('authHaveAccount') : t('authNoAccount')}{' '}
              <button
                type="button"
                onClick={() => {
                  setRegister(!register);
                  setError('');
                }}
              >
                {register ? t('login') : t('authRegisterFree')}
              </button>
            </p>
          </div>

          <p className="auth-footer">CollabCanvas · {t('authPrivateWorkspace')}</p>
        </section>
      </main>
    );
  }

  const currentWorkspace = workspaces.find((item) => item.id === workspaceId);

  if (!currentWorkspace) {
    return (
      <DashboardPage
        user={user}
        workspaces={workspaces}
        error={error}
        onOpenWorkspace={handleWorkspaceChange}
        onRefresh={refreshWorkspaces}
        onCreated={(workspace) => {
          const next = [workspace, ...workspacesRef.current.filter((item) => item.id !== workspace.id)];
          workspacesRef.current = next;
          setWorkspaces(next);
          handleWorkspaceChange(workspace.id);
        }}
        onLogout={() => void logout()}
        onUserUpdate={setUser}
      />
    );
  }

  return (
    <ReactFlowProvider>
      <WorkspacePage
        key={currentWorkspace.id}
        workspace={currentWorkspace}
        user={user}
        workspaces={workspaces}
        onWorkspaceChange={handleWorkspaceChange}
        onDashboard={() => openDashboard()}
        onAccount={() => openDashboard('account')}
        onInvitations={() => openDashboard('invitations')}
        initialTaskId={initialTaskId}
        onWorkspacesRefresh={refreshWorkspaces}
        onAccessRevoked={handleWorkspaceAccessRevoked}
        onLogout={() => void logout()}
      />
    </ReactFlowProvider>
  );
}

export default function App() {
  return (
    <PreferencesProvider>
      <AppContent />
    </PreferencesProvider>
  );
}
