import { prepareChatImageFile } from '../lib/compressChatImage';
import { fetchWithTimeout } from './http';

const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_CHAT_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export interface ChatImageUploadToken {
  token: string;
  key: string;
  uploadUrl: string;
  url: string;
}

export interface ChatImageUploadResult {
  url: string;
  key: string;
  previewUrl: string;
}

export function validateChatImageFile(file: File): string | null {
  if (!ALLOWED_CHAT_IMAGE_TYPES.has(file.type)) {
    return '仅支持 JPG、PNG、GIF、WebP 图片';
  }
  if (file.size > MAX_CHAT_IMAGE_BYTES) {
    return '图片不能超过 5MB';
  }
  return null;
}

export async function fetchChatUploadEnabled(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout('/api/chat/upload-config');
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.enabled);
  } catch {
    return false;
  }
}

async function requestChatImageUploadToken(roomId: string, ext: string): Promise<ChatImageUploadToken> {
  const res = await fetchWithTimeout('/api/chat/upload-token', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, ext }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || '获取上传凭证失败');
  }
  return data as ChatImageUploadToken;
}

export async function uploadChatImage(roomId: string, file: File): Promise<ChatImageUploadResult> {
  const prepared = await prepareChatImageFile(file);
  const validationError = validateChatImageFile(prepared);
  if (validationError) {
    throw new Error(validationError);
  }

  const ext = prepared.name.split('.').pop()?.toLowerCase() || 'jpg';
  const tokenData = await requestChatImageUploadToken(roomId, ext);

  const formData = new FormData();
  formData.append('file', prepared);
  formData.append('token', tokenData.token);
  formData.append('key', tokenData.key);

  const uploadRes = await fetchWithTimeout(tokenData.uploadUrl, {
    method: 'POST',
    body: formData,
  }, 60000);

  if (!uploadRes.ok) {
    throw new Error('图片上传失败');
  }

  return {
    url: tokenData.url,
    key: tokenData.key,
    previewUrl: URL.createObjectURL(prepared),
  };
}
