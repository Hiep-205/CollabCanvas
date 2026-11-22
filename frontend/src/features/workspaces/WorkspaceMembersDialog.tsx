import { useEffect, useRef, useState } from 'react';
import { api } from '../../app/api';
import type { Workspace } from '../../app/api';
import { usePreferences } from '../../app/Preferences';
import { listAllMembers } from '../tasks/api';
import type { WorkspaceMember } from '../tasks/api';

type Props = {
  workspace: Workspace;
  currentUserId: string;
  onClose: () => void;
  onMembersChanged: () => void;
};

export function WorkspaceMembersDialog({ workspace, currentUserId, onClose, onMembersChanged }: Props) {
  const { t } = usePreferences();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const emailInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    emailInputRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', closeOnEscape, true);
    return () => window.removeEventListener('keydown', closeOnEscape, true);
  }, []);

  useEffect(() => {
    let active = true;
    void listAllMembers(workspace.id)
      .then((items) => { if (active) setMembers(items); })
      .catch(() => { if (active) setError(t('membersLoadFailed')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspace.id, t]);

  async function changeRole(member: WorkspaceMember, role: 'editor' | 'viewer') {
    if (member.role === role) return;
    setBusyId(member.id);
    setError('');
    setMessage('');
    try {
      await api(`/workspaces/${workspace.id}/members/${member.id}`, {
        method: 'PATCH', body: JSON.stringify({ role }),
      });
      setMembers((items) => items.map((item) => item.id === member.id ? { ...item, role } : item));
      setMessage(t('memberRoleUpdated'));
      onMembersChanged();
    } catch {
      setError(t('membersActionFailed'));
    } finally {
      setBusyId(null);
    }
  }

  async function removeMember(memberId: string) {
    setBusyId(memberId);
    setError('');
    setMessage('');
    try {
      await api(`/workspaces/${workspace.id}/members/${memberId}`, { method: 'DELETE' });
      setMembers((items) => items.filter((item) => item.id !== memberId));
      setConfirmRemoveId(null);
      setMessage(t('memberRemoved'));
      onMembersChanged();
    } catch {
      setError(t('membersActionFailed'));
    } finally {
      setBusyId(null);
    }
  }

  async function inviteMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    setBusyId('invite');
    setError('');
    setMessage('');
    try {
      await api(`/workspaces/${workspace.id}/invitations`, {
        method: 'POST', body: JSON.stringify({ email: email.trim(), role: inviteRole }),
      });
      setEmail('');
      setMessage(t('memberInviteProcessed'));
    } catch {
      setError(t('membersActionFailed'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="workspace-members-title" className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-3xl border border-outline-variant/60 bg-surface-container-high p-5 text-on-surface shadow-2xl md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="workspace-members-title" className="text-lg font-bold">{t('manageMembers')}</h2>
            <p className="text-sm text-on-surface-variant">{workspace.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('dashboardClose')} className="rounded-lg px-2 py-1 text-on-surface-variant hover:bg-surface-container">×</button>
        </div>

        <form onSubmit={(event) => void inviteMember(event)} className="mt-5 rounded-xl bg-surface-container p-4">
          <label htmlFor="invite-member-email" className="block text-sm font-semibold">{t('inviteMember')}</label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <input ref={emailInputRef} id="invite-member-email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t('memberEmail')} className="col-span-2 w-full min-w-0 rounded-lg border border-outline-variant/60 bg-surface-container-high px-3 py-2 text-sm sm:col-span-1" />
            <select aria-label={t('memberRole')} value={inviteRole} onChange={(event) => setInviteRole(event.target.value as 'editor' | 'viewer')} className="rounded-lg border border-outline-variant/60 bg-surface-container-high px-2 text-sm">
              <option value="editor">{t('editor')}</option><option value="viewer">{t('viewer')}</option>
            </select>
            <button type="submit" disabled={busyId !== null} className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-primary disabled:opacity-50">{t('sendInvitation')}</button>
          </div>
        </form>

        <div className="mt-5">
          <h3 className="text-sm font-semibold">{t('members')}</h3>
          {loading ? <p role="status" className="mt-3 text-sm text-on-surface-variant">{t('loading')}</p> : null}
          {!loading && members.length === 0 ? <p className="mt-3 text-sm text-on-surface-variant">{t('membersEmpty')}</p> : null}
          <ul className="mt-2 space-y-2">
            {members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-outline-variant/40 bg-surface-container p-3">
                <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                  <p className="truncate text-sm font-semibold">{member.displayName}</p>
                  <p className="truncate text-xs text-on-surface-variant">{member.email}</p>
                </div>
                {member.id === currentUserId || member.role === 'owner' ? (
                  <span className="text-xs text-on-surface-variant">{t('owner')}</span>
                ) : (
                  <>
                    <select aria-label={`${t('memberRole')}: ${member.displayName}`} value={member.role} disabled={busyId !== null} onChange={(event) => void changeRole(member, event.target.value as 'editor' | 'viewer')} className="rounded-lg border border-outline-variant/60 bg-surface-container-high px-2 py-1.5 text-xs">
                      <option value="editor">{t('editor')}</option><option value="viewer">{t('viewer')}</option>
                    </select>
                    {confirmRemoveId === member.id ? (
                      <span className="flex items-center gap-1">
                        <button type="button" disabled={busyId !== null} onClick={() => void removeMember(member.id)} className="rounded-lg bg-error/20 px-2 py-1.5 text-xs font-bold text-error">{t('confirmRemoveMember')}</button>
                        <button type="button" onClick={() => setConfirmRemoveId(null)} className="rounded-lg px-2 py-1.5 text-xs">{t('cancel')}</button>
                      </span>
                    ) : (
                      <button type="button" disabled={busyId !== null} onClick={() => setConfirmRemoveId(member.id)} className="rounded-lg px-2 py-1.5 text-xs text-error hover:bg-error/10">{t('removeMember')}</button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
        {error ? <p role="alert" className="mt-4 text-sm text-error">{error}</p> : null}
        {message ? <p role="status" className="mt-4 text-sm text-primary">{message}</p> : null}
      </section>
    </div>
  );
}
