import type { AuthState } from './useAuth.js';

const messages = {
  cancelled: 'Sign-in cancelled. You can try again, or just play as a guest.',
  failed: 'Sign-in did not work. Try again, or just play as a guest.'
} as const;

// Official four-colour Google "G"; the button follows Google's sign-in branding rules.
export function GoogleG(): JSX.Element {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

// Guests only. There is deliberately no "Play as guest" button: the guest path is the controls below, one tap away.
export function SignInCard({ auth }: { auth: AuthState }): JSX.Element | null {
  if (auth.status !== 'guest') return null;
  return (
    <div className="signin-row">
      <div className="signin-card">
        {auth.loginMessage ? <p className="signin-alert" role="alert">{messages[auth.loginMessage]}</p> : null}
        <button
          type="button"
          className="google-signin"
          onClick={() => {
            auth.dismissLoginMessage();
            auth.signIn();
          }}
        >
          <GoogleG />
          <span>Continue with Google</span>
        </button>
        <p className="signin-hint">Optional. Keeps your name and settings on every device.</p>
      </div>
    </div>
  );
}
