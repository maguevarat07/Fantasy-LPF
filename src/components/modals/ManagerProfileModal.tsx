import React, { useState, useRef, useMemo, useEffect } from 'react';
import { UserProfile } from '../../types/fantasy';
import { AVATAR_PRESETS, USER_AVATAR_URL } from '../../data/assets';
import { authService } from '../../services/authService';
import { lpfDataService } from '../../services/lpfDataService';
import {
  User,
  Key,
  Camera,
  Upload,
  LogOut,
  Check,
  X,
  Lock,
  Mail,
  Phone,
  MapPin,
  Trophy,
  Copy,
  CheckCheck,
  Eye,
  EyeOff,
  Bell,
  Sparkles,
  AlertTriangle,
  RotateCcw,
  Image as ImageIcon,
  Globe
} from 'lucide-react';

interface ManagerProfileModalProps {
  userProfile: UserProfile;
  totalPoints?: number;
  globalRank?: number;
  onClose: () => void;
  onSaveProfile: (updatedProfile: UserProfile) => void;
  onLogout: () => void;
}

const PANAMA_PROVINCES = [
  'Panamá',
  'Panamá Oeste',
  'Colón',
  'Chiriquí',
  'Coclé',
  'Veraguas',
  'Herrera',
  'Los Santos',
  'Bocas del Toro',
  'Darién'
];

export const ManagerProfileModal: React.FC<ManagerProfileModalProps> = ({
  userProfile,
  totalPoints = 0,
  globalRank = 142,
  onClose,
  onSaveProfile,
  onLogout
}) => {
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'personal' | 'security' | 'preferences'>('personal');

  // Form states - Personal Data
  const [avatarUrl, setAvatarUrl] = useState(userProfile.avatarUrl);
  const [username, setUsername] = useState(userProfile.username);
  const [managerName, setManagerName] = useState(userProfile.managerName);
  const [teamName, setTeamName] = useState(userProfile.teamName);
  const [email, setEmail] = useState(userProfile.email);
  const [phone, setPhone] = useState(userProfile.phone);
  const [province, setProvince] = useState(userProfile.province);
  const [favoriteClubId, setFavoriteClubId] = useState(userProfile.favoriteClubId);

  // Photo Picker Modal / Overlay State (triggered by camera button)
  const [isPhotoPickerOpen, setIsPhotoPickerOpen] = useState(false);
  const [customUrlInput, setCustomUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);

  // Tracks a broken image load without touching the actual avatarUrl form value,
  // so a failed fetch never gets mistaken for an intentional profile change.
  const [avatarImgFailed, setAvatarImgFailed] = useState(false);
  useEffect(() => {
    setAvatarImgFailed(false);
  }, [avatarUrl]);

  // Form states - Security / Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pwFeedback, setPwFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Form states - Preferences
  const [notificationsEnabled, setNotificationsEnabled] = useState(userProfile.notificationsEnabled);
  const [emailAlertsEnabled, setEmailAlertsEnabled] = useState(userProfile.emailAlertsEnabled);

  // Modal State for Logout Confirmation
  const [isConfirmingLogout, setIsConfirmingLogout] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [savedSuccessMsg, setSavedSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if any modification has been made to the profile
  const hasChanges = useMemo(() => {
    return (
      avatarUrl !== userProfile.avatarUrl ||
      username.replace(/^@/, '').trim() !== userProfile.username.replace(/^@/, '') ||
      managerName.trim() !== userProfile.managerName ||
      teamName.trim() !== userProfile.teamName ||
      email.trim() !== userProfile.email ||
      phone.trim() !== userProfile.phone ||
      province !== userProfile.province ||
      favoriteClubId !== userProfile.favoriteClubId ||
      notificationsEnabled !== userProfile.notificationsEnabled ||
      emailAlertsEnabled !== userProfile.emailAlertsEnabled
    );
  }, [
    avatarUrl,
    username,
    managerName,
    teamName,
    email,
    phone,
    province,
    favoriteClubId,
    notificationsEnabled,
    emailAlertsEnabled,
    userProfile
  ]);

  // Cancel / Revert all changes
  const handleCancelChanges = () => {
    setAvatarUrl(userProfile.avatarUrl);
    setUsername(userProfile.username);
    setManagerName(userProfile.managerName);
    setTeamName(userProfile.teamName);
    setEmail(userProfile.email);
    setPhone(userProfile.phone);
    setProvince(userProfile.province);
    setFavoriteClubId(userProfile.favoriteClubId);
    setNotificationsEnabled(userProfile.notificationsEnabled);
    setEmailAlertsEnabled(userProfile.emailAlertsEnabled);
  };

  // Password Strength Calculation
  const getPasswordStrength = (pw: string) => {
    if (!pw) return { score: 0, label: 'Sin ingresar', color: 'bg-surface-container-high' };
    let score = 0;
    if (pw.length >= 8) score += 1;
    if (/[A-Z]/.test(pw)) score += 1;
    if (/[0-9]/.test(pw)) score += 1;
    if (/[^A-Za-z0-9]/.test(pw)) score += 1;

    if (score <= 1) return { score: 25, label: 'Débil', color: 'bg-red-500' };
    if (score === 2) return { score: 50, label: 'Regular', color: 'bg-amber-500' };
    if (score === 3) return { score: 75, label: 'Buena', color: 'bg-blue-500' };
    return { score: 100, label: 'Muy Segura', color: 'bg-emerald-500' };
  };

  const pwStrength = getPasswordStrength(newPassword);

  // Copy Membership ID
  const handleCopyMembershipId = () => {
    navigator.clipboard?.writeText(userProfile.membershipId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  // Handle Local File Upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert('El archivo no debe superar los 5MB');
        return;
      }
      const reader = new FileReader();
      reader.onload = event => {
        if (event.target?.result) {
          setAvatarUrl(event.target.result as string);
          setSavedSuccessMsg('¡Foto cargada!');
          setTimeout(() => setSavedSuccessMsg(null), 2500);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle Custom URL apply
  const handleApplyCustomUrl = () => {
    if (customUrlInput.trim()) {
      setAvatarUrl(customUrlInput.trim());
      setShowUrlInput(false);
      setCustomUrlInput('');
      setSavedSuccessMsg('¡Foto actualizada desde URL!');
      setTimeout(() => setSavedSuccessMsg(null), 2500);
    }
  };

  // Handle Password Update
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwFeedback(null);

    if (!currentPassword) {
      setPwFeedback({ type: 'error', message: 'Debes ingresar tu contraseña actual para continuar' });
      return;
    }
    if (newPassword.length < 10) {
      setPwFeedback({ type: 'error', message: 'La nueva contraseña debe tener al menos 10 caracteres' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwFeedback({ type: 'error', message: 'Las nuevas contraseñas no coinciden' });
      return;
    }

    try {
      await authService.changePassword(currentPassword, newPassword);
      setPwFeedback({ type: 'success', message: '¡Contraseña actualizada correctamente! Tu cuenta está protegida.' });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (error) {
      setPwFeedback({ type: 'error', message: error instanceof Error ? error.message : 'No se pudo actualizar la contraseña.' });
    }
  };

  // Save All Changes
  const handleSaveAll = () => {
    const updated: UserProfile = {
      ...userProfile,
      // userProfile.username is always stored with a leading "@" elsewhere in the app;
      // keep that format here so a save doesn't make hasChanges see a false diff next time.
      username: `@${username.replace(/^@/, '').trim() || userProfile.username.replace(/^@/, '')}`,
      managerName: managerName.trim() || userProfile.managerName,
      teamName: teamName.trim() || userProfile.teamName,
      email: email.trim() || userProfile.email,
      phone: phone.trim() || userProfile.phone,
      province,
      favoriteClubId,
      avatarUrl,
      notificationsEnabled,
      emailAlertsEnabled
    };

    onSaveProfile(updated);
    setSavedSuccessMsg('¡Todos los cambios de tu perfil han sido guardados!');
    setTimeout(() => {
      setSavedSuccessMsg(null);
      onClose();
    }, 1000);
  };

  const clubs = lpfDataService.getClubs();
  const selectedClub = clubs.find(c => c.id === favoriteClubId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200"
      onClick={e => {
        if (e.target === e.currentTarget && !isConfirmingLogout && !isPhotoPickerOpen) onClose();
      }}
    >
      <div className="relative w-full max-w-xl bg-surface-container-lowest border border-surface-container-high/60 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] my-auto">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-container-high/50 bg-surface-container-low/70 backdrop-blur">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center text-primary">
              <User className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-headline-sm text-[16px] font-black uppercase tracking-wider text-on-surface">
                Mi Perfil de Mánager
              </h2>
              <span className="font-label-sm text-[11px] text-on-surface-variant flex items-center gap-1">
                Fantasy LPF · Torneo vigente
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-surface-container-high/80 hover:bg-surface-container-highest flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
            title="Cerrar perfil"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Global Feedback Toast inside modal */}
        {savedSuccessMsg && (
          <div className="px-5 py-2.5 bg-primary/20 border-b border-primary/40 flex items-center gap-2 text-primary font-headline-sm text-xs animate-in slide-in-from-top-2">
            <CheckCheck className="w-4 h-4 shrink-0" />
            <span>{savedSuccessMsg}</span>
          </div>
        )}

        {/* Top Profile Hero Card */}
        <div className="px-5 pt-4 pb-3 bg-gradient-to-b from-surface-container-low/90 to-surface-container-lowest border-b border-surface-container-high/40">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
            {/* Avatar with Camera edit trigger button */}
            <div className="relative group shrink-0">
              <div className="w-20 h-20 sm:w-22 sm:h-22 rounded-2xl overflow-hidden ring-4 ring-primary/40 shadow-xl bg-surface-container-highest">
                {!avatarImgFailed ? (
                  <img
                    src={avatarUrl || USER_AVATAR_URL}
                    alt={managerName}
                    className="w-full h-full object-cover"
                    onError={() => setAvatarImgFailed(true)}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-primary-container text-on-primary-container font-headline-md text-lg font-black">
                    {managerName.trim().slice(0, 2).toUpperCase() || 'DT'}
                  </div>
                )}
              </div>

              {/* Dedicated Camera Button to trigger Photo Selector */}
              <button
                type="button"
                onClick={() => setIsPhotoPickerOpen(true)}
                className="absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-xl bg-primary text-surface-container-lowest flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 transition-all cursor-pointer ring-2 ring-surface-container-lowest"
                title="Cambiar foto de perfil"
              >
                <Camera className="w-4 h-4" />
              </button>
            </div>

            {/* Manager info & LPF Badges */}
            <div className="flex-1 text-center sm:text-left min-w-0">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <h3 className="font-headline-md text-lg font-black text-on-surface tracking-tight truncate">
                  {managerName}
                </h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold uppercase tracking-wider">
                  <Sparkles className="w-3 h-3" /> Verificado
                </span>
              </div>

              <p className="font-body-md text-xs text-on-surface-variant font-mono mt-0.5">
                @{username.replace(/^@/, '')} · {teamName}
              </p>

              {/* Quick stats pills */}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-2.5">
                <div className="px-2.5 py-1 rounded-lg bg-surface-container-high/70 border border-surface-container-highest flex items-center gap-1.5 text-[11px]">
                  <Trophy className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-on-surface font-bold">{totalPoints} pts</span>
                  <span className="text-on-surface-variant text-[10px]">Total</span>
                </div>

                <div className="px-2.5 py-1 rounded-lg bg-surface-container-high/70 border border-surface-container-highest flex items-center gap-1.5 text-[11px]">
                  <span className="text-primary font-bold">#{globalRank}</span>
                  <span className="text-on-surface-variant text-[10px]">Rango Global</span>
                </div>

                <button
                  type="button"
                  onClick={handleCopyMembershipId}
                  className="px-2.5 py-1 rounded-lg bg-surface-container-high/70 hover:bg-surface-container-highest border border-surface-container-highest flex items-center gap-1.5 text-[11px] text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
                  title="Copiar ID de Mánager"
                >
                  <span className="font-mono text-[10px] font-bold text-on-surface">
                    {userProfile.membershipId}
                  </span>
                  {copiedId ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3 text-on-surface-variant" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 mt-4 p-1 bg-surface-container-high/60 rounded-xl border border-surface-container-highest/40">
            <button
              onClick={() => setActiveTab('personal')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg font-headline-sm text-xs uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === 'personal'
                  ? 'bg-surface-container-lowest text-primary shadow-sm font-black'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/50'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Datos</span>
            </button>

            <button
              onClick={() => setActiveTab('security')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg font-headline-sm text-xs uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === 'security'
                  ? 'bg-surface-container-lowest text-primary shadow-sm font-black'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/50'
              }`}
            >
              <Key className="w-3.5 h-3.5" />
              <span>Seguridad</span>
            </button>

            <button
              onClick={() => setActiveTab('preferences')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg font-headline-sm text-xs uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === 'preferences'
                  ? 'bg-surface-container-lowest text-primary shadow-sm font-black'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/50'
              }`}
            >
              <Bell className="w-3.5 h-3.5" />
              <span>Ajustes</span>
            </button>
          </div>
        </div>

        {/* Tab Content Body (Scrollable) */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* TAB 1: DATOS PERSONALES (Formulario limpio sin selector de foto integrado) */}
          {activeTab === 'personal' && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Username */}
                <div>
                  <label className="font-label-sm text-[11px] text-on-surface-variant uppercase tracking-wider block mb-1">
                    Username / Usuario
                  </label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-on-surface-variant font-mono text-xs">@</span>
                    <input
                      type="text"
                      value={username.replace(/^@/, '')}
                      onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                      className="w-full pl-7 pr-3 py-2 text-xs rounded-xl bg-surface-container-low border border-surface-container-high text-on-surface font-mono focus:outline-none focus:border-primary"
                      placeholder="nombre_usuario"
                    />
                  </div>
                </div>

                {/* Manager Name */}
                <div>
                  <label className="font-label-sm text-[11px] text-on-surface-variant uppercase tracking-wider block mb-1">
                    Nombre Completo del DT
                  </label>
                  <input
                    type="text"
                    value={managerName}
                    onChange={e => setManagerName(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-surface-container-low border border-surface-container-high text-on-surface focus:outline-none focus:border-primary"
                    placeholder="Carlos Mendoza"
                  />
                </div>

                {/* Team Name */}
                <div>
                  <label className="font-label-sm text-[11px] text-on-surface-variant uppercase tracking-wider block mb-1">
                    Nombre del Equipo Fantasy
                  </label>
                  <input
                    type="text"
                    value={teamName}
                    onChange={e => setTeamName(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-surface-container-low border border-surface-container-high text-on-surface focus:outline-none focus:border-primary"
                    placeholder="Marea Roja FC"
                  />
                </div>

                {/* Email Address */}
                <div>
                  <label className="font-label-sm text-[11px] text-on-surface-variant uppercase tracking-wider block mb-1">
                    Correo Electrónico
                  </label>
                  <div className="relative flex items-center">
                    <Mail className="w-3.5 h-3.5 absolute left-3 text-on-surface-variant" />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-surface-container-low border border-surface-container-high text-on-surface focus:outline-none focus:border-primary"
                      placeholder="correo@ejemplo.com"
                    />
                  </div>
                </div>

                {/* Phone */}
                <div>
                  <label className="font-label-sm text-[11px] text-on-surface-variant uppercase tracking-wider block mb-1">
                    Teléfono / Celular (Panamá)
                  </label>
                  <div className="relative flex items-center">
                    <Phone className="w-3.5 h-3.5 absolute left-3 text-on-surface-variant" />
                    <input
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-surface-container-low border border-surface-container-high text-on-surface focus:outline-none focus:border-primary"
                      placeholder="+507 6890-4421"
                    />
                  </div>
                </div>

                {/* Province */}
                <div>
                  <label className="font-label-sm text-[11px] text-on-surface-variant uppercase tracking-wider block mb-1">
                    Provincia / Región
                  </label>
                  <div className="relative flex items-center">
                    <MapPin className="w-3.5 h-3.5 absolute left-3 text-on-surface-variant pointer-events-none" />
                    <select
                      value={province}
                      onChange={e => setProvince(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-surface-container-low border border-surface-container-high text-on-surface focus:outline-none focus:border-primary appearance-none cursor-pointer"
                    >
                      {PANAMA_PROVINCES.map(prov => (
                        <option key={prov} value={prov} className="bg-surface-container-lowest text-on-surface">
                          {prov}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Favorite Club */}
                <div className="sm:col-span-2">
                  <label className="font-label-sm text-[11px] text-on-surface-variant uppercase tracking-wider block mb-1">
                    Club Favorito LPF
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={favoriteClubId}
                      onChange={e => setFavoriteClubId(e.target.value)}
                      className="flex-1 px-3 py-2 text-xs rounded-xl bg-surface-container-low border border-surface-container-high text-on-surface focus:outline-none focus:border-primary cursor-pointer"
                    >
                      {clubs.map(club => (
                        <option key={club.id} value={club.id} className="bg-surface-container-lowest text-on-surface">
                          {club.name} ({club.city})
                        </option>
                      ))}
                    </select>

                    {selectedClub && (
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-container-high/60 border border-surface-container-highest shrink-0">
                        <img src={selectedClub.logoUrl} alt={selectedClub.name} className="w-5 h-5 object-contain" />
                        <span className="font-mono font-bold text-xs text-primary">{selectedClub.code}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SEGURIDAD & CONTRASEÑA (Sin verificación en dos pasos) */}
          {activeTab === 'security' && (
            <div className="space-y-4">
              <form onSubmit={handleUpdatePassword} className="p-4 rounded-2xl bg-surface-container-low border border-surface-container-high/60 space-y-3.5">
                <div className="flex items-center gap-2 pb-2 border-b border-surface-container-high/50">
                  <Lock className="w-4 h-4 text-primary" />
                  <div>
                    <h4 className="font-headline-sm text-xs font-bold uppercase tracking-wider text-on-surface">
                      Cambiar Contraseña de tu Cuenta
                    </h4>
                    <span className="text-[11px] text-on-surface-variant">
                      Actualiza tus credenciales para mantener tu equipo seguro
                    </span>
                  </div>
                </div>

                {/* Feedback message */}
                {pwFeedback && (
                  <div
                    className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                      pwFeedback.type === 'success'
                        ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                        : 'bg-red-500/15 border border-red-500/30 text-red-400'
                    }`}
                  >
                    {pwFeedback.type === 'success' ? <Check className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                    <span>{pwFeedback.message}</span>
                  </div>
                )}

                {/* Current Password */}
                <div>
                  <label className="font-label-sm text-[11px] text-on-surface-variant uppercase tracking-wider block mb-1">
                    Contraseña Actual
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showCurrentPw ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-2 pr-9 text-xs rounded-xl bg-surface-container-lowest border border-surface-container-high text-on-surface focus:outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPw(!showCurrentPw)}
                      className="absolute right-3 text-on-surface-variant hover:text-on-surface"
                    >
                      {showCurrentPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* New Password */}
                <div>
                  <label className="font-label-sm text-[11px] text-on-surface-variant uppercase tracking-wider block mb-1">
                    Nueva Contraseña
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showNewPw ? 'text' : 'password'}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="Mínimo 10 caracteres"
                      className="w-full px-3 py-2 pr-9 text-xs rounded-xl bg-surface-container-lowest border border-surface-container-high text-on-surface focus:outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPw(!showNewPw)}
                      className="absolute right-3 text-on-surface-variant hover:text-on-surface"
                    >
                      {showNewPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {/* Password strength bar */}
                  {newPassword && (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-on-surface-variant">Seguridad:</span>
                        <span className="font-bold text-on-surface">{pwStrength.label}</span>
                      </div>
                      <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${pwStrength.color}`}
                          style={{ width: `${pwStrength.score}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Confirm New Password */}
                <div>
                  <label className="font-label-sm text-[11px] text-on-surface-variant uppercase tracking-wider block mb-1">
                    Confirmar Nueva Contraseña
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showConfirmPw ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="Repite la nueva contraseña"
                      className="w-full px-3 py-2 pr-9 text-xs rounded-xl bg-surface-container-lowest border border-surface-container-high text-on-surface focus:outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPw(!showConfirmPw)}
                      className="absolute right-3 text-on-surface-variant hover:text-on-surface"
                    >
                      {showConfirmPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-2 px-4 rounded-xl bg-primary hover:brightness-110 text-surface-container-lowest font-headline-sm text-xs font-bold uppercase tracking-wider active:scale-[0.99] transition-all cursor-pointer shadow-md"
                >
                  Actualizar Contraseña
                </button>
              </form>

              {/* Active Sessions */}
              <div className="p-3.5 rounded-2xl bg-surface-container-low border border-surface-container-high/60 space-y-2">
                <span className="font-label-sm text-[10px] text-on-surface-variant uppercase tracking-wider block">
                  Sesión Activa
                </span>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-on-surface font-semibold">Navegador Web · Ciudad de Panamá</span>
                  </div>
                  <span className="text-primary text-[11px] font-bold">Activo ahora</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: AJUSTES (Sin información de registro para reducir sobrecarga cognitiva) */}
          {activeTab === 'preferences' && (
            <div className="space-y-3">
              {/* Notification 1: Gameweek Deadline */}
              <div className="p-3.5 rounded-2xl bg-surface-container-low border border-surface-container-high/60 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-surface-container-high flex items-center justify-center text-primary">
                    <Bell className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="font-headline-sm text-xs font-bold text-on-surface">
                      Alerta de Cierre de Jornada
                    </h5>
                    <p className="text-[11px] text-on-surface-variant">
                      Aviso 1 hora antes del pitazo inicial para guardar tu alineación
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                  className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
                    notificationsEnabled ? 'bg-primary' : 'bg-surface-container-highest'
                  }`}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${
                      notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Notification 2: Email Alerts */}
              <div className="p-3.5 rounded-2xl bg-surface-container-low border border-surface-container-high/60 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-surface-container-high flex items-center justify-center text-primary">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="font-headline-sm text-xs font-bold text-on-surface">
                      Resumen Semanal por Correo
                    </h5>
                    <p className="text-[11px] text-on-surface-variant">
                      Tabla de posiciones, puntos anotados y estadísticas al final de cada jornada
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setEmailAlertsEnabled(!emailAlertsEnabled)}
                  className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
                    emailAlertsEnabled ? 'bg-primary' : 'bg-surface-container-highest'
                  }`}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${
                      emailAlertsEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions: Guardar Cambios y Cancelar SOLO se muestran si hubo modificaciones */}
        <div className="p-4 border-t border-surface-container-high/60 bg-surface-container-low/70 flex items-center justify-between gap-3 min-h-[64px]">
          {/* Logout Button */}
          <button
            type="button"
            onClick={() => setIsConfirmingLogout(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Cerrar Sesión</span>
          </button>

          {/* Right actions: Only shown when modifications have occurred */}
          {hasChanges ? (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200">
              <button
                type="button"
                onClick={handleCancelChanges}
                className="px-3.5 py-2 rounded-xl text-on-surface-variant hover:text-on-surface text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleSaveAll}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary hover:brightness-110 text-surface-container-lowest font-headline-sm text-xs font-bold uppercase tracking-wider active:scale-95 transition-all cursor-pointer shadow-md"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Guardar Cambios</span>
              </button>
            </div>
          ) : (
            <span className="text-[11px] text-on-surface-variant/70 font-mono hidden sm:inline-block">
              Sin cambios pendientes
            </span>
          )}
        </div>

        {/* ======================================================== */}
        {/* DEDICATED PHOTO PICKER OVERLAY MODAL (TRIGGERED BY CAMERA) */}
        {/* ======================================================== */}
        {isPhotoPickerOpen && (
          <div className="absolute inset-0 z-30 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-surface-container-lowest border border-surface-container-high rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              {/* Photo Picker Header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-container-high/50 bg-surface-container-low">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center text-primary">
                    <Camera className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-headline-sm text-sm font-black uppercase tracking-wider text-on-surface">
                      Cambiar Foto de Perfil
                    </h3>
                    <p className="text-[10px] text-on-surface-variant">
                      Selecciona un avatar de la LPF o sube tu propia foto
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsPhotoPickerOpen(false)}
                  className="w-7 h-7 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Photo Picker Content */}
              <div className="p-4 overflow-y-auto space-y-4 flex-1">
                {/* Current Active Preview */}
                <div className="flex items-center gap-3.5 p-3 rounded-2xl bg-surface-container-low border border-surface-container-high/60">
                  <div className="w-16 h-16 rounded-xl overflow-hidden ring-2 ring-primary/50 shadow-md bg-surface-container-highest shrink-0">
                    <img src={avatarUrl || USER_AVATAR_URL} alt="Vista previa" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-label-sm text-[10px] text-on-surface-variant uppercase tracking-wider block">
                      Vista Previa Actual
                    </span>
                    <p className="text-xs font-bold text-on-surface truncate">
                      {managerName}
                    </p>
                    <button
                      type="button"
                      onClick={() => setAvatarUrl(AVATAR_PRESETS[0].url)}
                      className="inline-flex items-center gap-1 mt-1 text-[11px] text-primary hover:underline cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Restablecer inicial</span>
                    </button>
                  </div>
                </div>

                {/* Hidden local file input */}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*"
                  className="hidden"
                />

                {/* Tactical Avatars Grid */}
                <div className="space-y-2">
                  <span className="font-label-sm text-[11px] text-on-surface-variant uppercase tracking-wider block">
                    Avatares Oficiales LPF
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {AVATAR_PRESETS.map(preset => {
                      const isSelected = avatarUrl === preset.url;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setAvatarUrl(preset.url)}
                          className={`flex flex-col items-center p-2 rounded-xl border transition-all cursor-pointer group ${
                            isSelected
                              ? 'bg-primary/15 border-primary shadow-sm'
                              : 'bg-surface-container hover:bg-surface-container-high border-surface-container-high/40'
                          }`}
                        >
                          <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-white/20">
                            <img src={preset.url} alt={preset.name} className="w-full h-full object-cover" />
                            {isSelected && (
                              <div className="absolute inset-0 bg-primary/40 flex items-center justify-center">
                                <Check className="w-4 h-4 text-white font-bold" />
                              </div>
                            )}
                          </div>
                          <span className="font-body-sm text-[10px] text-on-surface font-semibold truncate w-full text-center mt-1">
                            {preset.name}
                          </span>
                          <span className="text-[9px] text-on-surface-variant truncate w-full text-center">
                            {preset.role}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Upload & URL options */}
                <div className="space-y-2 pt-1 border-t border-surface-container-high/50">
                  <span className="font-label-sm text-[11px] text-on-surface-variant uppercase tracking-wider block">
                    Foto Personalizada
                  </span>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high border border-surface-container-high text-on-surface text-xs font-semibold cursor-pointer transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5 text-primary" />
                      <span>Subir archivo</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowUrlInput(!showUrlInput)}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high border border-surface-container-high text-on-surface text-xs font-semibold cursor-pointer transition-colors"
                    >
                      <Globe className="w-3.5 h-3.5 text-primary" />
                      <span>{showUrlInput ? 'Ocultar URL' : 'Desde URL'}</span>
                    </button>
                  </div>

                  {/* URL Input */}
                  {showUrlInput && (
                    <div className="flex items-center gap-2 pt-1 animate-in fade-in">
                      <input
                        type="url"
                        placeholder="https://ejemplo.com/foto.jpg"
                        value={customUrlInput}
                        onChange={e => setCustomUrlInput(e.target.value)}
                        className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-surface-container-lowest border border-surface-container-high text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        onClick={handleApplyCustomUrl}
                        className="px-3 py-1.5 rounded-xl bg-primary text-surface-container-lowest text-xs font-bold uppercase tracking-wider hover:brightness-110 active:scale-95 transition-all cursor-pointer"
                      >
                        Aplicar
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Photo Picker Footer */}
              <div className="p-3 border-t border-surface-container-high/60 bg-surface-container-low flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsPhotoPickerOpen(false)}
                  className="px-4 py-2 rounded-xl bg-primary text-surface-container-lowest font-headline-sm text-xs font-bold uppercase tracking-wider hover:brightness-110 active:scale-95 transition-all cursor-pointer shadow-md"
                >
                  Listo
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* LOGOUT CONFIRMATION DIALOG */}
        {/* ======================================================== */}
        {isConfirmingLogout && (
          <div className="absolute inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="w-full max-w-sm bg-surface-container rounded-2xl border border-red-500/40 p-5 shadow-2xl space-y-4 text-center">
              <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 mx-auto flex items-center justify-center">
                <LogOut className="w-6 h-6" />
              </div>

              <div className="space-y-1">
                <h4 className="font-headline-sm text-base font-bold text-on-surface">
                  ¿Cerrar Sesión en Fantasy LPF?
                </h4>
                <p className="text-xs text-on-surface-variant">
                  Saldrás de tu cuenta de mánager <span className="text-primary font-mono">@{username}</span>. Tu plantilla y tus {totalPoints} puntos quedarán guardados de forma segura.
                </p>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsConfirmingLogout(false)}
                  className="flex-1 py-2 px-3 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsConfirmingLogout(false);
                    onLogout();
                  }}
                  className="flex-1 py-2 px-3 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer shadow-lg shadow-red-900/30"
                >
                  Sí, Salir
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
