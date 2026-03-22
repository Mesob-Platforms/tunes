// js/accounts/auth.js
import { supabase, isAdminEmail, GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID } from './config.js';
import { isNative } from '../platform.js';

// Helper: show an inline message in the gate
function showGateMessage(elementId, text, type = 'error') {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = text;
    el.style.color = type === 'success' ? '#4ade80' : type === 'info' ? 'rgba(255,255,255,0.6)' : '#f87171';
}

function clearGateMessage(elementId) {
    const el = document.getElementById(elementId);
    if (el) { el.textContent = ''; }
}

// Helper: switch between auth gate screens
function showGateScreen(screenId) {
    document.querySelectorAll('.gate-screen').forEach(s => { s.style.display = 'none'; });
    const target = document.getElementById(screenId);
    if (target) target.style.display = 'block';
    clearGateMessage('gate-email-message');
    clearGateMessage('gate-password-message');
    clearGateMessage('gate-otp-message');
    clearGateMessage('gate-setpw-message');
}

// Helper: disable/enable a submit button with loading text
function setButtonLoading(btnId, loading, originalText) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? 'Please wait...' : originalText;
    btn.style.opacity = loading ? '0.5' : '1';
}

// Gender-neutral avatar via DiceBear API (same as profile.js)
function _generateLocalAvatar(seed) {
    const safeSeed = encodeURIComponent(String(seed));
    return `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${safeSeed}`;
}

export class AuthManager {
    constructor() {
        this.user = null;
        this.session = null;
        this.unsubscribe = null;
        this.authListeners = [];
        this._initDone = false;
        this._sessionRestored = false;
        this._pendingEmail = null;
        this._otpPurpose = null;
        this._skipGateHide = false;
        this._googleOneTapReady = false; // unused, kept for compat
    }

    _wasSignedIn() {
        return localStorage.getItem('tunes_was_signed_in') === 'true';
    }

    _cacheAuthState(signedIn) {
        if (signedIn) {
            localStorage.setItem('tunes_was_signed_in', 'true');
        } else {
            localStorage.removeItem('tunes_was_signed_in');
        }
    }

    _extractUser(rawUser) {
        if (!rawUser) return null;
        return {
            uid: rawUser.id,
            email: rawUser.email,
            displayName: rawUser.user_metadata?.full_name || rawUser.user_metadata?.name || rawUser.email,
            photoURL: rawUser.user_metadata?.avatar_url || null,
            isAdmin: isAdminEmail(rawUser.email),
        };
    }

    init() {
        if (!supabase || this._initDone) return;
        this._initDone = true;
        this._initialSessionChecked = false;

        supabase.auth.getSession().then(({ data: { session } }) => {
            this.session = session;
            this.user = this._extractUser(session?.user);
            this._initialSessionChecked = true;
            this._sessionRestored = true;

            if (!this.user && this._wasSignedIn()) {
                const authGate = document.getElementById('auth-gate');
                if (authGate) authGate.style.display = 'none';
                this.authListeners.forEach(listener => listener(null));
                return;
            }

            if (this.user) {
                this._cacheAuthState(true);
            }
            this.updateUI(this.user);
            this.authListeners.forEach(listener => listener(this.user));
        }).catch(() => {
            this._initialSessionChecked = true;
            this._sessionRestored = true;
            if (this._wasSignedIn()) {
                const authGate = document.getElementById('auth-gate');
                if (authGate) authGate.style.display = 'none';
            } else {
                this.updateUI(null);
            }
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (!this._initialSessionChecked) return;

            this.session = session;
            this.user = this._extractUser(session?.user);

            if (!this.user && this._wasSignedIn()) {
                return;
            }

            if (this.user) {
                this._cacheAuthState(true);
            }

            if (this._skipGateHide && this.user) {
                this.authListeners.forEach(listener => listener(this.user));
                return;
            }

            this.updateUI(this.user);
            this.authListeners.forEach(listener => listener(this.user));
        });

        this.unsubscribe = subscription;
    }

    onAuthStateChanged(callback) {
        this.authListeners.push(callback);
        if (this.user) {
            callback(this.user);
        }
    }

    // ===== AUTH METHODS =====

    async signInWithGoogle() {
        if (!supabase) {
            showGateMessage('gate-email-message', 'Supabase is not configured.');
            return;
        }
        const googleBtn = document.getElementById('gate-google-btn') || document.getElementById('google-sign-in-btn');
        if (googleBtn) { googleBtn.disabled = true; googleBtn.style.opacity = '0.5'; googleBtn.textContent = 'Connecting to Google...'; }
        try {
            if (isNative && window.NativeBridge) {
                const { data, error: oauthErr } = await supabase.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo: 'com.mesob.tunes://auth-callback',
                        skipBrowserRedirect: true,
                    },
                });
                if (oauthErr) throw oauthErr;
                if (!data?.url) {
                    showGateMessage('gate-email-message', 'Could not start Google sign-in.');
                    return;
                }

                const urlOpenHandler = (urlData) => {
                    const url = urlData?.url;
                    if (!url) return;
                    if (!url.includes('access_token') && !url.includes('code=') && !url.includes('auth-callback')) return;
                    if (window.NativeBridge.off) window.NativeBridge.off('appUrlOpen', urlOpenHandler);

                    const hashParams = new URLSearchParams(url.split('#')[1] || '');
                    const queryParams = new URLSearchParams(url.split('?')[1]?.split('#')[0] || '');
                    const accessToken = hashParams.get('access_token');
                    const refreshToken = hashParams.get('refresh_token');
                    const code = queryParams.get('code');

                    if (accessToken && refreshToken) {
                        supabase.auth.setSession({
                            access_token: accessToken,
                            refresh_token: refreshToken,
                        }).then(({ error: sessErr }) => {
                            if (sessErr) {
                                console.error('[auth] setSession failed:', sessErr);
                                showGateMessage('gate-email-message', `Sign-in failed: ${sessErr.message}`);
                            }
                        });
                    } else if (code) {
                        supabase.auth.exchangeCodeForSession(code).then(({ error: exchErr }) => {
                            if (exchErr) {
                                console.error('[auth] exchangeCode failed:', exchErr);
                                showGateMessage('gate-email-message', `Sign-in failed: ${exchErr.message}`);
                            }
                        });
                    } else {
                        console.error('[auth] No tokens or code in callback URL:', url);
                        showGateMessage('gate-email-message', 'Sign-in did not complete. Please try again.');
                    }
                };
                window.NativeBridge.on('appUrlOpen', urlOpenHandler);

                try {
                    await window.NativeBridge.call('openBrowser', { url: data.url });
                } catch (browserErr) {
                    console.error('[auth] openBrowser failed, trying fallback:', browserErr);
                    window.open(data.url, '_system');
                }
                return;
            }

            // Web: standard OAuth redirect
            const { data, error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: window.location.origin },
            });
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Google login failed:', error);
            showGateMessage('gate-email-message', `Google login failed: ${error.message || JSON.stringify(error)}`);
            throw error;
        } finally {
            if (googleBtn) { googleBtn.disabled = false; googleBtn.style.opacity = '1'; googleBtn.textContent = 'Continue with Google'; }
        }
    }

    async signInWithPassword(email, password) {
        if (!supabase) return;
        try {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Sign in failed:', error);
            const msg = error?.message || JSON.stringify(error);
            showGateMessage('gate-password-message', `Sign in failed: ${msg}`);
            throw error;
        }
    }

    async signUpWithPassword(email, password) {
        if (!supabase) return;
        try {
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: { emailRedirectTo: window.location.origin },
            });
            if (error) throw error;
            if (data?.user?.identities?.length === 0) {
                showGateMessage('gate-setpw-message', 'An account with this email already exists. Try signing in instead.');
                throw new Error('Account already exists');
            }
            return data;
        } catch (error) {
            console.error('Sign up failed:', error);
            const msg = error?.message || JSON.stringify(error);
            showGateMessage('gate-setpw-message', `Sign up failed: ${msg}`);
            throw error;
        }
    }

    async sendOtp(email) {
        if (!supabase) return;
        try {
            const { data, error } = await supabase.auth.signInWithOtp({
                email,
                options: { shouldCreateUser: true },
            });
            if (error) throw error;
            this._pendingEmail = email;
            return data;
        } catch (error) {
            console.error('OTP send failed:', error);
            const msg = error?.message || JSON.stringify(error);
            throw new Error(msg);
        }
    }

    async verifyOtp(token) {
        if (!supabase || !this._pendingEmail) return;
        try {
            const { data, error } = await supabase.auth.verifyOtp({
                email: this._pendingEmail,
                token,
                type: 'email',
            });
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('OTP verification failed:', error);
            const msg = error?.message || JSON.stringify(error);
            showGateMessage('gate-otp-message', `Verification failed: ${msg}`);
            throw error;
        }
    }

    async setPassword(password) {
        if (!supabase) return;
        try {
            const { data, error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Set password failed:', error);
            const msg = error?.message || JSON.stringify(error);
            showGateMessage('gate-setpw-message', `Failed: ${msg}`);
            throw error;
        }
    }

    async signOut() {
        if (!supabase) return;
        try {
            const player = window.__tunesRefs?.player;
            if (player) {
                player.audio.pause();
                player.audio.currentTime = 0;
                player.audio.src = '';
                player.currentTrack = null;
                player.queue = [];
                player.shuffledQueue = [];
                player.currentQueueIndex = -1;
                if (player.dashInitialized) {
                    player.dashPlayer.reset();
                    player.dashInitialized = false;
                }
                player.updateMediaSessionPlaybackState?.();
                player.saveQueueState?.();
            }

            const nowPlaying = document.querySelector('.now-playing-bar');
            if (nowPlaying) nowPlaying.classList.remove('active');

            this._cacheAuthState(false);
            await supabase.auth.signOut();
        } catch (error) {
            console.error('Logout failed:', error);
            throw error;
        }
    }

    // ===== UI =====

    updateUI(user) {
        const authGate = document.getElementById('auth-gate');
        if (authGate) {
            if (user) {
                authGate.style.display = 'none';
            } else if (this._sessionRestored) {
                if (this._wasSignedIn()) {
                    authGate.style.display = 'none';
                } else {
                    authGate.style.display = 'flex';
                    showGateScreen('gate-screen-email');
                }
            }
            // If session not yet restored, gate stays hidden (display:none from HTML)
        }

        const accountSpan = document.querySelector('#sidebar-nav-account a span');
        if (accountSpan) {
            accountSpan.textContent = user ? (user.displayName || user.email) : 'Account';
        }

        const accountStatus = document.getElementById('account-status');
        const accountEmail = document.getElementById('account-email');
        const accountAvatar = document.getElementById('account-avatar');
        const signInSection = document.getElementById('account-sign-in-section');
        const signedInSection = document.getElementById('account-signed-in-section');
        const adminSidebarItem = document.getElementById('sidebar-nav-admin');

        if (user) {
            if (accountStatus) accountStatus.textContent = user.displayName || user.email;
            if (accountEmail) accountEmail.textContent = user.email;
            if (accountAvatar) {
                accountAvatar.src = _generateLocalAvatar(user.uid);
                accountAvatar.style.display = 'block';
            }
            if (signInSection) signInSection.style.display = 'none';
            if (signedInSection) signedInSection.style.display = 'block';
            if (adminSidebarItem) adminSidebarItem.style.display = user.isAdmin ? '' : 'none';
        } else {
            if (accountStatus) accountStatus.textContent = 'Not signed in';
            if (accountEmail) accountEmail.textContent = '';
            if (accountAvatar) accountAvatar.style.display = 'none';
            if (signInSection) signInSection.style.display = 'block';
            if (signedInSection) signedInSection.style.display = 'none';
            if (adminSidebarItem) adminSidebarItem.style.display = 'none';
        }

        const connectBtn = document.getElementById('firebase-connect-btn');
        const clearDataBtn = document.getElementById('firebase-clear-cloud-btn');
        const statusText = document.getElementById('firebase-status');

        if (connectBtn) {
            if (user) {
                connectBtn.textContent = 'Sign Out';
                connectBtn.classList.add('danger');
                connectBtn.onclick = () => this.signOut();
                if (clearDataBtn) clearDataBtn.style.display = 'block';
                if (statusText) statusText.textContent = `Signed in as ${user.email}`;
            } else {
                connectBtn.textContent = 'Connect with Google';
                connectBtn.classList.remove('danger');
                connectBtn.onclick = () => this.signInWithGoogle();
                if (clearDataBtn) clearDataBtn.style.display = 'none';
                if (statusText) statusText.textContent = 'Sync your library across devices';
            }
        }
    }

    initAuthGate() {
        // ===== SCREEN 1: Email entry =====
        const gateGoogleBtn = document.getElementById('gate-google-btn');
        if (gateGoogleBtn) {
            gateGoogleBtn.addEventListener('click', () => {
                clearGateMessage('gate-email-message');
                this.signInWithGoogle();
            });
        }

        const gateEmailForm = document.getElementById('gate-email-form');
        if (gateEmailForm) {
            gateEmailForm.addEventListener('submit', (e) => {
                e.preventDefault();
                clearGateMessage('gate-email-message');
                const email = document.getElementById('gate-email-input')?.value?.trim();
                if (!email) {
                    showGateMessage('gate-email-message', 'Please enter your email address.');
                    return;
                }

                this._pendingEmail = email;

                // Always go to password screen — user decides if they sign in or create account
                const subtitle = document.getElementById('gate-password-subtitle');
                if (subtitle) subtitle.textContent = email;
                showGateScreen('gate-screen-password');
                document.getElementById('gate-password-input')?.focus();
            });
        }

        // ===== SCREEN 2: Password (returning user) =====
        const gatePasswordForm = document.getElementById('gate-password-form');
        if (gatePasswordForm) {
            gatePasswordForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                clearGateMessage('gate-password-message');
                const password = document.getElementById('gate-password-input')?.value;
                if (!password) {
                    showGateMessage('gate-password-message', 'Please enter your password.');
                    return;
                }

                setButtonLoading('gate-password-submit', true, 'Sign In');
                try {
                    await this.signInWithPassword(this._pendingEmail, password);
                    // Success → onAuthStateChange hides the gate
                } catch {
                    // Error already shown
                } finally {
                    setButtonLoading('gate-password-submit', false, 'Sign In');
                }
            });
        }

        // Back from password
        const backFromPassword = document.getElementById('gate-back-from-password');
        if (backFromPassword) {
            backFromPassword.addEventListener('click', () => {
                document.getElementById('gate-password-input').value = '';
                showGateScreen('gate-screen-email');
            });
        }

        // Forgot password — use Supabase resetPasswordForEmail
        const forgotPassword = document.getElementById('gate-forgot-password');
        if (forgotPassword) {
            forgotPassword.addEventListener('click', async () => {
                if (!this._pendingEmail) {
                    showGateScreen('gate-screen-email');
                    return;
                }
                clearGateMessage('gate-password-message');
                showGateMessage('gate-password-message', 'Sending reset link...', 'info');
                try {
                    const { error } = await supabase.auth.resetPasswordForEmail(this._pendingEmail, {
                        redirectTo: window.location.origin,
                    });
                    if (error) throw error;
                    showGateMessage('gate-password-message', 'Reset link sent! Check your email.', 'success');
                } catch (err) {
                    showGateMessage('gate-password-message', `Failed to send reset link: ${err.message}`);
                }
            });
        }

        // Create account (new user) — go straight to set-password screen
        const createAccount = document.getElementById('gate-create-account');
        if (createAccount) {
            createAccount.addEventListener('click', () => {
                if (!this._pendingEmail) {
                    showGateScreen('gate-screen-email');
                    return;
                }
                clearGateMessage('gate-password-message');
                this._otpPurpose = 'signup';
                const title = document.getElementById('gate-setpw-title');
                const subtitle = document.getElementById('gate-setpw-subtitle');
                if (title) title.textContent = 'Create your password';
                if (subtitle) subtitle.textContent = `Sign up as ${this._pendingEmail}`;
                showGateScreen('gate-screen-setpassword');
                document.getElementById('gate-newpw-input')?.focus();
            });
        }

        // ===== SCREEN 3: OTP verification =====
        const gateOtpForm = document.getElementById('gate-otp-form');
        if (gateOtpForm) {
            gateOtpForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                clearGateMessage('gate-otp-message');
                const code = document.getElementById('gate-otp-input')?.value?.trim();
                if (!code || code.length < 6 || code.length > 7) {
                    showGateMessage('gate-otp-message', 'Please enter the verification code.');
                    return;
                }

                setButtonLoading('gate-otp-submit', true, 'Verify');
                try {
                    // Prevent gate from hiding after OTP verify — we still need to set password
                    this._skipGateHide = true;
                    await this.verifyOtp(code);

                    // OTP verified → go to set password screen
                    const title = document.getElementById('gate-setpw-title');
                    const subtitle = document.getElementById('gate-setpw-subtitle');
                    if (this._otpPurpose === 'reset') {
                        if (title) title.textContent = 'Reset your password';
                        if (subtitle) subtitle.textContent = 'Choose a new password for your account';
                    } else {
                        if (title) title.textContent = 'Create your password';
                        if (subtitle) subtitle.textContent = "You'll use this to sign in next time";
                    }
                    showGateScreen('gate-screen-setpassword');
                    document.getElementById('gate-newpw-input')?.focus();
                } catch {
                    this._skipGateHide = false;
                    // Error already shown
                } finally {
                    setButtonLoading('gate-otp-submit', false, 'Verify');
                }
            });
        }

        // Back from OTP
        const backFromOtp = document.getElementById('gate-back-from-otp');
        if (backFromOtp) {
            backFromOtp.addEventListener('click', () => {
                document.getElementById('gate-otp-input').value = '';
                showGateScreen('gate-screen-email');
            });
        }

        // Resend OTP
        const resendBtn = document.getElementById('gate-resend-otp');
        if (resendBtn) {
            resendBtn.addEventListener('click', async () => {
                if (!this._pendingEmail) return;
                clearGateMessage('gate-otp-message');
                resendBtn.disabled = true;
                resendBtn.textContent = 'Sending...';
                try {
                    await this.sendOtp(this._pendingEmail);
                    showGateMessage('gate-otp-message', 'New code sent! Check your email.', 'success');
                } catch {
                    showGateMessage('gate-otp-message', 'Failed to resend. Try again.');
                } finally {
                    resendBtn.disabled = false;
                    resendBtn.textContent = 'Resend code';
                }
            });
        }

        // ===== SCREEN 4: Set password =====
        const setPasswordForm = document.getElementById('gate-setpassword-form');
        if (setPasswordForm) {
            setPasswordForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                clearGateMessage('gate-setpw-message');
                const pw = document.getElementById('gate-newpw-input')?.value;
                const confirm = document.getElementById('gate-confirmpw-input')?.value;

                if (!pw || !confirm) {
                    showGateMessage('gate-setpw-message', 'Please fill in both fields.');
                    return;
                }
                if (pw.length < 6) {
                    showGateMessage('gate-setpw-message', 'Password must be at least 6 characters.');
                    return;
                }
                if (pw !== confirm) {
                    showGateMessage('gate-setpw-message', 'Passwords do not match.');
                    return;
                }

                setButtonLoading('gate-setpw-submit', true, 'Set Password');
                try {
                    if (this._otpPurpose === 'signup' && this._pendingEmail && !this.user) {
                        await this.signUpWithPassword(this._pendingEmail, pw);
                    } else {
                        await this.setPassword(pw);
                    }
                    this._skipGateHide = false;
                    this._otpPurpose = null;
                    this._pendingEmail = null;
                    this.updateUI(this.user);
                } catch {
                    // Error already shown
                } finally {
                    setButtonLoading('gate-setpw-submit', false, 'Set Password');
                }
            });
        }
    }

    // Helper: send OTP and navigate to OTP screen
    async _sendOtpAndShowScreen(email) {
        await this.sendOtp(email);
        const subtitle = document.getElementById('gate-otp-subtitle');
        if (subtitle) subtitle.textContent = `We sent a 6-digit code to ${email}`;
        showGateScreen('gate-screen-otp');
        document.getElementById('gate-otp-input')?.focus();
    }
}

export const authManager = new AuthManager();
