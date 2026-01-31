// Supabase client initialization
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// API client for backend calls
const API = {
  async call(endpoint, options = {}) {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;

    const headers = {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...options.headers
    };

    const response = await fetch(`${CONFIG.API_URL}${endpoint}`, {
      ...options,
      headers
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || 'API request failed');
    }

    return response.json();
  },

  // User endpoints
  async syncUser(data) {
    return this.call('/users/sync', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async getWallet() {
    return this.call('/wallet');
  },

  async getTransactions() {
    return this.call('/transactions');
  },

  // Payment endpoints
  async createPayment(data) {
    return this.call('/payments', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async submitTransaction(paymentId, transactionId) {
    return this.call(`/payments/${paymentId}/transaction`, {
      method: 'POST',
      body: JSON.stringify({ transactionId })
    });
  },

  // Admin endpoints
  async getPayments() {
    return this.call('/admin/payments');
  },

  async completePayment(paymentId) {
    return this.call(`/admin/payments/${paymentId}/complete`, {
      method: 'POST'
    });
  },

  async addDeposit(data) {
    return this.call('/admin/deposits', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
};
