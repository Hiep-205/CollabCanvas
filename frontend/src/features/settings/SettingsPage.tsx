import React, { useState } from 'react';
import type { User, Workspace } from '../../app/api';
import { api, ApiError } from '../../app/api';
import { usePreferences } from '../../app/Preferences';

interface SettingsPageProps {
  user: User;
  workspace?: Workspace;
  onUpdateProfile: (name: string) => Promise<void>;
  onReturnToWorkspace: () => void;
  onLogout: () => void | Promise<void>;
  onOpenWorkspaceHub: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  user,
  workspace,
  onUpdateProfile,
  onReturnToWorkspace,
  onLogout,
  onOpenWorkspaceHub,
}) => {
  const { t, showCursors, setShowCursors } = usePreferences();
  // Navigation active section
  const [activeSection, setActiveSection] = useState<string>('ho-so-ca-nhan');

  // Profile form state
  const [displayName, setDisplayName] = useState(user.displayName || 'Trần Văn Nam');
  const [cursorName, setCursorName] = useState(() => (user.displayName ? user.displayName.toLowerCase().replace(/\s+/g, '') : 'vannam'));
  const [jobTitle, setJobTitle] = useState('Lead Product Designer & Tech Lead');
  const [timezone, setTimezone] = useState('GMT+7 (Giờ Đông Dương - Hà Nội, Bangkok, Jakarta)');
  const [profileSaving, setProfileSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 2FA state
  const [twoFactorActive, setTwoFactorActive] = useState(true);

  // Canvas Experience state
  const [webglBoost, setWebglBoost] = useState(true);
  const [gridMode, setGridMode] = useState<'dot' | 'square' | 'blank'>('dot');
  const [fps, setFps] = useState<'60' | '120'>('120');

  // Danger Zone confirmation modal
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  // Reset to default
  const handleResetDefaults = () => {
    setDisplayName(user.displayName || 'Trần Văn Nam');
    setCursorName(user.displayName ? user.displayName.toLowerCase().replace(/\s+/g, '') : 'vannam');
    setJobTitle('Lead Product Designer & Tech Lead');
    setTimezone('GMT+7 (Giờ Đông Dương - Hà Nội, Bangkok, Jakarta)');
    setShowCursors(true);
    setWebglBoost(true);
    setGridMode('dot');
    setFps('120');
    setSaveSuccessMsg('Đã đặt lại cấu hình mặc định!');
    setTimeout(() => setSaveSuccessMsg(null), 3000);
  };

  // Save profile changes
  const handleSaveProfile = async () => {
    setProfileSaving(true);
    setSaveSuccessMsg(null);
    try {
      await onUpdateProfile(displayName.trim());
      setSaveSuccessMsg('Đã lưu mọi thay đổi thành công!');
      setTimeout(() => setSaveSuccessMsg(null), 3500);
    } catch {
      setSaveSuccessMsg('Có lỗi xảy ra khi lưu thông tin.');
      setTimeout(() => setSaveSuccessMsg(null), 4000);
    } finally {
      setProfileSaving(false);
    }
  };

  // Change password
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordFeedback(null);

    if (!currentPassword) {
      setPasswordFeedback({ type: 'error', text: 'Vui lòng nhập mật khẩu hiện tại.' });
      return;
    }
    if (newPassword.length < 12) {
      setPasswordFeedback({ type: 'error', text: 'Mật khẩu mới phải có tối thiểu 12 ký tự.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ type: 'error', text: 'Mật khẩu xác nhận không trùng khớp.' });
      return;
    }

    setPasswordSaving(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setPasswordFeedback({ type: 'success', text: 'Đổi mật khẩu bảo mật thành công!' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordFeedback(null), 4000);
    } catch (err) {
      if (err instanceof ApiError) {
        setPasswordFeedback({ type: 'error', text: err.message || 'Mật khẩu hiện tại không chính xác.' });
      } else {
        setPasswordFeedback({ type: 'error', text: 'Không thể đổi mật khẩu. Vui lòng thử lại.' });
      }
    } finally {
      setPasswordSaving(false);
    }
  };

  // Delete account action
  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'XÓA TÀI KHOẢN') return;
    setIsDeletingAccount(true);
    try {
      await api('/auth/account', { method: 'DELETE' });
      await onLogout();
    } catch {
      alert('Không thể xóa tài khoản. Vui lòng thử lại sau.');
      setIsDeletingAccount(false);
      setIsDeleteModalOpen(false);
    }
  };

  const userInitials = (displayName || user.displayName || user.email).slice(0, 2).toUpperCase();

  return (
    <div className="account-settings flex flex-col w-full min-h-screen bg-surface text-on-surface">
      {/* Toast Notification */}
      {saveSuccessMsg && (
        <div className="fixed top-20 right-8 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-4">
          <span className="material-symbols-outlined text-[20px] text-emerald-400">check_circle</span>
          <span className="text-sm font-semibold">{saveSuccessMsg}</span>
        </div>
      )}

      {/* Main Settings Page Container */}
      <main className="relative pt-6 bg-surface min-h-screen w-full px-6 sm:px-10 pb-20 max-w-7xl mx-auto">
        <div className="flex flex-col w-full pb-16">
          {/* Top Action & Meta Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div className="flex flex-col">
              <button
                type="button"
                onClick={onReturnToWorkspace}
                aria-label={workspace ? undefined : t('navBackOverview')}
                className="text-xs text-on-surface-variant hover:text-white flex items-center gap-1 mb-2 font-medium w-fit"
              >
                <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                <span>{workspace ? `Quay lại ${workspace.name}` : t('navBackOverview')}</span>
              </button>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 rounded bg-primary-container/20 text-primary text-[11px] font-bold uppercase tracking-wider">
                  Hệ thống
                </span>
                <span className="text-on-surface-variant text-[11px]">• Đồng bộ tự động 1 phút trước</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-on-surface tracking-tight">
                Cài đặt &amp; Tài khoản
              </h1>
              <p className="text-sm text-on-surface-variant mt-0.5">
                Quản lý thông tin hồ sơ cá nhân, cấu hình bảo mật, trải nghiệm Canvas và tùy chỉnh thông báo.
              </p>
            </div>
            <div className="flex items-center gap-3 self-start md:self-auto">
              <button
                type="button"
                onClick={handleResetDefaults}
                className="px-4 py-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface text-xs font-semibold transition-colors flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                <span>Đặt lại mặc định</span>
              </button>
              <button
                type="button"
                onClick={handleSaveProfile}
                disabled={profileSaving}
                className="px-6 py-2.5 rounded-xl bg-primary hover:bg-primary-fixed text-on-primary text-xs font-bold shadow-lg shadow-primary/20 transition-all active:scale-[0.98] flex items-center gap-2 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">check_circle</span>
                <span>{profileSaving ? 'Đang lưu...' : 'Lưu thay đổi'}</span>
              </button>
            </div>
          </div>

          {/* Settings Split Architecture */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-start">
            {/* Left Navigation Pane (Sticky Sub-nav) */}
            <aside className="lg:col-span-3 lg:sticky lg:top-24 flex flex-col gap-2 bg-surface-container-lowest/80 backdrop-blur-md p-3 rounded-2xl shadow-xl shadow-surface-container-lowest/40 border border-outline-variant/30">
              <div className="px-3 py-2">
                <span className="text-[11px] text-on-surface-variant uppercase tracking-wider font-bold">
                  Danh mục cài đặt
                </span>
              </div>
              <nav className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('ho-so-ca-nhan');
                    document.getElementById('ho-so-ca-nhan')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className={`flex items-center justify-between px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    activeSection === 'ho-so-ca-nhan'
                      ? 'bg-primary-container text-on-primary-container font-bold shadow-md shadow-primary-container/20'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-[20px]">account_circle</span>
                    <span>Hồ sơ cá nhân</span>
                  </div>
                  {activeSection === 'ho-so-ca-nhan' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-on-primary-container" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('bao-mat-2fa');
                    document.getElementById('bao-mat-2fa')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className={`flex items-center justify-between px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    activeSection === 'bao-mat-2fa'
                      ? 'bg-primary-container text-on-primary-container font-bold shadow-md shadow-primary-container/20'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-[20px]">encrypted</span>
                    <span>Bảo mật &amp; 2FA</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-bold">
                    Active
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('trai-nghiem-canvas');
                    document.getElementById('trai-nghiem-canvas')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className={`flex items-center justify-between px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    activeSection === 'trai-nghiem-canvas'
                      ? 'bg-primary-container text-on-primary-container font-bold shadow-md shadow-primary-container/20'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-[20px]">palette</span>
                    <span>Trải nghiệm Canvas</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('thong-bao-am-thanh');
                    document.getElementById('thong-bao-am-thanh')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className={`flex items-center justify-between px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    activeSection === 'thong-bao-am-thanh'
                      ? 'bg-primary-container text-on-primary-container font-bold shadow-md shadow-primary-container/20'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-[20px]">notifications_active</span>
                    <span>Thông báo &amp; Âm thanh</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={onOpenWorkspaceHub}
                  className="flex items-center justify-between px-4 py-2.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors text-xs font-semibold"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-[20px]">corporate_fare</span>
                    <span>Không gian làm việc</span>
                  </div>
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">arrow_forward</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('goi-dich-vu');
                    document.getElementById('goi-dich-vu')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className={`flex items-center justify-between px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    activeSection === 'goi-dich-vu'
                      ? 'bg-primary-container text-on-primary-container font-bold shadow-md shadow-primary-container/20'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-[20px]">cloud_done</span>
                    <span>Gói dịch vụ &amp; Bộ nhớ</span>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-secondary" />
                </button>
              </nav>

              {/* Mini System Status Widget */}
              <div className="mt-4 p-4 rounded-xl bg-surface-container-low flex flex-col gap-2 border border-outline-variant/20">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-on-surface-variant font-medium">Bộ nhớ Workspace</span>
                  <span className="text-xs font-bold text-primary">14.8%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-surface-container-highest overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: '14.8%' }} />
                </div>
                <span className="text-[11px] text-on-surface-variant/80">14.8 GB / 100 GB đã sử dụng</span>
              </div>
            </aside>

            {/* Main Content Panels */}
            <div className="lg:col-span-9 flex flex-col gap-8">
              {/* 1. Hồ sơ cá nhân */}
              <section
                className="rounded-2xl bg-surface-container-low p-6 sm:p-8 shadow-xl shadow-surface-container-lowest/30 flex flex-col gap-6 border border-outline-variant/30"
                id="ho-so-ca-nhan"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-outline-variant/20">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary-container/20 flex items-center justify-center text-primary">
                      <span className="material-symbols-outlined text-[22px]">person</span>
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-on-surface">Hồ sơ cá nhân</h2>
                      <p className="text-xs text-on-surface-variant">
                        Thông tin hiển thị khi bạn tham gia vào các phòng Canvas chung.
                      </p>
                    </div>
                  </div>
                  <span className="self-start sm:self-auto px-3 py-1 rounded-full bg-secondary-container/30 text-secondary text-xs font-semibold flex items-center gap-1.5 border border-secondary/30">
                    <span className="material-symbols-outlined text-[16px]">verified_user</span>
                    {workspace ? t(workspace.role) : t('navAccount')}
                  </span>
                </div>

                {/* Avatar Banner & Controls */}
                <div className="p-4 rounded-xl bg-surface-container flex flex-col sm:flex-row items-center gap-5 border border-outline-variant/20">
                  <div className="relative group shrink-0">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-primary to-primary-container flex items-center justify-center text-on-primary text-2xl font-black shadow-lg shadow-primary/20">
                      {userInitials}
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-secondary-container flex items-center justify-center text-secondary shadow cursor-pointer hover:scale-110 transition-transform">
                      <span className="material-symbols-outlined text-[14px]">edit</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-center sm:items-start flex-1 gap-1 text-center sm:text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-on-surface">{displayName}</span>
                      <span className="px-2 py-0.5 rounded bg-primary-container text-on-primary-container text-[11px] font-bold">
                        Online
                      </span>
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      Tải ảnh đại diện định dạng PNG, JPG hoặc GIF (tối đa 5MB).
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                      <button
                        type="button"
                        onClick={() => alert('Chức năng tải ảnh avatar đang chuẩn bị ra mắt!')}
                        className="px-4 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-bright text-on-surface text-xs font-semibold transition-colors flex items-center gap-1.5 border border-outline-variant/30"
                      >
                        <span className="material-symbols-outlined text-[16px]">upload</span>
                        Tải ảnh mới
                      </button>
                      <button
                        type="button"
                        onClick={() => setDisplayName(user.email.split('@')[0])}
                        className="px-4 py-1.5 rounded-lg bg-surface-container hover:bg-error-container/20 text-error text-xs font-semibold transition-colors border border-outline-variant/20"
                      >
                        Gỡ avatar
                      </button>
                    </div>
                  </div>
                </div>

                {/* Personal Info Form */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-on-surface flex items-center gap-1">
                      Họ và tên
                      <span className="text-tertiary">*</span>
                    </label>
                    <div className="relative">
                      <input
                        className="w-full px-4 py-3 rounded-xl bg-surface-container text-on-surface text-sm border border-outline-variant/40 focus:outline-none focus:border-primary transition-all"
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Nhập họ và tên..."
                      />
                      <span className="material-symbols-outlined absolute right-3 top-3.5 text-[18px] text-on-surface-variant pointer-events-none">
                        badge
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-on-surface flex items-center justify-between">
                      <span>Email liên kết</span>
                      <span className="text-primary text-[11px] font-bold flex items-center gap-0.5">
                        <span className="material-symbols-outlined text-[14px]">check_circle</span>
                        Đã xác thực
                      </span>
                    </label>
                    <div className="relative">
                      <input
                        className="w-full px-4 py-3 rounded-xl bg-surface-container/60 text-on-surface-variant text-sm border border-outline-variant/20 cursor-not-allowed"
                        readOnly
                        type="email"
                        value={user.email}
                      />
                      <span className="material-symbols-outlined absolute right-3 top-3.5 text-[18px] text-primary pointer-events-none">
                        lock
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-on-surface">Tên hiển thị trên con trỏ chuột</label>
                    <div className="relative">
                      <span className="absolute left-3 top-3.5 text-on-surface-variant text-xs font-bold">@</span>
                      <input
                        className="w-full pl-8 pr-4 py-3 rounded-xl bg-surface-container text-on-surface text-sm border border-outline-variant/40 focus:outline-none focus:border-primary transition-all"
                        type="text"
                        value={cursorName}
                        onChange={(e) => setCursorName(e.target.value)}
                      />
                    </div>
                    <span className="text-[11px] text-on-surface-variant">
                      Tên này sẽ hiển thị kèm con trỏ chuột của bạn khi đồng nghiệp vẽ chung.
                    </span>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-on-surface">Chức danh / Vai trò</label>
                    <input
                      className="w-full px-4 py-3 rounded-xl bg-surface-container text-on-surface text-sm border border-outline-variant/40 focus:outline-none focus:border-primary transition-all"
                      type="text"
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-xs font-semibold text-on-surface">Múi giờ làm việc</label>
                    <div className="relative">
                      <select
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl bg-surface-container text-on-surface text-sm appearance-none border border-outline-variant/40 focus:outline-none focus:border-primary transition-all pr-10 cursor-pointer"
                      >
                        <option value="GMT+7 (Giờ Đông Dương - Hà Nội, Bangkok, Jakarta)">
                          GMT+7 (Giờ Đông Dương - Hà Nội, Bangkok, Jakarta)
                        </option>
                        <option value="GMT+8 (Singapore, Hồng Kông, Bắc Kinh)">GMT+8 (Singapore, Hồng Kông, Bắc Kinh)</option>
                        <option value="GMT+9 (Tokyo, Seoul)">GMT+9 (Tokyo, Seoul)</option>
                        <option value="GMT+0 (Giờ chuẩn quốc tế UTC - London)">GMT+0 (Giờ chuẩn quốc tế UTC - London)</option>
                      </select>
                      <span className="material-symbols-outlined absolute right-3 top-3.5 text-[20px] text-on-surface-variant pointer-events-none">
                        expand_more
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              {/* 2. Bảo mật & Xác thực hai lớp */}
              <section
                className="rounded-2xl bg-surface-container-low p-6 sm:p-8 shadow-xl shadow-surface-container-lowest/30 flex flex-col gap-6 border border-outline-variant/30"
                id="bao-mat-2fa"
              >
                <div className="flex items-center gap-3 pb-3 border-b border-outline-variant/20">
                  <div className="w-9 h-9 rounded-lg bg-secondary-container/20 flex items-center justify-center text-secondary">
                    <span className="material-symbols-outlined text-[22px]">security</span>
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-on-surface">Bảo mật &amp; Xác thực</h2>
                    <p className="text-xs text-on-surface-variant">
                      Bảo vệ tài khoản với mật khẩu mạnh và mã xác thực 2 bước (2FA).
                    </p>
                  </div>
                </div>

                {/* 2FA Box */}
                <div className="p-4 sm:p-5 rounded-xl bg-surface-container flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border border-outline-variant/20">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary-container/20 flex items-center justify-center text-primary mt-0.5 shrink-0">
                      <span className="material-symbols-outlined text-[22px]">phonelink_lock</span>
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-on-surface">Xác thực hai bước (2FA)</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            twoFactorActive ? 'bg-primary/20 text-primary' : 'bg-surface-container-highest text-on-surface-variant'
                          }`}
                        >
                          {twoFactorActive ? 'ĐANG BẬT' : 'ĐANG TẮT'}
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        {twoFactorActive
                          ? 'Đang bảo vệ phiên đăng nhập qua ứng dụng Google Authenticator / 1Password.'
                          : 'Kích hoạt để tăng cường bảo vệ đăng nhập qua mã OTP di động.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 self-end md:self-auto shrink-0">
                    <button
                      type="button"
                      onClick={() => alert('Mã dự phòng khẩn cấp: [CC-9481-2849, CC-1092-8841, CC-5501-9214]')}
                      className="px-3.5 py-2 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface text-xs font-semibold transition-colors flex items-center gap-1.5 border border-outline-variant/30"
                    >
                      <span className="material-symbols-outlined text-[16px]">qr_code</span>
                      Xem mã dự phòng
                    </button>
                    <button
                      type="button"
                      onClick={() => setTwoFactorActive((prev) => !prev)}
                      className="px-3.5 py-2 rounded-xl bg-surface-container-highest hover:bg-error-container/20 text-on-surface hover:text-error text-xs font-semibold transition-colors border border-outline-variant/20"
                    >
                      {twoFactorActive ? 'Tắt 2FA' : 'Bật 2FA'}
                    </button>
                  </div>
                </div>

                {/* Đổi mật khẩu tài khoản */}
                <form
                  onSubmit={handleChangePassword}
                  className="p-5 rounded-xl bg-surface-container-lowest flex flex-col gap-4 border border-outline-variant/20"
                >
                  <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-primary">key</span>
                    Đổi mật khẩu tài khoản
                  </h3>

                  {passwordFeedback && (
                    <div
                      className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
                        passwordFeedback.type === 'success'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {passwordFeedback.type === 'success' ? 'check_circle' : 'error'}
                      </span>
                      <span>{passwordFeedback.text}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-on-surface-variant font-medium">Mật khẩu hiện tại</span>
                      <input
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container text-on-surface text-xs border border-outline-variant/40 focus:outline-none focus:border-primary transition-all"
                        placeholder="••••••••••••"
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-on-surface-variant font-medium">Mật khẩu mới</span>
                      <input
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container text-on-surface text-xs border border-outline-variant/40 focus:outline-none focus:border-primary transition-all"
                        placeholder="Ít nhất 12 ký tự"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-on-surface-variant font-medium">Xác nhận mật khẩu</span>
                      <input
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container text-on-surface text-xs border border-outline-variant/40 focus:outline-none focus:border-primary transition-all"
                        placeholder="Nhập lại mật khẩu mới"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={passwordSaving}
                      className="px-4 py-2 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface text-xs font-bold transition-colors border border-outline-variant/30 disabled:opacity-50"
                    >
                      {passwordSaving ? 'Đang cập nhật...' : 'Cập nhật mật khẩu'}
                    </button>
                  </div>
                </form>

                {/* Active Sessions List */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[18px] text-on-surface-variant">devices</span>
                      Phiên đăng nhập đang hoạt động
                    </h3>
                    <button
                      type="button"
                      onClick={() => alert('Đã đăng xuất thành công khỏi 1 thiết bị khác!')}
                      className="text-[11px] text-error hover:underline flex items-center gap-1 font-semibold"
                    >
                      <span className="material-symbols-outlined text-[14px]">logout</span>
                      Đăng xuất khỏi các thiết bị khác
                    </button>
                  </div>

                  <div className="flex flex-col gap-2">
                    {/* Current Session */}
                    <div className="p-3 rounded-xl bg-surface-container flex items-center justify-between border border-outline-variant/20">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-primary-container/20 text-primary flex items-center justify-center">
                          <span className="material-symbols-outlined text-[20px]">laptop_windows</span>
                        </div>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-on-surface">Windows 11 • Google Chrome 129</span>
                            <span className="px-1.5 py-0.5 rounded bg-primary/20 text-primary text-[10px] font-bold">
                              Thiết bị này
                            </span>
                          </div>
                          <span className="text-[11px] text-on-surface-variant">
                            IP: 118.70.182.24 • Hà Nội, Việt Nam • Đang trực tuyến
                          </span>
                        </div>
                      </div>
                      <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse mr-2" />
                    </div>

                    {/* Other Session */}
                    <div className="p-3 rounded-xl bg-surface-container/60 flex items-center justify-between border border-outline-variant/10">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-surface-container-high text-on-surface-variant flex items-center justify-center">
                          <span className="material-symbols-outlined text-[20px]">laptop_mac</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-on-surface">MacBook Pro M2 • Safari 17.4</span>
                          <span className="text-[11px] text-on-surface-variant">
                            TP. Hồ Chí Minh, Việt Nam • Hoạt động 3 ngày trước
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => alert('Đã hủy phiên đăng nhập MacBook Pro!')}
                        className="p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant hover:text-error transition-colors"
                        title="Đăng xuất thiết bị này"
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              {/* 3. Trải nghiệm Canvas & Phím tắt */}
              <section
                className="rounded-2xl bg-surface-container-low p-6 sm:p-8 shadow-xl shadow-surface-container-lowest/30 flex flex-col gap-6 border border-outline-variant/30"
                id="trai-nghiem-canvas"
              >
                <div className="flex items-center gap-3 pb-3 border-b border-outline-variant/20">
                  <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center text-primary">
                    <span className="material-symbols-outlined text-[22px]">gesture</span>
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-on-surface">Trải nghiệm Canvas &amp; Phím tắt</h2>
                    <p className="text-xs text-on-surface-variant">
                      Tối ưu hiệu năng đồ họa, độ nhạy con trỏ chuột và chế độ hiển thị lưới bảng vẽ.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Toggle 1: Multi-cursor */}
                  <div className="p-4 rounded-xl bg-surface-container flex items-center justify-between border border-outline-variant/20">
                    <div className="flex flex-col pr-3">
                      <span className="text-xs font-bold text-on-surface">{t('showCollaboratorCursors')}</span>
                      <span className="text-[11px] text-on-surface-variant">
                        {t('showCollaboratorCursorsDescription')}
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        aria-label={t('showCollaboratorCursors')}
                        checked={showCursors}
                        onChange={(e) => setShowCursors(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-surface-container-high peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 rounded-full peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                    </label>
                  </div>

                  {/* Toggle 2: WebGL Hardware Boost */}
                  <div className="p-4 rounded-xl bg-surface-container flex items-center justify-between border border-outline-variant/20">
                    <div className="flex flex-col pr-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-on-surface">Tăng tốc phần cứng WebGL</span>
                        <span className="px-1.5 py-0.5 rounded bg-secondary-container/40 text-secondary text-[10px] font-bold">
                          Khuyên dùng
                        </span>
                      </div>
                      <span className="text-[11px] text-on-surface-variant">
                        Giảm giật lag trên bảng vẽ lớn (&gt;5.000 đối tượng).
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={webglBoost}
                        onChange={(e) => setWebglBoost(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-surface-container-high peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                    </label>
                  </div>
                </div>

                {/* Grid Selector Cards */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-on-surface">
                    Chế độ lưới mặc định (Default Grid Mode)
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Option 1: Dot Grid */}
                    <div
                      onClick={() => setGridMode('dot')}
                      className={`p-4 rounded-xl transition-all flex flex-col gap-1 cursor-pointer border ${
                        gridMode === 'dot'
                          ? 'bg-surface-container-high ring-2 ring-primary border-primary/50'
                          : 'bg-surface-container hover:bg-surface-container-high border-outline-variant/20'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-on-surface">Lưới chấm (Dot Grid)</span>
                        {gridMode === 'dot' ? (
                          <span className="material-symbols-outlined text-[18px] text-primary">check_circle</span>
                        ) : (
                          <span className="w-4 h-4 rounded-full bg-surface-container-highest" />
                        )}
                      </div>
                      <span className="text-[11px] text-on-surface-variant">
                        Mặc định của CollabCanvas, cân bằng thị giác cao.
                      </span>
                    </div>

                    {/* Option 2: Square Grid */}
                    <div
                      onClick={() => setGridMode('square')}
                      className={`p-4 rounded-xl transition-all flex flex-col gap-1 cursor-pointer border ${
                        gridMode === 'square'
                          ? 'bg-surface-container-high ring-2 ring-primary border-primary/50'
                          : 'bg-surface-container hover:bg-surface-container-high border-outline-variant/20'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-on-surface">Lưới ô vuông (Square)</span>
                        {gridMode === 'square' ? (
                          <span className="material-symbols-outlined text-[18px] text-primary">check_circle</span>
                        ) : (
                          <span className="w-4 h-4 rounded-full bg-surface-container-highest" />
                        )}
                      </div>
                      <span className="text-[11px] text-on-surface-variant">
                        Phù hợp thiết kế kiến trúc và sơ đồ hệ thống.
                      </span>
                    </div>

                    {/* Option 3: Blank Canvas */}
                    <div
                      onClick={() => setGridMode('blank')}
                      className={`p-4 rounded-xl transition-all flex flex-col gap-1 cursor-pointer border ${
                        gridMode === 'blank'
                          ? 'bg-surface-container-high ring-2 ring-primary border-primary/50'
                          : 'bg-surface-container hover:bg-surface-container-high border-outline-variant/20'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-on-surface">Không lưới (Blank Canvas)</span>
                        {gridMode === 'blank' ? (
                          <span className="material-symbols-outlined text-[18px] text-primary">check_circle</span>
                        ) : (
                          <span className="w-4 h-4 rounded-full bg-surface-container-highest" />
                        )}
                      </div>
                      <span className="text-[11px] text-on-surface-variant">Không gian vô tận phẳng hoàn toàn.</span>
                    </div>
                  </div>
                </div>

                {/* Framerate & Controls Shortcut */}
                <div className="p-4 rounded-xl bg-surface-container flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-outline-variant/20">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-on-surface">Tốc độ khung hình (Render FPS)</span>
                    <span className="text-[11px] text-on-surface-variant">
                      Hỗ trợ màn hình tần số quét cao ProMotion 120Hz.
                    </span>
                  </div>
                  <div className="flex items-center rounded-xl bg-surface-container-lowest p-1 border border-outline-variant/20">
                    <button
                      type="button"
                      onClick={() => setFps('60')}
                      className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                        fps === '60'
                          ? 'bg-primary-container text-on-primary-container font-bold shadow-sm'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      60 FPS (Tiết kiệm pin)
                    </button>
                    <button
                      type="button"
                      onClick={() => setFps('120')}
                      className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                        fps === '120'
                          ? 'bg-primary-container text-on-primary-container font-bold shadow-sm'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      120 FPS (Mượt mà)
                    </button>
                  </div>
                </div>

                {/* Quick Keyboard Shortcuts Reference Table */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-on-surface">Phím tắt thao tác nhanh</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="p-2.5 rounded-lg bg-surface-container flex items-center justify-between border border-outline-variant/20">
                      <span className="text-[11px] text-on-surface-variant">Pan Canvas</span>
                      <kbd className="px-2 py-0.5 rounded bg-surface-container-highest text-on-surface text-[11px] font-bold shadow-sm">
                        Space
                      </kbd>
                    </div>
                    <div className="p-2.5 rounded-lg bg-surface-container flex items-center justify-between border border-outline-variant/20">
                      <span className="text-[11px] text-on-surface-variant">Chọn đối tượng</span>
                      <kbd className="px-2 py-0.5 rounded bg-surface-container-highest text-on-surface text-[11px] font-bold shadow-sm">
                        V
                      </kbd>
                    </div>
                    <div className="p-2.5 rounded-lg bg-surface-container flex items-center justify-between border border-outline-variant/20">
                      <span className="text-[11px] text-on-surface-variant">Bút vẽ tự do</span>
                      <kbd className="px-2 py-0.5 rounded bg-surface-container-highest text-on-surface text-[11px] font-bold shadow-sm">
                        P
                      </kbd>
                    </div>
                    <div className="p-2.5 rounded-lg bg-surface-container flex items-center justify-between border border-outline-variant/20">
                      <span className="text-[11px] text-on-surface-variant">Thêm Sticky Note</span>
                      <kbd className="px-2 py-0.5 rounded bg-surface-container-highest text-on-surface text-[11px] font-bold shadow-sm">
                        S
                      </kbd>
                    </div>
                  </div>
                </div>
              </section>

              {/* 4. Gói dịch vụ & Dung lượng lưu trữ */}
              <section
                className="rounded-2xl bg-surface-container-low p-6 sm:p-8 shadow-xl shadow-surface-container-lowest/30 flex flex-col gap-6 border border-outline-variant/30"
                id="goi-dich-vu"
              >
                <div className="flex items-center gap-3 pb-3 border-b border-outline-variant/20">
                  <div className="w-9 h-9 rounded-lg bg-secondary/20 flex items-center justify-center text-secondary">
                    <span className="material-symbols-outlined text-[22px]">diamond</span>
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-on-surface">Gói dịch vụ &amp; Bộ nhớ đám mây</h2>
                    <p className="text-xs text-on-surface-variant">
                      Thông tin gói thuê bao, dung lượng tệp đính kèm và hạn mức thành viên.
                    </p>
                  </div>
                </div>

                {/* Plan Banner */}
                <div className="relative overflow-hidden p-6 sm:p-8 rounded-2xl bg-gradient-to-r from-secondary-container/40 via-surface-container-high to-surface-container flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-inner border border-secondary/30">
                  <div className="flex flex-col gap-1.5 z-10">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full bg-primary text-on-primary text-[10px] font-bold uppercase tracking-wider">
                        Gói cao cấp
                      </span>
                      <span className="text-[11px] text-on-surface-variant">• Tự động gia hạn</span>
                    </div>
                    <h3 className="text-2xl font-extrabold text-on-surface tracking-tight">CollabCanvas Pro Team</h3>
                    <p className="text-xs text-on-surface-variant max-w-md">
                      Không giới hạn bảng vẽ, tính năng lịch sử phiên bản 90 ngày, cộng tác thời gian thực không giới hạn số người.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 z-10 w-full md:w-auto">
                    <button
                      type="button"
                      onClick={() => alert('Đang tải hóa đơn VAT và sao kê gần nhất...')}
                      className="px-4 py-2.5 rounded-xl bg-surface-container-lowest hover:bg-surface-dim text-on-surface text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 border border-outline-variant/20"
                    >
                      <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                      Hóa đơn &amp; VAT
                    </button>
                    <button
                      type="button"
                      onClick={() => alert('Liên hệ phòng kinh doanh Enterprise: enterprise@collabcanvas.io')}
                      className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-fixed text-on-primary text-xs font-bold transition-all shadow-md shadow-primary/20 flex items-center justify-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-[18px]">upgrade</span>
                      Nâng cấp Enterprise
                    </button>
                  </div>
                </div>

                {/* Storage Breakdown Visualizer */}
                <div className="p-4 rounded-xl bg-surface-container flex flex-col gap-4 border border-outline-variant/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[20px] text-primary">cloud_done</span>
                      <span className="text-sm font-bold text-on-surface">Phân tích dung lượng tệp</span>
                    </div>
                    <span className="text-xs font-semibold text-on-surface">14.8 GB / 100 GB (14.8%)</span>
                  </div>

                  {/* Segmented Progress Bar */}
                  <div className="w-full h-3 rounded-full bg-surface-container-lowest overflow-hidden flex">
                    <div className="bg-primary h-full transition-all" style={{ width: '2.4%' }} title="Vector: 2.4 GB" />
                    <div className="bg-secondary h-full transition-all" style={{ width: '11.2%' }} title="Hình ảnh: 11.2 GB" />
                    <div
                      className="bg-tertiary-container h-full transition-all"
                      style={{ width: '1.2%' }}
                      title="Tài liệu: 1.2 GB"
                    />
                  </div>

                  {/* Legend */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-sm bg-primary shrink-0" />
                      <div className="flex flex-col">
                        <span className="text-[11px] text-on-surface font-semibold">Dữ liệu Vector &amp; Canvas</span>
                        <span className="text-[10px] text-on-surface-variant">2.4 GB (128 bảng vẽ)</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-sm bg-secondary shrink-0" />
                      <div className="flex flex-col">
                        <span className="text-[11px] text-on-surface font-semibold">Hình ảnh &amp; Media tải lên</span>
                        <span className="text-[10px] text-on-surface-variant">11.2 GB (1.420 tệp)</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-sm bg-tertiary-container shrink-0" />
                      <div className="flex flex-col">
                        <span className="text-[11px] text-on-surface font-semibold">Tài liệu PDF &amp; Đính kèm</span>
                        <span className="text-[10px] text-on-surface-variant">1.2 GB (45 tệp)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* 5. Danger Zone (Vùng nguy hiểm) */}
              <section className="rounded-2xl bg-surface-container-lowest p-6 sm:p-8 flex flex-col gap-4 shadow-md border border-rose-500/20">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-error-container/30 flex items-center justify-center text-error">
                    <span className="material-symbols-outlined text-[20px]">warning</span>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-error">Vùng bảo mật đặc biệt</h3>
                    <p className="text-xs text-on-surface-variant">
                      Các tác vụ xóa hoặc vô hiệu hóa tài khoản không thể phục hồi sau 30 ngày.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-surface-container-low border border-outline-variant/20">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-on-surface">Xóa vĩnh viễn tài khoản cá nhân</span>
                    <span className="text-xs text-on-surface-variant max-w-xl mt-0.5">
                      Tất cả bảng vẽ riêng tư, lịch sử con trỏ và dữ liệu liên kết sẽ bị xóa vĩnh viễn khỏi đám mây CollabCanvas.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsDeleteModalOpen(true)}
                    className="px-4 py-2.5 rounded-xl bg-error-container/20 hover:bg-error-container/40 text-error text-xs font-bold transition-colors whitespace-nowrap self-start sm:self-auto flex items-center gap-1.5 border border-error/30"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete_forever</span>
                    Xóa tài khoản...
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      </main>

      {/* Delete Account Confirmation Modal */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-surface-container-high border border-rose-500/40 rounded-2xl p-6 shadow-2xl flex flex-col gap-4 text-left">
            <div className="flex items-center gap-3 text-rose-400">
              <span className="material-symbols-outlined text-[28px]">warning</span>
              <h3 className="text-lg font-bold">Xác nhận xóa tài khoản vĩnh viễn</h3>
            </div>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              Hành động này <strong className="text-rose-400">không thể hoàn tác</strong>. Mọi không gian làm việc,
              nhiệm vụ và dữ liệu cá nhân liên quan đến tài khoản <strong>{user.email}</strong> sẽ bị xóa sạch khỏi hệ thống.
            </p>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-300">
                Để tiếp tục, vui lòng gõ chính xác cụm từ <strong className="text-white">XÓA TÀI KHOẢN</strong>:
              </span>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="XÓA TÀI KHOẢN"
                className="w-full px-3 py-2 rounded-xl bg-surface-container border border-rose-500/40 text-sm text-white focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-end gap-3 mt-2">
              <button
                type="button"
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setDeleteConfirmText('');
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-surface-container"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={deleteConfirmText !== 'XÓA TÀI KHOẢN' || isDeletingAccount}
                onClick={handleDeleteAccount}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40 transition-colors"
              >
                {isDeletingAccount ? 'Đang xóa...' : 'Xóa vĩnh viễn'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
