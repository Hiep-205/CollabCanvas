export interface UserColor {
  name: string;
  bg: string;
  border: string;
  ring: string;
  text: string;
  hex: string;
}

export const USER_PALETTES: UserColor[] = [
  { name: 'teal', bg: 'bg-teal-600', border: 'border-teal-400', ring: 'ring-teal-400', text: 'text-white', hex: '#0d9488' },
  { name: 'indigo', bg: 'bg-indigo-600', border: 'border-indigo-400', ring: 'ring-indigo-400', text: 'text-white', hex: '#4f46e5' },
  { name: 'emerald', bg: 'bg-emerald-600', border: 'border-emerald-400', ring: 'ring-emerald-400', text: 'text-white', hex: '#059669' },
  { name: 'amber', bg: 'bg-amber-600', border: 'border-amber-400', ring: 'ring-amber-400', text: 'text-white', hex: '#d97706' },
  { name: 'rose', bg: 'bg-rose-600', border: 'border-rose-400', ring: 'ring-rose-400', text: 'text-white', hex: '#e11d48' },
  { name: 'sky', bg: 'bg-sky-600', border: 'border-sky-400', ring: 'ring-sky-400', text: 'text-white', hex: '#0284c7' },
  { name: 'purple', bg: 'bg-purple-600', border: 'border-purple-400', ring: 'ring-purple-400', text: 'text-white', hex: '#9333ea' },
  { name: 'pink', bg: 'bg-pink-600', border: 'border-pink-400', ring: 'ring-pink-400', text: 'text-white', hex: '#db2777' },
  { name: 'cyan', bg: 'bg-cyan-600', border: 'border-cyan-400', ring: 'ring-cyan-400', text: 'text-white', hex: '#0891b2' },
  { name: 'orange', bg: 'bg-orange-600', border: 'border-orange-400', ring: 'ring-orange-400', text: 'text-white', hex: '#ea580c' },
];

/**
 * Deterministically generates a stable color palette based on userId string hash.
 */
export function getUserColor(userId?: string): UserColor {
  if (!userId) return USER_PALETTES[0];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % USER_PALETTES.length;
  return USER_PALETTES[index];
}

/**
 * Returns a 2-letter uppercase initials string from displayName or email.
 */
export function getInitials(displayName?: string, email?: string): string {
  const name = (displayName && displayName.trim()) || '';
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const first = Array.from(parts[0])[0];
      const last = Array.from(parts[parts.length - 1])[0];
      return (first + last).toUpperCase();
    }
    if (parts.length === 1) {
      return Array.from(parts[0]).slice(0, 2).join('').toUpperCase();
    }
  }
  if (email && email.trim()) {
    const prefix = email.split('@')[0].trim();
    const chars = Array.from(prefix);
    if (chars.length >= 2) {
      return chars.slice(0, 2).join('').toUpperCase();
    }
    if (chars.length === 1) {
      return chars[0].toUpperCase();
    }
  }
  return '??';
}
