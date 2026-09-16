import { api, ApiError, jsonBody } from './apiClient';

export interface AuthUser {
  id: string;
  name: string;
  managerName?: string;
  username: string;
  email: string;
  createdAt: string;
  avatarUrl?: string;
  favoriteClubId?: string;
  province?: string;
  phone?: string;
  onboardingCompleted?: boolean;
}

type AuthResult = { success: boolean; user?: AuthUser; error?: string };

type ApiUser = {
  id: string;
  email: string;
  username: string;
  createdAt: string;
  profile: {
    managerName: string;
    province: string;
    phone?: string;
    favoriteClubId?: string | null;
    avatarUrl?: string;
  };
};

function toAuthUser(user: ApiUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    createdAt: user.createdAt,
    name: user.profile.managerName,
    managerName: user.profile.managerName,
    favoriteClubId: user.profile.favoriteClubId ?? undefined,
    province: user.profile.province || undefined,
    phone: user.profile.phone || undefined,
    avatarUrl: user.profile.avatarUrl || undefined,
  };
}

class AuthService {
  private currentUser: AuthUser | null = null;
  getCurrentUser(): AuthUser | null { return this.currentUser; }

  async restoreSession(): Promise<AuthUser | null> {
    try {
      const result = await api<{ user: ApiUser }>('/me');
      this.currentUser = toAuthUser(result.user);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) console.error(error);
      this.currentUser = null;
    }
    return this.currentUser;
  }

  async signUp(params: { name: string; username: string; email: string; password: string; favoriteClubId?: string }): Promise<AuthResult> {
    try {
      const result = await api<{ user: ApiUser }>('/auth/register', {
        method: 'POST',
        ...jsonBody({ managerName: params.name, username: params.username, email: params.email, password: params.password }),
      });
      let apiUser = result.user;
      if (params.favoriteClubId) {
        const profile = await api<{ user: ApiUser }>('/profile', {
          method: 'PATCH', ...jsonBody({ favoriteClubId: params.favoriteClubId }),
        });
        apiUser = profile.user;
      }
      this.currentUser = toAuthUser(apiUser);
      return { success: true, user: this.currentUser };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'No se pudo crear la cuenta.' };
    }
  }

  async signIn(emailOrUsername: string, password: string): Promise<AuthResult> {
    try {
      const result = await api<{ user: ApiUser }>('/auth/login', {
        method: 'POST', ...jsonBody({ email: emailOrUsername, password }),
      });
      this.currentUser = toAuthUser(result.user);
      return { success: true, user: this.currentUser };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'No se pudo iniciar sesión.' };
    }
  }

  async signOut(): Promise<void> {
    await api('/auth/logout', { method: 'POST' });
    this.currentUser = null;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await api('/auth/change-password', {
      method: 'POST', ...jsonBody({ currentPassword, newPassword }),
    });
  }
}

export const authService = new AuthService();
