// ============================================================
// 用户相关 API 输入校验
// ============================================================

import { hasOwnKey, isPlainObject } from './objects.ts';
import { normalizeOptionalString } from './strings.ts';

type ParseSuccess<T> = { success: true; data: T };
type ParseFailure = { success: false; errorMessage: string };
type ParseResult<T> = ParseSuccess<T> | ParseFailure;

// 用户名规则：3-32 字符，字母数字下划线连字符
const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,32}$/;
// 密码规则：至少 8 字符
const MIN_PASSWORD_LENGTH = 8;

export type CreateUserPayload = {
  username: string;
  displayName: string;
  password: string;
  email: string | null;
  role: string;
};

export function parseCreateUserPayload(input: unknown): ParseResult<CreateUserPayload> {
  if (!isPlainObject(input)) {
    return { success: false, errorMessage: '请求体必须是 JSON object' };
  }

  const username = normalizeOptionalString(input.username);
  if (!username) {
    return { success: false, errorMessage: '用户名不能为空' };
  }
  if (!USERNAME_REGEX.test(username)) {
    return { success: false, errorMessage: '用户名须为 3-32 字符，仅支持字母、数字、下划线和连字符' };
  }

  const displayName = normalizeOptionalString(input.displayName);
  if (!displayName) {
    return { success: false, errorMessage: '显示名称不能为空' };
  }

  const password = typeof input.password === 'string' ? input.password : '';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { success: false, errorMessage: `密码长度不能少于 ${MIN_PASSWORD_LENGTH} 字符` };
  }

  const email = normalizeOptionalString(input.email);
  const role = normalizeOptionalString(input.role) || 'developer';
  if (role !== 'admin' && role !== 'developer' && role !== 'viewer') {
    return { success: false, errorMessage: '角色必须是 admin、developer 或 viewer' };
  }

  return {
    success: true,
    data: { username, displayName, password, email, role },
  };
}

export type UpdateUserPayload = {
  displayName?: string;
  email?: string | null;
  role?: string;
  status?: string;
};

export function parseUpdateUserPayload(input: unknown): ParseResult<UpdateUserPayload> {
  if (!isPlainObject(input)) {
    return { success: false, errorMessage: '请求体必须是 JSON object' };
  }

  const data: UpdateUserPayload = {};
  let touched = 0;

  const displayName = normalizeOptionalString(input.displayName);
  if (displayName) {
    data.displayName = displayName;
    touched += 1;
  }

  if (hasOwnKey(input, 'email')) {
    data.email = normalizeOptionalString(input.email);
    touched += 1;
  }

  const role = normalizeOptionalString(input.role);
  if (role) {
    if (role !== 'admin' && role !== 'developer' && role !== 'viewer') {
      return { success: false, errorMessage: '角色必须是 admin、developer 或 viewer' };
    }
    data.role = role;
    touched += 1;
  }

  const status = normalizeOptionalString(input.status);
  if (status) {
    if (status !== 'active' && status !== 'disabled') {
      return { success: false, errorMessage: '状态必须是 active 或 disabled' };
    }
    data.status = status;
    touched += 1;
  }

  if (touched === 0) {
    return { success: false, errorMessage: '请求体缺少可更新字段' };
  }

  return { success: true, data };
}

export type SetupPayload = {
  username: string;
  displayName: string;
  password: string;
};

export function parseSetupPayload(input: unknown): ParseResult<SetupPayload> {
  if (!isPlainObject(input)) {
    return { success: false, errorMessage: '请求体必须是 JSON object' };
  }

  const username = normalizeOptionalString(input.username);
  if (!username) {
    return { success: false, errorMessage: '用户名不能为空' };
  }
  if (!USERNAME_REGEX.test(username)) {
    return { success: false, errorMessage: '用户名须为 3-32 字符，仅支持字母、数字、下划线和连字符' };
  }

  const displayName = normalizeOptionalString(input.displayName);
  if (!displayName) {
    return { success: false, errorMessage: '显示名称不能为空' };
  }

  const password = typeof input.password === 'string' ? input.password : '';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { success: false, errorMessage: `密码长度不能少于 ${MIN_PASSWORD_LENGTH} 字符` };
  }

  return { success: true, data: { username, displayName, password } };
}

export type PasswordLoginPayload = {
  username: string;
  password: string;
};

export function parsePasswordLoginPayload(input: unknown): ParseResult<PasswordLoginPayload> {
  if (!isPlainObject(input)) {
    return { success: false, errorMessage: '请求体必须是 JSON object' };
  }

  const username = normalizeOptionalString(input.username);
  if (!username) {
    return { success: false, errorMessage: '用户名不能为空' };
  }
  if (!USERNAME_REGEX.test(username)) {
    return { success: false, errorMessage: '用户名格式不正确' };
  }

  const password = typeof input.password === 'string' ? input.password : '';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { success: false, errorMessage: `密码长度不能少于 ${MIN_PASSWORD_LENGTH} 字符` };
  }

  return { success: true, data: { username, password } };
}

export type ChangePasswordPayload = {
  currentPassword: string;
  newPassword: string;
};

export function parseChangePasswordPayload(input: unknown): ParseResult<ChangePasswordPayload> {
  if (!isPlainObject(input)) {
    return { success: false, errorMessage: '请求体必须是 JSON object' };
  }

  const currentPassword = typeof input.currentPassword === 'string' ? input.currentPassword : '';
  if (!currentPassword) {
    return { success: false, errorMessage: '当前密码不能为空' };
  }

  const newPassword = typeof input.newPassword === 'string' ? input.newPassword : '';
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { success: false, errorMessage: `新密码长度不能少于 ${MIN_PASSWORD_LENGTH} 字符` };
  }

  return { success: true, data: { currentPassword, newPassword } };
}
