// Supabase Auth Integration
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// Auth helpers
window.AuthService = {
  async register(email, password, fullName, phone) {
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
            phone
          })
        });
        
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
  }
};

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

    const response = await fetch(`${CONFIG.API_URL}${endpoint}`, {
      ...options,
      headers
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `API request failed: ${response.status}`);
    }

    return response.json();
  },

  async getWallet() {
    return this.call('/wallet');
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

  async createTask(title, description, amount, commission = 0) {
    return this.call('/admin/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, description, amount, commission })
    });
  },

  async getTasks() {
    return this.call('/admin/tasks');
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

  async submitBeginnerTask(taskId, url) {
    return this.call(`/beginner-tasks/${taskId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ url })
    });
  },

  async claimBeginnerTaskReward(taskId) {
    return this.call(`/beginner-tasks/${taskId}/claim`, {
      method: 'POST'
    });
  },

  async getAllUsers() {
    return this.call('/admin/users');
  }
};
