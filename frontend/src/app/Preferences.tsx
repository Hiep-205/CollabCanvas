import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

const messages = {
  vi: {
    currentWorkspace: 'Không gian hiện tại', workspace: 'Đồ án 2', localSaved: 'Đã lưu cục bộ', saving: 'Đang lưu...', saveFailed: 'Lưu thất bại',
    openDetails: 'Mở bảng chi tiết', closeDetails: 'Đóng bảng chi tiết', sampleAccount: 'Tài khoản mẫu', canvasTools: 'Công cụ canvas',
    canvas: 'Canvas', addNote: 'Thêm ghi chú', addTask: 'Thêm công việc', fitView: 'Căn vừa nội dung', help: 'Trợ giúp',
    workspaceEyebrow: 'KHÔNG GIAN LÀM VIỆC', boardTitle: 'Bảng ý tưởng', canvasItems: 'mục trên canvas',
    detailsEyebrow: 'CHI TIẾT', note: 'Ghi chú', task: 'Công việc', inspector: 'Bảng điều khiển', clearSelection: 'Bỏ chọn',
    content: 'Nội dung', noteColor: 'Màu ghi chú', yellow: 'Vàng', green: 'Xanh', pink: 'Hồng', deleteNote: 'Xóa ghi chú',
    title: 'Tiêu đề', status: 'Trạng thái', removeFromCanvas: 'Gỡ khỏi canvas', taskRemains: 'Công việc vẫn còn trong danh sách sau khi gỡ thẻ khỏi canvas.',
    noSelection: 'Chưa chọn mục nào', unplaced: 'Chưa đặt lên canvas', allPlaced: 'Tất cả công việc đã có trên canvas.', placeOnCanvas: 'Đặt lên canvas',
    newNote: 'Ghi chú mới', newTask: 'Công việc mới', missingTask: 'Công việc không còn tồn tại',
    TODO: 'Cần làm', IN_PROGRESS: 'Đang làm', DONE: 'Hoàn thành',
    lightMode: 'Chế độ sáng', darkMode: 'Chế độ tối', language: 'Ngôn ngữ',
    helpText: 'Chọn một node để chỉnh sửa. Kéo từ chấm tròn bên phải sang node khác để nối dây. Dữ liệu được lưu trên trình duyệt này.',
  },
  en: {
    currentWorkspace: 'Current workspace', workspace: 'Project 2', localSaved: 'Saved locally', saving: 'Saving...', saveFailed: 'Save failed',
    openDetails: 'Open details', closeDetails: 'Close details', sampleAccount: 'Sample account', canvasTools: 'Canvas tools',
    canvas: 'Canvas', addNote: 'Add note', addTask: 'Add task', fitView: 'Fit to content', help: 'Help',
    workspaceEyebrow: 'WORKSPACE', boardTitle: 'Idea board', canvasItems: 'items on canvas',
    detailsEyebrow: 'DETAILS', note: 'Note', task: 'Task', inspector: 'Inspector', clearSelection: 'Clear selection',
    content: 'Content', noteColor: 'Note color', yellow: 'Yellow', green: 'Green', pink: 'Pink', deleteNote: 'Delete note',
    title: 'Title', status: 'Status', removeFromCanvas: 'Remove from canvas', taskRemains: 'The task stays in your list after removing its canvas card.',
    noSelection: 'Nothing selected', unplaced: 'Not on canvas', allPlaced: 'All tasks are on the canvas.', placeOnCanvas: 'Place on canvas',
    newNote: 'New note', newTask: 'New task', missingTask: 'Task no longer exists',
    TODO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done',
    lightMode: 'Light mode', darkMode: 'Dark mode', language: 'Language',
    helpText: 'Select a node to edit it. Drag from the right handle to another node to connect them. Data is saved in this browser.',
  },
} as const;

export type TranslationKey = keyof typeof messages.vi;
type Locale = keyof typeof messages;
type Theme = 'light' | 'dark';
type Preferences = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  t: (key: TranslationKey) => string;
};

const PreferencesContext = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => localStorage.getItem('collabcanvas.locale') === 'en' ? 'en' : 'vi');
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('collabcanvas.theme');
    return saved === 'light' || saved === 'dark' ? saved : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('collabcanvas.theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem('collabcanvas.locale', locale);
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, theme, setTheme, t: (key: TranslationKey) => messages[locale][key] }), [locale, theme]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('PreferencesProvider is missing');
  return context;
}
