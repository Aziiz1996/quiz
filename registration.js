(() => {
  const byId = id => document.getElementById(id);
  let challenge = '';
  let resendAt = 0;
  let timer;
  const messages = {
    RATE_LIMITED: 'طلبات كثيرة. انتظر ثم حاول مجددًا.', TOO_MANY_ATTEMPTS: 'انتهت محاولات الرمز. اطلب رمزًا جديدًا بعد الانتظار.',
    CHALLENGE_EXPIRED: 'انتهت صلاحية المحاولة أو تم استخدامها. اطلب رمزًا جديدًا.', INVALID_CODE: 'الرمز غير صحيح أو انتهت صلاحيته.',
    INVALID_PHONE_OR_CONSENT: 'تحقق من صيغة الرقم والموافقة على الرسالة.',
    VERIFICATION_UNAVAILABLE: 'التحقق بالرسائل غير مهيأ حاليًا. حاول لاحقًا.',
    VERIFY_PROVIDER_ERROR: 'تعذر إكمال التحقق مع مزود الرسائل. انتظر ثم حاول مجددًا.',
    AUTH_REQUIRED: 'انتهت الجلسة. ادخل برقم هاتفك مجددًا.', ORIGIN_DENIED: 'افتح التسجيل من رابط الخادم المعتمد.'
  };
  function status(text) { byId('status').textContent = text; }
  async function api(path, body) {
    try {
      const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      const value = await response.json();
      if (!response.ok) throw Object.assign(new Error(value.error), { status: response.status, seconds: Number(response.headers.get('Retry-After')) });
      return value;
    } catch (error) {
      if (error.status) throw error;
      throw new Error('NETWORK_ERROR');
    }
  }
  function report(error) {
    status((messages[error.message] || 'تعذر الاتصال بالخدمة. تحقق من الاتصال ورابط التسجيل.') +
      (error.seconds > 0 ? ` انتظر ${error.seconds} ثانية.` : ''));
    if (error.status === 401) {
      byId('account').hidden = true;
      byId('phone-form').hidden = false;
    }
  }
  function cooldown() {
    clearTimeout(timer);
    const remaining = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
    byId('send').disabled = remaining > 0;
    byId('send').textContent = remaining ? `أعد الإرسال بعد ${remaining} ثانية` : 'إرسال رمز التحقق';
    if (remaining) timer = setTimeout(cooldown, 1000);
  }
  async function showAccount(user) {
    challenge = '';
    byId('code').value = '';
    byId('phone-form').hidden = true;
    byId('code-form').hidden = true;
    byId('account').hidden = false;
    status('تم التحقق من الهاتف وتسجيل الدخول.');
    const labels = { pending: 'رقم الهاتف موثّق. طلب الطالب بانتظار اعتماد الإدارة.', rejected: 'رقم الهاتف موثّق. لم تعتمد الإدارة وصول الطالب.', approved: 'رقم الهاتف موثّق. تم اعتماد الطالب.' };
    byId('account-status').textContent = labels[user.approval] || 'تحقق من حالة الحساب مع الإدارة.';
    if (user.role === 'student' && user.approval === 'approved') {
      const access = await api('/api/student/access');
      byId('account-status').textContent = access.message;
    }
  }
  byId('phone-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (Date.now() < resendAt) return;
    byId('send').disabled = true;
    try {
      const result = await api('/api/verify/start', { name: byId('name').value.trim(), phone: byId('phone').value.trim(), consent: byId('consent').checked });
      challenge = result.challenge;
      resendAt = Date.now() + result.retryAfter * 1000;
      byId('phone-form').hidden = true;
      byId('code-form').hidden = false;
      byId('code').value = '';
      byId('code').focus();
      status('قُبل طلب إرسال الرمز. أدخل الرمز عند وصوله؛ قد يتأخر وصول الرسالة.');
    } catch (error) {
      if (error.seconds > 0) resendAt = Date.now() + error.seconds * 1000;
      report(error);
    } finally { cooldown(); }
  });
  byId('code-form').addEventListener('submit', async event => {
    event.preventDefault();
    byId('verify').disabled = true;
    byId('change').disabled = true;
    try { await showAccount((await api('/api/verify/check', { challenge, code: byId('code').value.trim() })).user); }
    catch (error) { report(error); }
    finally { byId('verify').disabled = false; byId('change').disabled = false; }
  });
  byId('change').addEventListener('click', () => {
    challenge = '';
    byId('code-form').hidden = true;
    byId('phone-form').hidden = false;
    byId('phone').focus();
    cooldown();
  });
  byId('refresh').addEventListener('click', async () => {
    byId('refresh').disabled = true;
    try { await showAccount((await api('/api/me')).user); } catch (error) { report(error); }
    finally { byId('refresh').disabled = false; }
  });
  byId('logout').addEventListener('click', async () => {
    try {
      await api('/api/logout', {});
      byId('account').hidden = true;
      byId('phone-form').hidden = false;
      status('تم تسجيل الخروج.');
    } catch (error) { report(error); }
  });
  async function init() {
    if (window.AZZ_AUTH_ORIGIN) {
      const destination = new URL(window.AZZ_AUTH_ORIGIN);
      if (destination.protocol !== 'https:' || destination.origin !== window.AZZ_AUTH_ORIGIN) throw new Error('INVALID_BACKEND');
      if (destination.origin !== location.origin) {
        const entry = window.AZZ_AUTH_PATH || '/register.html';
        if (!['/', '/register.html'].includes(entry)) throw new Error('INVALID_BACKEND');
        byId('backend-link').href = destination.origin + entry;
        byId('backend-link').hidden = false;
        status('يتم التسجيل في صفحة آمنة منفصلة لحماية جلسة حسابك.');
        return;
      }
    }
    const config = await api('/api/config');
    if (!config.verificationEnabled) { status(messages.VERIFICATION_UNAVAILABLE); return; }
    try { await showAccount((await api('/api/me')).user); }
    catch (error) {
      if (error.status !== 401) throw error;
      byId('phone-form').hidden = false;
      status('أدخل رقم الهاتف لطلب رمز التحقق.');
    }
  }
  init().catch(report);
})();
