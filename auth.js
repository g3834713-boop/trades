// Supabase Auth Integration
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// A random ID persisted in this browser, sent alongside /users/sync so the backend's
// referral anti-farming check can tell "same person reusing their own browser" apart
// from "different people who happen to share a network" - matching on IP alone would
// wrongly penalize the second case (roommates, an office, a household).
function getOrCreateDeviceId() {
  try {
    let deviceId = localStorage.getItem('deviceId');
    if (!deviceId) {
      deviceId = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('deviceId', deviceId);
    }
    return deviceId;
  } catch (e) {
    return null;
  }
}

// Auth helpers
window.AuthService = {
  async register(email, password, fullName, phone, referralCode) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          phone: phone
        }
      }
    });
    
    if (error) throw error;
    
    // Check if email confirmation is required
    if (!data.session && data.user) {
      // Store referral code for later sync after email confirmation
      if (referralCode) {
        localStorage.setItem('pendingReferralCode', referralCode);
      }
      // Email confirmation required - user created but not logged in yet
      return { 
        user: data.user, 
        requiresEmailConfirmation: true,
        message: 'Please check your email to confirm your account before logging in.'
      };
    }
    
    // Sync user to backend (only if session exists)
    if (data.user && data.session) {
      try {
        const response = await fetch(`${CONFIG.API_URL}/users/sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${data.session.access_token}`
          },
          body: JSON.stringify({
            fullName,
            phone,
            referralCode: referralCode || localStorage.getItem('pendingReferralCode') || '',
            deviceId: getOrCreateDeviceId()
          })
        });

        // Clear stored referral code after sync
        localStorage.removeItem('pendingReferralCode');
        
        if (!response.ok) {
          console.error('Failed to sync user to backend');
        }
      } catch (syncError) {
        console.error('Error syncing user:', syncError);
        // Don't throw - registration was successful even if sync failed
      }
    }
    
    return data;
  },

  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    // Some accounts require a second factor (authenticator app) before they're fully
    // logged in - password-only sign-in only gets them to aal1. If a step-up to aal2
    // is required, stop here and let the caller collect a TOTP code instead of syncing/
    // proceeding as if login were complete.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== aal.nextLevel) {
      return { ...data, mfaRequired: true };
    }

    await this._syncAfterLogin(data);
    return data;
  },

  // Shared by both the direct login path and the post-MFA-verification path, so the
  // backend sync only ever happens once the session is actually fully authenticated.
  async _syncAfterLogin(data) {
    if (!data.session) return;
    try {
      const pendingRef = localStorage.getItem('pendingReferralCode') || '';
      const userMeta = data.user?.user_metadata || {};
      await fetch(`${CONFIG.API_URL}/users/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${data.session.access_token}`
        },
        body: JSON.stringify({
          fullName: userMeta.full_name || '',
          phone: userMeta.phone || '',
          referralCode: pendingRef,
          deviceId: getOrCreateDeviceId()
        })
      });
      localStorage.removeItem('pendingReferralCode');
    } catch (syncErr) {
      console.error('Login sync error:', syncErr);
    }
  },

  // --- TOTP / authenticator-app MFA ---
  // The secret/factor itself lives entirely in Supabase Auth; these are thin wrappers
  // around its MFA API used both at login (step-up challenge) and in Security Center
  // (enrollment).

  async getAssuranceLevel() {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw error;
    return data;
  },

  async listMfaFactors() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;
    return data;
  },

  async enrollTotp() {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
    if (error) throw error;
    return data;
  },

  async challengeMfa(factorId) {
    const { data, error } = await supabase.auth.mfa.challenge({ factorId });
    if (error) throw error;
    return data;
  },

  async verifyMfa(factorId, challengeId, code) {
    const { data, error } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
    if (error) throw error;
    return data;
  },

  // Completes a login that was paused for step-up (mfaRequired: true from login()).
  async completeMfaLogin(factorId, challengeId, code) {
    await this.verifyMfa(factorId, challengeId, code);
    const { data: sessionData } = await supabase.auth.getSession();
    await this._syncAfterLogin(sessionData);
    return sessionData;
  },

  async unenrollTotp(factorId) {
    const { data, error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) throw error;
    return data;
  },

  async logout() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async getSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
  },

  async getUser() {
    const { data } = await supabase.auth.getUser();
    return data.user;
  },

  async resetPasswordForEmail(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password.html`
    });
    if (error) throw error;
  },

  async updatePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }
};

function getVerificationStatusText(status) {
  return String(status || '').trim().toLowerCase();
}

function getVerificationRestrictionState(profile) {
  const required = Boolean(profile?.verification_required);
  const status = getVerificationStatusText(profile?.verification_status);
  const approved = status === 'approved' || status === 'verified';
  const isRestricted = required && !approved;

  return {
    required,
    approved,
    isRestricted,
    limit: isRestricted ? 20 : Number.POSITIVE_INFINITY,
    message: isRestricted
      ? 'Verification Required: You can browse normally, but withdrawals and payouts above GHC 20.00 are blocked until identity verification is approved.'
      : null
  };
}

function renderVerificationRestrictionBanner(message) {
  if (typeof document === 'undefined') return;

  if (!message) {
    const existingBanner = document.getElementById('verificationRestrictionBanner');
    if (existingBanner) existingBanner.remove();
    return;
  }

  let banner = document.getElementById('verificationRestrictionBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'verificationRestrictionBanner';
    banner.style.cssText = 'position: sticky; top: 0; z-index: 9999; background: #fff7ed; color: #9a2c00; border-bottom: 1px solid #fdba74; padding: 10px 14px; font-size: 13px; line-height: 1.4; display: flex; align-items: center; justify-content: space-between; gap: 8px;';
    const firstChild = document.body?.firstChild;
    if (document.body) {
      document.body.insertBefore(banner, firstChild || null);
    }
  }

  banner.innerHTML = `
    <div><strong>Verification Required</strong> — ${message}</div>
    <a href="mine.html" style="color: #7c2d12; font-weight: 700; text-decoration: none;">Complete verification</a>
  `;
}

// API client
window.API = {
  async call(endpoint, options = {}) {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;

    if (!token) {
      throw new Error('No authentication token. Please login first.');
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers
    };

    // /users/sync needs deviceId for the referral anti-farming check - inject it here
    // so every caller gets it automatically instead of remembering to add it themselves.
    let body = options.body;
    if (endpoint === '/users/sync') {
      let parsed = {};
      if (typeof body === 'string') {
        try { parsed = JSON.parse(body); } catch (e) { parsed = {}; }
      }
      parsed.deviceId = getOrCreateDeviceId();
      body = JSON.stringify(parsed);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const response = await fetch(`${CONFIG.API_URL}${endpoint}`, {
        ...options,
        body,
        headers,
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `API request failed: ${response.status}`);
      }

      return response.json();
    } catch (error) {
      // Handle specific error types
      if (error.name === 'AbortError') {
        throw new Error('Request timeout. Please check your internet connection.');
      }
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error('Network error. Please check your internet connection.');
      }
      if (error.message.includes('CORS')) {
        throw new Error('Server connection error. Please contact support.');
      }
      // Re-throw the original error
      throw error;
    }
  },

  async getWallet() {
    return this.call('/wallet');
  },

  getVerificationRestrictionState(profile) {
    return getVerificationRestrictionState(profile);
  },

  async showVerificationRestrictionNotice(profileOverride = null) {
    try {
      const profile = profileOverride || await this.getUserProfile().catch(() => null);
      const state = getVerificationRestrictionState(profile);
      renderVerificationRestrictionBanner(state.message);
      return state;
    } catch (error) {
      console.warn('Failed to load verification notice:', error);
      return { isRestricted: false, message: null };
    }
  },

  async getTransactions() {
    return this.call('/transactions');
  },

  async createWithdrawal(amount, method, account) {
    return this.call('/withdrawals', {
      method: 'POST',
      body: JSON.stringify({ amount, method, account })
    });
  },

  async getUserProfile() {
    return this.call('/users/me');
  },

  async updateProfile(fullName, phone) {
    return this.call('/users/me', {
      method: 'PUT',
      body: JSON.stringify({ fullName, phone })
    });
  },

  async uploadAvatar(avatarUrl) {
    return this.call('/users/me/avatar', {
      method: 'POST',
      body: JSON.stringify({ avatarUrl })
    });
  },

  async submitVerification(data) {
    return this.call('/users/me/verification', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async getMyVerification() {
    return this.call('/users/me/verification');
  },

  async getUserVerification(userId) {
    return this.call(`/admin/users/${userId}/verification`);
  },

  async requireUserVerification(userId, required) {
    return this.call(`/admin/users/${userId}/verification/require`, {
      method: 'POST',
      body: JSON.stringify({ required })
    });
  },

  async requireUserTotp(userId, required) {
    return this.call(`/admin/users/${userId}/totp/require`, {
      method: 'POST',
      body: JSON.stringify({ required })
    });
  },

  async completeTotpEnrollment() {
    return this.call('/users/me/totp/complete', { method: 'POST' });
  },

  async approveUserVerification(userId, notes) {
    return this.call(`/admin/users/${userId}/verification/approve`, {
      method: 'POST',
      body: JSON.stringify({ notes })
    });
  },

  async rejectUserVerification(userId, notes) {
    return this.call(`/admin/users/${userId}/verification/reject`, {
      method: 'POST',
      body: JSON.stringify({ notes })
    });
  },

  async createPayment(amount, method, phone) {
    return this.call('/payments', {
      method: 'POST',
      body: JSON.stringify({ amount, method, phone })
    });
  },

  async submitTransaction(paymentId, transactionId) {
    return this.call(`/payments/${paymentId}/transaction`, {
      method: 'POST',
      body: JSON.stringify({ transactionId })
    });
  },

  async getPayments() {
    return this.call('/admin/payments');
  },

  async completePayment(paymentId) {
    return this.call(`/admin/payments/${paymentId}/complete`, {
      method: 'POST'
    });
  },

  async addDeposit(userId, amount, bonus, reason) {
    return this.call('/admin/deposits', {
      method: 'POST',
      body: JSON.stringify({ userId, amount, bonus, reason })
    });
  },

  async getWithdrawals() {
    return this.call('/admin/withdrawals');
  },

  async approveWithdrawal(withdrawalId) {
    return this.call(`/admin/withdrawals/${withdrawalId}/approve`, {
      method: 'POST'
    });
  },

  async rejectWithdrawal(withdrawalId, reason) {
    return this.call(`/admin/withdrawals/${withdrawalId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  },

  async transferBonus(amount) {
    return this.call('/wallet/transfer-bonus', {
      method: 'POST',
      body: JSON.stringify({ amount })
    });
  },

  async getMyTasks() {
    return this.call('/tasks/my');
  },

  async getMyProducts() {
    return this.call('/products/my');
  },

  async getProductCatalog() {
    return this.call('/products/catalog');
  },

  async createTask(title, description, amount, commission = 0) {
    return this.call('/admin/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, description, amount, commission })
    });
  },

  async updateTask(taskId, data) {
    return this.call(`/admin/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  async setTaskStatus(taskId, status) {
    return this.call(`/admin/tasks/${taskId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status })
    });
  },

  async getTasks() {
    return this.call('/admin/tasks');
  },

  async getTaskAssignments(limit = 500) {
    return this.call(`/admin/task-assignments?limit=${encodeURIComponent(limit)}`);
  },

  async assignTask(taskId, userIds) {
    return this.call(`/admin/tasks/${taskId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ userIds })
    });
  },

  async createProduct(name, description, price, image, commission = 0) {
    return this.call('/admin/products', {
      method: 'POST',
      body: JSON.stringify({ name, description, price, image, commission })
    });
  },

  async getProducts() {
    return this.call('/admin/products');
  },

  async assignProduct(productId, userIds) {
    return this.call(`/admin/products/${productId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ userIds })
    });
  },

  async deleteTask(taskId) {
    return this.call(`/admin/tasks/${taskId}`, {
      method: 'DELETE'
    });
  },

  async deleteProduct(productId) {
    return this.call(`/admin/products/${productId}`, {
      method: 'DELETE'
    });
  },

  async completeTask(taskId) {
    return this.call(`/tasks/${taskId}/complete`, {
      method: 'POST'
    });
  },

  async completeProduct(productId) {
    return this.call(`/products/${productId}/complete`, {
      method: 'POST'
    });
  },

  // Beginner Tasks
  async createBeginnerTask(taskData) {
    return this.call('/admin/beginner-tasks', {
      method: 'POST',
      body: JSON.stringify(taskData)
    });
  },

  async getBeginnerTasks() {
    return this.call('/admin/beginner-tasks');
  },

  async deleteBeginnerTask(taskId) {
    return this.call(`/admin/beginner-tasks/${taskId}`, {
      method: 'DELETE'
    });
  },

  async startBeginnerTask(taskId) {
    return this.call(`/admin/beginner-tasks/${taskId}/start`, {
      method: 'PATCH'
    });
  },

  async stopBeginnerTask(taskId) {
    return this.call(`/admin/beginner-tasks/${taskId}/stop`, {
      method: 'PATCH'
    });
  },

  async getBeginnerTaskSubmissions(taskId) {
    return this.call(`/admin/beginner-tasks/${taskId}/submissions`);
  },

  async deleteBeginnerTaskSubmission(submissionId) {
    return this.call(`/admin/beginner-tasks/submissions/${submissionId}`, {
      method: 'DELETE'
    });
  },

  async getUserBeginnerTasks() {
    return this.call('/beginner-tasks');
  },

  async getEasyEarns() {
    return this.call('/easy-earns');
  },

  async getEasyEarnVideos(taskId) {
    return this.call(`/easy-earns/${taskId}/videos`);
  },

  // Admin video management for easy earns
  async addEasyEarnVideo(taskId, video) {
    return this.call(`/admin/easy-earns/${taskId}/videos`, { method: 'POST', body: JSON.stringify(video) });
  },

  async updateEasyEarnVideo(taskId, videoId, video) {
    return this.call(`/admin/easy-earns/${taskId}/videos/${videoId}`, { method: 'PUT', body: JSON.stringify(video) });
  },

  async deleteEasyEarnVideo(taskId, videoId) {
    return this.call(`/admin/easy-earns/${taskId}/videos/${videoId}`, { method: 'DELETE' });
  },

  // Admin Easy Earns management
  async getAdminEasyEarns() {
    return this.call('/admin/easy-earns');
  },

  async createAdminEasyEarn(data) {
    return this.call('/admin/easy-earns', { method: 'POST', body: JSON.stringify(data) });
  },

  async cleanupEasyEarnSeeds() {
    return this.call('/admin/easy-earns/cleanup', { method: 'POST' });
  },

  async getTasksCatalog() {
    return this.call('/tasks');
  },

  async claimTask(taskId) {
    return this.call(`/tasks/${taskId}/claim`, {
      method: 'POST'
    });
  },

  async submitBeginnerTask(taskId, url) {
    return this.call(`/beginner-tasks/${taskId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ url })
    });
  },

  async submitEasyEarn(taskId, url) {
    return this.call(`/easy-earns/${taskId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ url })
    });
  },

  async claimBeginnerTaskReward(taskId) {
    return this.call(`/beginner-tasks/${taskId}/claim`, {
      method: 'POST'
    });
  },

  async claimEasyEarn(taskId) {
    return this.call(`/easy-earns/${taskId}/claim`, {
      method: 'POST'
    });
  },

  async updateAdminEasyEarn(taskId, data) {
    return this.call(`/admin/easy-earns/${taskId}`, { method: 'PUT', body: JSON.stringify(data) });
  },

  async getEasyEarnStatusToday() {
    return this.call('/easy-earns/status/today');
  },

  async getScheduleCurrent() {
    return this.call('/schedule/current');
  },

  // Quiz category
  async getQuizQuestions(taskId) {
    return this.call(`/easy-earns/quiz/${taskId}/questions`);
  },

  async submitQuiz(taskId, answers) {
    return this.call(`/easy-earns/quiz/${taskId}/submit`, { method: 'POST', body: JSON.stringify({ answers }) });
  },

  async getAdminQuizQuestions(taskId) {
    return this.call(`/admin/easy-earns/quiz/${taskId}/questions`);
  },

  async addAdminQuizQuestion(taskId, data) {
    return this.call(`/admin/easy-earns/quiz/${taskId}/questions`, { method: 'POST', body: JSON.stringify(data) });
  },

  async updateAdminQuizQuestion(questionId, data) {
    return this.call(`/admin/easy-earns/quiz/questions/${questionId}`, { method: 'PUT', body: JSON.stringify(data) });
  },

  async deleteAdminQuizQuestion(questionId) {
    return this.call(`/admin/easy-earns/quiz/questions/${questionId}`, { method: 'DELETE' });
  },

  // Poll category
  async getPollOptions(taskId) {
    return this.call(`/easy-earns/poll/${taskId}/options`);
  },

  async submitPoll(taskId, optionId) {
    return this.call(`/easy-earns/poll/${taskId}/submit`, { method: 'POST', body: JSON.stringify({ option_id: optionId }) });
  },

  async getAdminPollOptions(taskId) {
    return this.call(`/admin/easy-earns/poll/${taskId}/options`);
  },

  async addAdminPollOption(taskId, data) {
    return this.call(`/admin/easy-earns/poll/${taskId}/options`, { method: 'POST', body: JSON.stringify(data) });
  },

  async updateAdminPollOption(optionId, data) {
    return this.call(`/admin/easy-earns/poll/options/${optionId}`, { method: 'PUT', body: JSON.stringify(data) });
  },

  async deleteAdminPollOption(optionId) {
    return this.call(`/admin/easy-earns/poll/options/${optionId}`, { method: 'DELETE' });
  },

  // Photo Survey category
  async getPhotoSurveyToday(taskId) {
    return this.call(`/easy-earns/photo-survey/${taskId}/today`);
  },

  async submitPhotoSurveyPhoto(taskId, data) {
    return this.call(`/easy-earns/photo-survey/${taskId}/photos`, { method: 'POST', body: JSON.stringify(data) });
  },

  async getAdminPhotoPrompts(taskId) {
    return this.call(`/admin/easy-earns/photo-survey/${taskId}/prompts`);
  },

  async addAdminPhotoPrompt(taskId, data) {
    return this.call(`/admin/easy-earns/photo-survey/${taskId}/prompts`, { method: 'POST', body: JSON.stringify(data) });
  },

  async updateAdminPhotoPrompt(promptId, data) {
    return this.call(`/admin/easy-earns/photo-survey/prompts/${promptId}`, { method: 'PUT', body: JSON.stringify(data) });
  },

  async deleteAdminPhotoPrompt(promptId) {
    return this.call(`/admin/easy-earns/photo-survey/prompts/${promptId}`, { method: 'DELETE' });
  },

  // Daily check-in
  async getDailyCheckin() {
    return this.call('/checkin');
  },

  async doDailyCheckin() {
    return this.call('/checkin', { method: 'POST' });
  },

  async getAllUsers() {
    return this.call('/admin/users');
  },

  async resetUserData(userId) {
    return this.call(`/admin/users/${userId}/reset-data`, {
      method: 'POST'
    });
  },

  // ...existing code...

  async upsertPaymentNumber(userId, paymentNumber, method) {
    return this.call('/admin/payment-numbers', {
      method: 'POST',
      body: JSON.stringify({ userId, paymentNumber, method })
    });
  },

  async deletePaymentNumber(userId) {
    return this.call(`/admin/payment-numbers/${userId}`, {
      method: 'DELETE'
    });
  },

  async deletePayment(paymentId) {
    return this.call(`/admin/payments/${paymentId}`, {
      method: 'DELETE'
    });
  },

  // Teller tasks
  async getTellerStatus() {
    return this.call('/teller/status');
  },

  async getTellerTask() {
    return this.call('/teller/task');
  },

  async startTellerTask(assignmentId) {
    return this.call(`/teller/assignments/${assignmentId}/start`, {
      method: 'POST'
    });
  },

  async completeTellerTask(assignmentId) {
    return this.call(`/teller/assignments/${assignmentId}/complete`, {
      method: 'POST'
    });
  },

  async withdrawTellerBalance() {
    return this.call('/teller/withdraw', {
      method: 'POST'
    });
  },

  // Admin teller assignments
  async assignTellerProduct(productId, userIds, level, count) {
    return this.call('/admin/teller-assignments', {
      method: 'POST',
      body: JSON.stringify({ productId, userIds, level, count })
    });
  },

  async getTellerAssignments(level) {
    return this.call(`/admin/teller-assignments?level=${level}`);
  },

  // Order processing (background)
  async startOrder(taskId, productId, cost, interest, totalReturn) {
    return this.call('/orders/start', {
      method: 'POST',
      body: JSON.stringify({ taskId, productId, cost, interest, totalReturn })
    });
  },

  async getOrderStatus(orderId) {
    return this.call(`/orders/${orderId}/status`);
  }
};

// Uploads a photo straight from the browser to Cloudinary (unsigned preset) and
// returns the public URL. Used by the Photo Survey Easy Earn category.
async function uploadToCloudinary(file) {
  if (!CONFIG.CLOUDINARY_CLOUD_NAME || !CONFIG.CLOUDINARY_UPLOAD_PRESET) {
    throw new Error('Photo upload is not set up yet. Contact support.');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CONFIG.CLOUDINARY_UPLOAD_PRESET);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${CONFIG.CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error?.message || 'Photo upload failed');
  }

  const data = await response.json();
  return data.secure_url;
}

window.uploadToCloudinary = uploadToCloudinary;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.API.showVerificationRestrictionNotice().catch(() => {});
  });
} else {
  window.API.showVerificationRestrictionNotice().catch(() => {});
}
