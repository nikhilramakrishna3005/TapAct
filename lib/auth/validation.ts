export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt, which Supabase Auth uses, ignores bytes past 72. */
export const PASSWORD_MAX_LENGTH = 72;
export const NAME_MAX_LENGTH = 50;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): string | null {
  const value = email.trim();
  if (value.length === 0) {
    return "Enter your email address.";
  }
  if (value.length > 254 || !EMAIL_PATTERN.test(value)) {
    return "Enter a valid email address, like you@example.com.";
  }
  return null;
}

export function validateName(name: string): string | null {
  const value = name.trim();
  if (value.length === 0) {
    return "Enter your name.";
  }
  if (value.length > NAME_MAX_LENGTH) {
    return `Keep your name under ${NAME_MAX_LENGTH} characters.`;
  }
  return null;
}

/** Sign-in only checks presence so existing accounts with older rules still work. */
export function validateSignInPassword(password: string): string | null {
  return password.length === 0 ? "Enter your password." : null;
}

export function validateNewPassword(password: string): string | null {
  if (password.length === 0) {
    return "Create a password.";
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Include at least one letter and one number.";
  }
  return null;
}

export function validatePasswordConfirmation(password: string, confirmation: string): string | null {
  if (confirmation.length === 0) {
    return "Confirm your password.";
  }
  return password === confirmation ? null : "Passwords don't match.";
}

export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: string };

export function getPasswordStrength(password: string): PasswordStrength {
  if (password.length === 0) {
    return { score: 0, label: "" };
  }
  let points = 0;
  if (password.length >= PASSWORD_MIN_LENGTH) points += 1;
  if (password.length >= 12) points += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) points += 1;
  if (/[0-9]/.test(password)) points += 1;
  if (/[^A-Za-z0-9]/.test(password)) points += 1;
  const score = Math.max(1, Math.min(4, points - (password.length < PASSWORD_MIN_LENGTH ? 1 : 0))) as 1 | 2 | 3 | 4;
  const labels = { 1: "Weak", 2: "Fair", 3: "Good", 4: "Strong" } as const;
  return { score, label: labels[score] };
}
