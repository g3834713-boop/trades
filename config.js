// API and Supabase configuration
const CONFIG = {
  API_URL: 'https://dailytrade-backend.onrender.com',
  SUPABASE_URL: 'https://rogddhzsdfgvajyepnqp.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvZ2RkaHpzZGZndmFqeWVwbnFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4ODA4NDUsImV4cCI6MjA4NTQ1Njg0NX0.yYmAPR1rXbLEf615rLwhffo2vEIoraoiF1fR8Mh7oJk',
  // Fill these in once a Cloudinary account exists (Dashboard -> Cloud name, and an
  // unsigned upload preset under Settings -> Upload). Photo Survey uploads directly to
  // Cloudinary from the browser, so only the (public, non-secret) cloud name and preset
  // name are needed here - never put the Cloudinary API secret in frontend code.
  CLOUDINARY_CLOUD_NAME: '',
  CLOUDINARY_UPLOAD_PRESET: ''
};

const DEFAULT_SETTINGS = {
  commissionRate: 20,
  minWithdrawal: 50,
  platformName: 'DailyTrade',
  support: {
    financeDepartmentName: 'Finance Department Customer Service',
    financeTelegram: '@DailyTrader',
    financeManagerTelegram: '@DailyTradee',
    cfoTelegram: '@DailyTrader',
    generalSupportTelegram: '@DailyTrader',
    supportEmail: 'support@dailytrade.com',
    supportPhone: ''
  }
  ,
  dailyCheckinAmount: 5
};

const SETTINGS_STORAGE_KEY = 'dailytrade_settings';

function getAppSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        support: {
          ...DEFAULT_SETTINGS.support,
          ...(parsed.support || {})
        }
      };
    }
  } catch (error) {
    console.warn('Unable to load saved settings:', error);
  }
  return { ...DEFAULT_SETTINGS, support: { ...DEFAULT_SETTINGS.support } };
}

function saveAppSettings(settings) {
  try {
    const current = getAppSettings();
    const merged = {
      ...current,
      ...settings,
      support: {
        ...current.support,
        ...(settings.support || {})
      }
    };
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch (error) {
    console.error('Unable to save settings:', error);
    return getAppSettings();
  }
}

window.getAppSettings = getAppSettings;
window.saveAppSettings = saveAppSettings;
window.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
window.CONFIG = CONFIG;
