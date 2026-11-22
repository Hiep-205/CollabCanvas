import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  House,
  LayoutGrid,
  LogOut,
  Mail,
  Moon,
  Plus,
  Search,
  Sun,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../app/api';
import type { DashboardOverview, User, Workspace, WorkspaceInvitation } from '../app/api';
import { usePreferences } from '../app/Preferences';
import { SettingsPage } from '../features/settings/SettingsPage';
import { MentionNotificationsPopover } from '../features/comments/MentionNotificationsPopover';

type Props = {
  user: User;
  workspaces: Workspace[];
  error: string;
  onOpenWorkspace: (id: string, taskId?: string) => void;
  onCreated: (workspace: Workspace) => void;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
  onUserUpdate: (user: User) => void;
};

type DashboardSection = 'overview' | 'workspaces' | 'tasks' | 'invitations' | 'account';

function currentSection(): DashboardSection {
  const section = new URLSearchParams(window.location.hash.split('?')[1]).get('view');
  return section === 'workspaces' || section === 'tasks' || section === 'invitations' || section === 'account'
    ? section
    : 'overview';
}

export default function DashboardPage({
  user,
  workspaces,
  error,
  onOpenWorkspace,
  onCreated,
  onRefresh,
  onLogout,
  onUserUpdate,
}: Props) {
  const { t, locale, setLocale, theme, setTheme } = usePreferences();
  const [section, setSection] = useState<DashboardSection>(currentSection);
  useEffect(() => {
    const syncSection = () => {
      setSection(currentSection());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', syncSection);
    return () => window.removeEventListener('hashchange', syncSection);
  }, []);
  const navigation = [
    { id: 'overview', label: t('dashboardTitle'), icon: House },
    { id: 'workspaces', label: t('navWorkspaces'), icon: FolderOpen },
    { id: 'tasks', label: t('navAssignedTasks'), icon: CheckCheck },
    { id: 'invitations', label: t('dashboardInvitations'), icon: Mail },
  ] as const;
  const sectionTitle =
    section === 'account' ? t('navAccount') : navigation.find((item) => item.id === section)!.label;

  const [query, setQuery] = useState('');
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [overviewState, setOverviewState] = useState({ key: '', error: false });
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [invitationPage, setInvitationPage] = useState(1);
  const [nextInvitationPage, setNextInvitationPage] = useState<number | null>(null);
  const [invitationError, setInvitationError] = useState(false);
  const [loadedInvitationKey, setLoadedInvitationKey] = useState('');
  const [busyInvitation, setBusyInvitation] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);
  const createDialog = useRef<HTMLDialogElement>(null);
  const overviewKey = `${page}:${reload}:${workspaces.map((workspace) => workspace.id).join(',')}`;
  const loading = overviewState.key !== overviewKey;
  const overviewError = !loading && overviewState.error;
  const invitationKey = `${invitationPage}:${reload}`;
  const invitationLoading = loadedInvitationKey !== invitationKey;

  useEffect(() => {
    let active = true;
    void api<DashboardOverview>(`/dashboard?page=${page}`)
      .then((result) => {
        if (!active) return;
        setOverview(result);
        setOverviewState({ key: overviewKey, error: false });
      })
      .catch(() => {
        if (active) setOverviewState({ key: overviewKey, error: true });
      });
    return () => {
      active = false;
    };
  }, [page, overviewKey]);

  useEffect(() => {
    let active = true;
    void api<{ items: WorkspaceInvitation[]; nextPage: number | null }>(`/invitations?page=${invitationPage}`)
      .then((result) => {
        if (!active) return;
        setInvitations(result.items);
        setNextInvitationPage(result.nextPage);
        setInvitationError(false);
      })
      .catch(() => {
        if (active) setInvitationError(true);
      })
      .finally(() => {
        if (active) setLoadedInvitationKey(invitationKey);
      });
    return () => {
      active = false;
    };
  }, [invitationPage, invitationKey]);

  useEffect(() => {
    if (showCreate) createDialog.current?.showModal();
  }, [showCreate]);

  const refresh = useCallback(() => {
    setReload((value) => value + 1);
    void onRefresh();
  }, [onRefresh]);

  async function respondToInvitation(id: string, action: 'accept' | 'decline') {
    setBusyInvitation(id);
    try {
      await api(`/invitations/${id}/${action}`, { method: 'POST' });
      setInvitations((items) => items.filter((item) => item.id !== id));
      await onRefresh();
      setReload((value) => value + 1);
    } catch {
      setInvitationError(true);
    } finally {
      setBusyInvitation(null);
    }
  }

  async function createWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    setCreateError(false);
    try {
      const workspace = await api<Workspace>('/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined }),
      });
      onCreated(workspace);
    } catch {
      setCreateError(true);
    } finally {
      setCreating(false);
    }
  }

  const visibleWorkspaces = workspaces.filter((workspace) =>
    `${workspace.name} ${workspace.description ?? ''}`
      .toLocaleLowerCase(locale)
      .includes(query.trim().toLocaleLowerCase(locale)),
  );
  const summary = overview?.summary;
  const statistics = [
    { label: t('dashboardSpaces'), value: summary?.workspaceCount, icon: FolderOpen },
    { label: t('dashboardAllTasks'), value: summary?.taskCount, icon: LayoutGrid },
    { label: t('dashboardMyOpen'), value: summary?.myOpenCount, icon: CheckCheck },
    { label: t('dashboardMyOverdue'), value: summary?.myOverdueCount, icon: CalendarDays },
  ];
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', { day: '2-digit', month: 'short' }).format(
      new Date(value),
    );

  return (
    <div className="dashboard-shell min-h-[100dvh] bg-surface text-on-surface">
      <aside className="dashboard-sidebar flex flex-col gap-8 border-r border-outline-variant/40 bg-surface-container-low px-5 py-7">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-on-primary">
            <LayoutGrid size={22} />
          </span>
          <strong className="text-lg font-extrabold">CollabCanvas</strong>
        </div>
        <nav aria-label={t('navigation')} className="flex flex-col gap-2">
          {navigation.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={id === 'overview' ? '#/dashboard' : `#/dashboard?view=${id}`}
              aria-current={section === id ? 'page' : undefined}
              className={`dashboard-nav flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${section === id ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'}`}
            >
              <Icon size={18} className="shrink-0" />
              {label}
              {id === 'workspaces' && (
                <span className="ml-auto text-xs tabular-nums">{workspaces.length}</span>
              )}
            </a>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-4 border-t border-outline-variant/40 pt-5">
          <a
            href="#/dashboard?view=account"
            aria-label={t('navAccount')}
            aria-current={section === 'account' ? 'page' : undefined}
            className="dashboard-account flex items-center gap-3 rounded-xl"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
              {(user.displayName || user.email).slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <strong className="block truncate text-xs">{user.displayName || user.email}</strong>
              <span className="block truncate text-[11px] text-on-surface-variant">{user.email}</span>
            </div>
          </a>
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-2 text-xs text-on-surface-variant"
          >
            <LogOut size={15} />
            {t('logout')}
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-outline-variant/30 px-5 md:px-10">
          <span className="text-xs font-semibold text-on-surface-variant">{t('dashboardPersonalSpace')}</span>
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg bg-surface-container p-1" aria-label={t('language')}>
              <button
                type="button"
                aria-pressed={locale === 'vi'}
                onClick={() => setLocale('vi')}
                className={`rounded px-2 py-1 text-xs ${locale === 'vi' ? 'bg-primary text-on-primary' : 'text-on-surface-variant'}`}
              >
                VI
              </button>
              <button
                type="button"
                aria-pressed={locale === 'en'}
                onClick={() => setLocale('en')}
                className={`rounded px-2 py-1 text-xs ${locale === 'en' ? 'bg-primary text-on-primary' : 'text-on-surface-variant'}`}
              >
                EN
              </button>
            </div>
            <button
              type="button"
              aria-label={t(theme === 'dark' ? 'lightMode' : 'darkMode')}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="rounded-lg border border-outline-variant/40 p-2"
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <MentionNotificationsPopover onOpenTask={onOpenWorkspace} />
          </div>
        </header>

        <main className="mx-auto flex max-w-[1440px] flex-col gap-9 px-5 py-8 md:px-10 md:py-10">
          {section === 'overview' && (
            <section className="dashboard-welcome relative overflow-hidden rounded-3xl border border-primary/15 px-6 py-8 md:px-9 md:py-10">
              <span className="mb-3 block text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
                {t('dashboardEyebrow')}
              </span>
              <h1 className="max-w-3xl text-2xl font-extrabold tracking-tight md:text-4xl">
                {t('dashboardGreeting')} {user.displayName || user.email}
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-on-surface-variant">{t('dashboardIntro')}</p>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-on-primary"
              >
                <Plus size={18} />
                {t('createWorkspace')}
              </button>
              <span className="dashboard-hero-mark" aria-hidden="true">
                <LayoutGrid size={130} strokeWidth={0.7} />
              </span>
            </section>
          )}

          {section !== 'overview' && section !== 'account' && (
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="mb-2 text-xs font-semibold text-primary">{t('dashboardPersonalSpace')}</p>
                <h1>{sectionTitle}</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-on-surface-variant">
                  {t(
                    section === 'workspaces'
                      ? 'dashboardSpacesHint'
                      : section === 'tasks'
                        ? 'dashboardMyTasksHint'
                        : 'navInvitationsHint',
                  )}
                </p>
              </div>
              {section === 'workspaces' && (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-on-primary"
                >
                  <Plus size={18} />
                  {t('createWorkspace')}
                </button>
              )}
            </div>
          )}
          {section === 'account' && (
            <SettingsPage
              user={user}
              onReturnToWorkspace={() => {
                window.location.hash = '/dashboard';
              }}
              onOpenWorkspaceHub={() => {
                window.location.hash = '/dashboard?view=workspaces';
              }}
              onLogout={onLogout}
              onUpdateProfile={async (name) => {
                const updated = await api<User>('/auth/profile', {
                  method: 'PATCH',
                  body: JSON.stringify({ displayName: name }),
                });
                onUserUpdate(updated);
              }}
            />
          )}

          {(error || overviewError) && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-error/30 bg-error/10 p-4 text-sm text-error"
            >
              <span>{error || t('dashboardLoadFailed')}</span>
              <button type="button" onClick={refresh} className="font-bold underline">
                {t('retry')}
              </button>
            </div>
          )}
          {section === 'overview' && (
            <section aria-label={t('dashboardStatistics')} className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              {statistics.map(({ label, value, icon: Icon }) => (
                <div
                  key={label}
                  className="flex items-center gap-4 rounded-2xl border border-outline-variant/40 bg-surface-container-low p-5"
                >
                  <Icon size={21} className="shrink-0 text-primary" />
                  <div>
                    <span className="block text-xs text-on-surface-variant">{label}</span>
                    <strong className="mt-1 block text-2xl font-extrabold">
                      {loading || overviewError ? '—' : (value ?? '—')}
                    </strong>
                  </div>
                </div>
              ))}
            </section>
          )}

          {(section === 'overview' || section === 'workspaces') && (
            <section id="dashboard-workspaces" className="scroll-mt-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-extrabold">{t('dashboardSpaces')}</h2>
                  <p className="mt-1 text-xs text-on-surface-variant">{t('dashboardSpacesHint')}</p>
                </div>
                <label className="flex w-full items-center gap-2 rounded-xl border border-outline-variant/50 bg-surface-container px-3 py-2.5 sm:w-72">
                  <Search size={16} className="text-on-surface-variant" />
                  <input
                    type="search"
                    aria-label={t('dashboardSearch')}
                    placeholder={t('dashboardSearch')}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                  />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visibleWorkspaces.map((workspace, index) => (
                  <button
                    type="button"
                    key={workspace.id}
                    onClick={() => onOpenWorkspace(workspace.id)}
                    className="dashboard-workspace group overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-low text-left"
                    aria-label={`${t('dashboardOpen')} ${workspace.name}`}
                  >
                    <div
                      className={`dashboard-workspace-cover dashboard-cover-${index % 3} flex h-32 items-center justify-center gap-3 border-b border-outline-variant/30`}
                      aria-hidden="true"
                    >
                      <span className="rounded-lg border border-primary/25 bg-surface/50 px-5 py-4 text-3xl font-extrabold text-primary">
                        {workspace.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="flex flex-col gap-2 opacity-50">
                        <i className="h-2 w-16 rounded bg-primary/40" />
                        <i className="h-2 w-10 rounded bg-primary/30" />
                        <i className="h-2 w-14 rounded bg-primary/20" />
                      </div>
                    </div>
                    <div className="p-5">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="truncate text-sm font-bold">{workspace.name}</h3>
                        <ArrowUpRight size={17} className="shrink-0 text-primary" />
                      </div>
                      <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-on-surface-variant">
                        {workspace.description || t('dashboardNoDescription')}
                      </p>
                      <div className="mt-4 flex items-center justify-between gap-2 border-t border-outline-variant/30 pt-3 text-[11px] text-on-surface-variant">
                        <span>{t(workspace.role)}</span>
                        <span>Kanban · Canvas</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {visibleWorkspaces.length === 0 && (
                <div className="rounded-2xl border border-dashed border-outline-variant/60 px-6 py-10 text-center">
                  <FolderOpen size={30} className="mx-auto mb-3 text-primary" />
                  <h3 className="text-sm font-bold">{t(query ? 'dashboardNoMatch' : 'dashboardEmpty')}</h3>
                  <p className="mt-2 text-xs text-on-surface-variant">
                    {t(query ? 'dashboardChangeSearch' : 'dashboardEmptyHint')}
                  </p>
                </div>
              )}
            </section>
          )}

          <div
            className={`grid items-start gap-6 ${section === 'overview' ? 'xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]' : ''}`}
          >
            {(section === 'overview' || section === 'tasks') && (
              <section
                className="min-w-0 rounded-2xl border border-outline-variant/40 bg-surface-container-low p-5 md:p-6"
                aria-labelledby="dashboard-tasks-title"
              >
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <h2 id="dashboard-tasks-title" className="text-lg font-extrabold">
                      {t('dashboardMyTasks')}
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-on-surface-variant">
                      {t('dashboardMyTasksHint')}
                    </p>
                  </div>
                  <CheckCheck size={22} className="shrink-0 text-primary" />
                </div>
                {loading ? (
                  <p role="status" className="py-6 text-sm text-on-surface-variant">
                    {t('loading')}
                  </p>
                ) : overviewError ? (
                  <p className="py-6 text-sm text-error">{t('dashboardLoadFailed')}</p>
                ) : overview?.tasks.length ? (
                  <div className="divide-y divide-outline-variant/30">
                    {overview.tasks.map((task) => (
                      <button
                        type="button"
                        key={task.id}
                        onClick={() => onOpenWorkspace(task.workspaceId, task.id)}
                        className="dashboard-task flex w-full items-center gap-3 py-4 text-left"
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-semibold">{task.title}</h3>
                          <p className="mt-1 truncate text-[11px] text-on-surface-variant">
                            {task.workspaceName} · {t(task.status === 'in_progress' ? 'IN_PROGRESS' : 'TODO')}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 text-[11px] ${task.dueAt && task.dueAt < overview.asOf ? 'text-error' : 'text-on-surface-variant'}`}
                        >
                          {task.dueAt ? date(task.dueAt) : t('noDueDate')}
                        </span>
                        <ArrowRight size={15} className="shrink-0 text-primary" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="py-8 text-sm text-on-surface-variant">{t('dashboardNoTasks')}</p>
                )}
                <div className="mt-4 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    aria-label={t('dashboardPrevious')}
                    disabled={page === 1 || loading}
                    onClick={() => setPage((value) => value - 1)}
                    className="rounded-lg border border-outline-variant/40 p-2 disabled:opacity-30"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-xs text-on-surface-variant">{page}</span>
                  <button
                    type="button"
                    aria-label={t('dashboardNext')}
                    disabled={!overview?.nextPage || loading || overviewError}
                    onClick={() => setPage(overview!.nextPage!)}
                    className="rounded-lg border border-outline-variant/40 p-2 disabled:opacity-30"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </section>
            )}

            {(section === 'overview' || section === 'invitations') && (
              <section
                id="dashboard-invitations"
                className="scroll-mt-6 rounded-2xl border border-outline-variant/40 bg-surface-container-low p-5 md:p-6"
              >
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="text-lg font-extrabold">{t('dashboardInvitations')}</h2>
                  <Mail size={21} className="text-primary" />
                </div>
                {invitationError ? (
                  <div role="alert" className="text-sm text-error">
                    {t('dashboardInvitationFailed')}{' '}
                    <button
                      type="button"
                      onClick={() => setReload((value) => value + 1)}
                      className="underline"
                    >
                      {t('retry')}
                    </button>
                  </div>
                ) : invitationLoading ? (
                  <p role="status" className="text-sm text-on-surface-variant">
                    {t('loading')}
                  </p>
                ) : invitations.length ? (
                  <div className="flex flex-col gap-5">
                    {invitations.map((invitation) => (
                      <div key={invitation.id}>
                        <h3 className="text-sm font-bold">
                          {invitation.workspaceName || t('dashboardInvitation')}
                        </h3>
                        <p className="mt-1 text-xs text-on-surface-variant">
                          {t(invitation.role === 'editor' ? 'editor' : 'viewer')}
                        </p>
                        <div className="mt-3 flex gap-3">
                          <button
                            type="button"
                            disabled={busyInvitation !== null}
                            onClick={() => void respondToInvitation(invitation.id, 'accept')}
                            className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-on-primary disabled:opacity-50"
                          >
                            {t('dashboardAccept')}
                          </button>
                          <button
                            type="button"
                            disabled={busyInvitation !== null}
                            onClick={() => void respondToInvitation(invitation.id, 'decline')}
                            className="px-2 text-xs text-on-surface-variant disabled:opacity-50"
                          >
                            {t('dashboardDecline')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-on-surface-variant">{t('dashboardNoInvitations')}</p>
                )}
                {(invitationPage > 1 || nextInvitationPage) && (
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      disabled={invitationPage === 1 || invitationLoading}
                      onClick={() => setInvitationPage((value) => value - 1)}
                      className="text-xs text-primary disabled:opacity-40"
                    >
                      {t('dashboardPrevious')}
                    </button>
                    <button
                      type="button"
                      disabled={!nextInvitationPage || invitationLoading}
                      onClick={() => setInvitationPage(nextInvitationPage!)}
                      className="text-xs text-primary disabled:opacity-40"
                    >
                      {t('dashboardNext')}
                    </button>
                  </div>
                )}
              </section>
            )}
          </div>
          <footer className="border-t border-outline-variant/30 pt-5 text-[11px] text-on-surface-variant">
            CollabCanvas · {t('dashboardFooter')}
          </footer>
        </main>
      </div>

      {showCreate && (
        <dialog
          ref={createDialog}
          onClose={() => setShowCreate(false)}
          onCancel={(event) => {
            if (creating) event.preventDefault();
          }}
          aria-labelledby="create-workspace-title"
          className="dashboard-create w-[calc(100%-32px)] max-w-lg rounded-3xl border border-outline-variant/50 bg-surface-container-low p-6 text-on-surface shadow-2xl backdrop:bg-surface/80"
        >
          <div className="mb-6 flex items-center justify-between gap-4">
            <h2 id="create-workspace-title" className="text-lg font-extrabold">
              {t('createWorkspace')}
            </h2>
            <button
              type="button"
              aria-label={t('dashboardClose')}
              disabled={creating}
              onClick={() => createDialog.current?.close()}
              className="rounded-lg p-2"
            >
              <X size={20} />
            </button>
          </div>
          <form onSubmit={(event) => void createWorkspace(event)} className="flex flex-col gap-5">
            <label className="flex flex-col gap-2 text-sm font-semibold">
              {t('workspaceName')}
              <input
                required
                autoFocus
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="rounded-xl border border-outline-variant/50 bg-surface-container px-4 py-3 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold">
              {t('dashboardDescription')}
              <textarea
                rows={3}
                maxLength={2000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="rounded-xl border border-outline-variant/50 bg-surface-container px-4 py-3 text-sm outline-none focus:border-primary"
              />
            </label>
            {createError && (
              <p role="alert" className="text-sm text-error">
                {t('createFailed')}
              </p>
            )}
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-on-primary disabled:opacity-50"
            >
              {creating ? t('saving') : t('dashboardCreateAndOpen')}
              <ArrowRight size={17} />
            </button>
          </form>
        </dialog>
      )}
    </div>
  );
}
