(() => {
  'use strict';

  const CONFIG = window.FOOTBALL_FORTUNE_SUPABASE;
  if (!CONFIG || !CONFIG.url || !CONFIG.key) {
    console.info('[Football Fortune] Cloud authentication is not configured yet.');
    return;
  }

  const base = String(CONFIG.url).replace(/\/$/, '');
  const apiKey = CONFIG.key;
  const PROFILE_KEY = 'footballFortunePlayerProfile';
  const SESSION_KEY = 'footballFortuneCloudSession';
  const bypass = new WeakSet();

  const q = s => document.querySelector(s);
  const message = (selector, value) => {
    const el = q(selector);
    if (el) el.textContent = value || '';
  };

  async function request(path, options = {}) {
    const response = await fetch(base + path, {
      ...options,
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      const err = new Error(data?.msg || data?.message || data?.error_description || data?.error || 'Authentication failed.');
      err.status = response.status;
      throw err;
    }
    return data;
  }

  function metadataToProfile(user, fallbackEmail = '') {
    const meta = user?.user_metadata || {};
    const firstName = String(meta.first_name || meta.firstName || '').trim();
    const surname = String(meta.surname || meta.last_name || meta.lastName || '').trim();
    const fullName = String(meta.full_name || [firstName, surname].filter(Boolean).join(' ') || 'Player').trim();
    return {
      id: user?.id || '',
      firstName: firstName || (fullName !== 'Player' ? fullName.split(/\s+/)[0] : 'Player'),
      surname: surname || (fullName.includes(' ') ? fullName.split(/\s+/).slice(1).join(' ') : ''),
      fullName,
      gender: meta.gender === 'female' ? 'female' : 'male',
      email: user?.email || fallbackEmail || ''
    };
  }

  function saveCloudSession(data) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        access_token: data?.access_token || '',
        refresh_token: data?.refresh_token || '',
        expires_at: data?.expires_at || null,
        user_id: data?.user?.id || ''
      }));
    } catch (_) {}
  }

  function saveProfile(profile) {
    const clean = {
      id: profile.id || '',
      firstName: profile.firstName || 'Player',
      surname: profile.surname || '',
      fullName: profile.fullName || [profile.firstName, profile.surname].filter(Boolean).join(' ') || 'Player',
      gender: profile.gender === 'female' ? 'female' : 'male',
      email: profile.email || ''
    };
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(clean)); } catch (_) {}
    window.FOOTBALL_FORTUNE_PLAYER_PROFILE = {...clean};
  }

  async function signIn(email, password) {
    return request('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  }

  async function signUp({firstName, surname, email, password, gender}) {
    return request('/auth/v1/signup', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        data: {
          first_name: firstName,
          surname,
          full_name: [firstName, surname].filter(Boolean).join(' '),
          gender
        }
      })
    });
  }

  async function recover(email) {
    return request('/auth/v1/recover', {
      method: 'POST',
      body: JSON.stringify({
        email,
        ...(CONFIG.redirectTo ? { redirect_to: CONFIG.redirectTo } : {})
      })
    });
  }

  function rerunOriginal(button) {
    bypass.add(button);
    button.click();
  }

  function attach(buttonSelector, handler) {
    const button = q(buttonSelector);
    if (!button) return;
    button.addEventListener('click', async event => {
      if (bypass.has(button)) {
        bypass.delete(button);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      await handler(button);
    }, true);
  }

  attach('#ffjLoginBtn', async button => {
    const email = q('#ffjLoginEmail')?.value.trim() || '';
    const password = q('#ffjLoginPassword')?.value || '';
    if (!email || !password) {
      message('#ffjLoginMessage', 'Enter your email address and password.');
      return;
    }
    button.disabled = true;
    message('#ffjLoginMessage', 'Signing you in…');
    try {
      const data = await signIn(email, password);
      saveCloudSession(data);
      saveProfile(metadataToProfile(data.user, email));
      message('#ffjLoginMessage', '');
      rerunOriginal(button);
    } catch (err) {
      message('#ffjLoginMessage', err.status === 400 ? 'Email or password is incorrect.' : (err.message || 'Unable to sign in.'));
    } finally {
      button.disabled = false;
    }
  });

  attach('#ffjSignupBtn', async button => {
    const firstName = q('#ffjSignupFirstName')?.value.trim() || '';
    const surname = q('#ffjSignupSurname')?.value.trim() || '';
    const email = q('#ffjSignupEmail')?.value.trim() || '';
    const password = q('#ffjSignupPassword')?.value || '';
    const gender = q('[data-ffj-gender].active')?.dataset.ffjGender || 'male';

    if (!firstName || !surname || !email || password.length < 8) {
      message('#ffjSignupMessage', 'Enter your first name, surname, email and a password of at least 8 characters.');
      return;
    }

    button.disabled = true;
    message('#ffjSignupMessage', 'Creating your account…');
    try {
      const data = await signUp({ firstName, surname, email, password, gender });
      saveCloudSession(data);
      saveProfile({
        id: data?.user?.id || '',
        firstName,
        surname,
        fullName: `${firstName} ${surname}`,
        gender,
        email
      });
      if (!data?.access_token && data?.user) {
        message('#ffjSignupMessage', 'Account created. Check your email to confirm it, then log in.');
        return;
      }
      message('#ffjSignupMessage', '');
      rerunOriginal(button);
    } catch (err) {
      const text = String(err.message || '');
      message(
        '#ffjSignupMessage',
        /already|registered|exists/i.test(text)
          ? 'An account already exists for that email. Try logging in instead.'
          : (text || 'Unable to create your account.')
      );
    } finally {
      button.disabled = false;
    }
  });

  attach('#ffjResetBtn', async button => {
    const email = q('#ffjForgotEmail')?.value.trim() || '';
    if (!email) {
      message('#ffjForgotMessage', 'Enter your email address.');
      return;
    }
    button.disabled = true;
    message('#ffjForgotMessage', 'Sending reset link…');
    try {
      await recover(email);
      message('#ffjForgotMessage', 'If that account exists, a reset link has been sent.');
    } catch (err) {
      message('#ffjForgotMessage', err.message || 'Unable to send the reset link.');
    } finally {
      button.disabled = false;
    }
  });

  document.addEventListener('click', event => {
    const logout = event.target.closest('[data-ffj-logout], #ffjLogoutBtn');
    if (!logout) return;
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
  }, true);

  window.FOOTBALL_FORTUNE_CLOUD_AUTH = Object.freeze({
    enabled: true,
    provider: 'supabase'
  });
})();