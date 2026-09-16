export const LPF_LOGO_URL = '/LOGO_OFICIAL_LPF.png';
export const USER_AVATAR_URL = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80';

export interface ClubBranding {
  code: string;
  logoUrl: string;
}

const CLUB_BRANDING: Record<string, ClubBranding> = {
  alianza: { code: 'ALI', logoUrl: '/image copy.png' },
  tauro: { code: 'TAU', logoUrl: '/image copy 2.png' },
  clubdeportivouniversitario: { code: 'CDU', logoUrl: '/image copy 3.png' },
  veraguasunitedfc: { code: 'VER', logoUrl: '/image copy 4.png' },
  umecitfc: { code: 'UME', logoUrl: '/image copy 5.png' },
  sporting: { code: 'SSM', logoUrl: '/image copy 6.png' },
  sanfrancisco: { code: 'SFC', logoUrl: '/image copy 7.png' },
  arabeunido: { code: 'DAU', logoUrl: '/image copy 8.png' },
  cai: { code: 'CAI', logoUrl: '/image copy 9.png' },
  herrerafc: { code: 'HER', logoUrl: '/image copy 10.png' },
  unioncoclefc: { code: 'UCO', logoUrl: '/image copy 11.png' },
  plazaamador: { code: 'PLA', logoUrl: '/logoplaza.png' },
};

const normalizeClubName = (name: string) => name
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]/gi, '')
  .toLowerCase();

export const getClubBranding = (name: string, fallbackCode: string): ClubBranding => (
  CLUB_BRANDING[normalizeClubName(name)] ?? { code: fallbackCode, logoUrl: '' }
);

export interface AvatarPreset { id: string; name: string; url: string; role: string }

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'av-panagol', name: 'Panagol Clásico', url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80', role: 'Mánager Titular' },
  { id: 'av-dt-suit', name: 'DT Táctico Elegante', url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80', role: 'Estratega de Traje' },
  { id: 'av-dt-cap', name: 'DT de Cancha & Gorra', url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80', role: 'Entrenador de Campo' },
  { id: 'av-veteran', name: 'Mánager Experimentado', url: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&auto=format&fit=crop&q=80', role: 'Director Deportivo' },
  { id: 'av-analyst', name: 'Analista de Datos LPF', url: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=200&auto=format&fit=crop&q=80', role: 'Scouting y táctica' },
  { id: 'av-champ', name: 'DT Campeón LPF', url: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=200&auto=format&fit=crop&q=80', role: 'Líder de copa' },
];
