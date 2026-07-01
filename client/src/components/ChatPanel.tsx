import { useMemo, useState, useRef, useEffect, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ImagePlus, MessageCircle, MicOff, Reply, Search, Send, Smile, X } from 'lucide-react';
import { useRoomStore } from '../stores/roomStore';
import { useChatStore } from '../stores/chatStore';
import { getClientId } from '../lib/clientId';
import { useSocket } from '../hooks/useSocket';
import { useMediaQuery } from '../hooks/useMediaQuery';
import type { ChatMessage, ChatReplyRef, RoomUser } from '../types';
import { isChatMutedForUser } from '../lib/chatMute';
import QFaceImage from './QFaceImage';
import Tooltip from './Tooltip';
import MemberTierBadge from './MemberTierBadge';
import RoleBadge from './RoleBadge';
import { fireWelcomeConfetti } from '../lib/confettiBurst';
import { usePureModeStore } from '../stores/pureModeStore';
import { ChatMessageReactions, ChatReactionPicker } from './ChatMessageReactions';
import ChatImageLightbox from './ChatImageLightbox';
import StickerSearchPanel, { STICKER_SEARCH_PICKER_HEIGHT } from './StickerSearchPanel';
import {
  ensureQQFacesLoaded,
  getInitialQQFaces,
  hasFullQQFaces,
  parseQQFaceTokens,
  QFaceLoadPriority,
  qqFaceToken,
  requestQFaceImage,
  subscribeQQFaces,
  type QFaceItem,
} from '../lib/qface';
import { fetchChatUploadEnabled, uploadChatImage } from '../api/chatImage';
import { fetchStickerSearchEnabled } from '../api/stickerSearch';
import { readClipboardImageFile } from '../lib/compressChatImage';

const MAX_CHAT_LENGTH = 500;

function formatChatTime(timestamp: number): string {
  if (!timestamp) return '';
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const time = new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);

    if (date.toDateString() === now.toDateString()) return time;

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;

    if (date.getFullYear() === now.getFullYear()) {
      const md = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
      return `${md} ${time}`;
    }

    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return '';
  }
}

function compactReplyText(text: string, imageUrl?: string | null, imageKey?: string | null) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized) return normalized.slice(0, 48);
  if (imageUrl) return imageKey ? '[图片]' : '[表情包]';
  return '';
}

const CHAT_PHOTO_CLASS = 'max-h-40 max-w-[220px] object-contain';
const CHAT_STICKER_CLASS = 'max-h-28 max-w-[8.5rem] rounded-xl object-contain';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMentionPrefix(nickname: string) {
  return `@${nickname} `;
}

function stripLeadingMention(value: string) {
  return value.replace(/^@[^\s@]{1,24}\s*/, '');
}

function hasMentionInText(messageText: string, targetNickname: string) {
  return new RegExp(`@${escapeRegExp(targetNickname)}(?:\\s|$)`).test(messageText);
}

const MENTION_ALL_LABEL = '全体成员';

function hasMentionAllInText(messageText: string) {
  return new RegExp(`@${escapeRegExp(MENTION_ALL_LABEL)}(?:\\s|$)`).test(messageText);
}

function matchesMentionAllQuery(query: string) {
  const normalized = query.trim().toLowerCase();
  return !normalized || MENTION_ALL_LABEL.startsWith(normalized);
}

type MentionOption =
  | { type: 'all' }
  | { type: 'user'; user: RoomUser };

const MENTION_TOKEN_RE = /(@[^\s@]{1,24})(?=\s|$)/g;

export default function ChatPanel({ className = '' }: { className?: string }) {
  const room = useRoomStore((s) => s.room);
  const nickname = useRoomStore((s) => s.nickname);
  const mySocketId = useRoomStore((s) => s.mySocketId);
  const canControlPlayback = useRoomStore((s) => s.canControlPlayback);
  const messages = useChatStore((s) => s.messages);
  const hasMoreOlder = useChatStore((s) => s.hasMoreOlder);
  const loadingOlder = useChatStore((s) => s.loadingOlder);
  const { sendChat, setChatMute, loadChatHistory, toggleChatReaction } = useSocket();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [replyTo, setReplyTo] = useState<ChatReplyRef | null>(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showMutePicker, setShowMutePicker] = useState(false);
  const [muteSaving, setMuteSaving] = useState(false);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [qqFaces, setQQFaces] = useState<QFaceItem[]>(() => getInitialQQFaces());
  const [loadingFaces, setLoadingFaces] = useState(() => !hasFullQQFaces());
  const [chatScrollRoot, setChatScrollRoot] = useState<HTMLDivElement | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [emojiGridRoot, setEmojiGridRoot] = useState<HTMLDivElement | null>(null);
  const [chatUploadEnabled, setChatUploadEnabled] = useState(false);
  const [stickerSearchEnabled, setStickerSearchEnabled] = useState(false);
  const [emojiPickerTab, setEmojiPickerTab] = useState<'faces' | 'search'>('faces');
  const [pendingImage, setPendingImage] = useState<{ url: string; key: string; previewUrl: string } | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [revealedPureImages, setRevealedPureImages] = useState<Set<string>>(() => new Set());
  const inputRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const emojiPanelRef = useRef<HTMLDivElement>(null);
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const chatOverlayHostRef = useRef<HTMLDivElement>(null);
  const emojiPickerPortalRef = useRef<HTMLDivElement>(null);
  const isMobileLayout = useMediaQuery('(max-width: 1023px)');
  const pureMode = usePureModeStore((s) => s.enabled);
  const bindEmojiGridRef = (el: HTMLDivElement | null) => {
    setEmojiGridRoot(el);
  };
  const notifiedMessageIdsRef = useRef<Set<string>>(new Set());
  const composingRef = useRef(false);
  const roomIdRef = useRef<string | null>(null);
  const stickToBottomRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const mentionQueryRef = useRef('');
  const reactionPickerOpenRef = useRef(false);
  const scrollBottomRafRef = useRef<number | null>(null);
  const welcomeConfettiIdsRef = useRef(new Set<string>());
  const welcomeConfettiCooldownRef = useRef(new Map<string, number>());
  const welcomeConfettiSessionStartRef = useRef(Date.now());
  const chatConfettiRootRef = useRef<HTMLDivElement | null>(null);
  const WELCOME_CONFETTI_COOLDOWN_MS = 5 * 60 * 1000;
  const WELCOME_CONFETTI_LIVE_GRACE_MS = 2500;

  reactionPickerOpenRef.current = reactionPickerMessageId !== null;

  const mutedSet = useMemo(() => new Set(room?.mutedUserIds || []), [room?.mutedUserIds]);
  const myUserId = mySocketId || getClientId();
  const chatMuted = isChatMutedForUser(room, myUserId);

  const messagesLayoutKey = useMemo(
    () => messages.map((m) => {
      const reactions = (m.reactions || [])
        .map((r) => `${r.emoji}:${r.users.length}`)
        .join(',');
      return `${m.id}:${m.imageUrl || ''}:${reactions}`;
    }).join('|'),
    [messages],
  );

  const orderedMuteUsers = useMemo(() => {
    if (!room) return [];
    return room.users
      .filter((user) => user.id !== myUserId)
      .sort((a, b) => a.joinedAt - b.joinedAt);
  }, [room, myUserId]);

  const toggleMuteAll = async () => {
    if (muteSaving || !room) return;
    setMuteSaving(true);
    const res = await setChatMute({ muteAll: !room.muteAll });
    setMuteSaving(false);
    if (!res.success) setError(res.error || '操作失败');
  };

  const toggleUserMute = async (user: RoomUser) => {
    if (muteSaving || user.id === myUserId) return;
    setMuteSaving(true);
    const muted = !mutedSet.has(user.id);
    const res = await setChatMute({ userId: user.id, muted });
    setMuteSaving(false);
    if (!res.success) setError(res.error || '操作失败');
  };

  const userMap = useMemo(() => new Map((room?.users || []).map((user) => [user.id, user])), [room?.users]);
  const [mentionQuery, setMentionQuery] = useState('');
  const mentionOptions = useMemo<MentionOption[]>(() => {
    const myUserId = mySocketId || getClientId();
    const query = mentionQuery.trim().toLowerCase();
    const options: MentionOption[] = [];

    if (canControlPlayback && matchesMentionAllQuery(query)) {
      options.push({ type: 'all' });
    }

    const userLimit = options.length > 0 ? 7 : 8;
    const users = (room?.users || [])
      .filter((user) => user.id !== myUserId)
      .filter((user) => !user.readOnly)
      .filter((user) => !query || user.nickname.toLowerCase().includes(query))
      .slice(0, userLimit);

    options.push(...users.map((user) => ({ type: 'user' as const, user })));
    return options.slice(0, 8);
  }, [mentionQuery, mySocketId, room?.users, canControlPlayback]);

  useEffect(() => {
    if (!room?.id) return;
    if (roomIdRef.current !== room.id) {
      roomIdRef.current = room.id;
      stickToBottomRef.current = true;
      setShowScrollToBottom(false);
      setReplyTo(null);
      setPendingImage((current) => {
        if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
        return null;
      });
      setShowMentionPicker(false);
      setMentionQuery('');
      mentionQueryRef.current = '';
      setMentionIndex(0);
      notifiedMessageIdsRef.current.clear();
      welcomeConfettiIdsRef.current.clear();
      welcomeConfettiCooldownRef.current.clear();
      welcomeConfettiSessionStartRef.current = Date.now();
    }
  }, [room?.id]);

  useEffect(() => {
    void fetchChatUploadEnabled().then(setChatUploadEnabled);
    void fetchStickerSearchEnabled().then(setStickerSearchEnabled);
  }, []);

  useEffect(() => {
    if (!showEmoji) setEmojiPickerTab('faces');
  }, [showEmoji]);

  useEffect(() => {
    if (pureMode) return;
    const container = chatConfettiRootRef.current;
    if (!container) return;

    for (const msg of messages) {
      if (msg.kind !== 'welcome' || welcomeConfettiIdsRef.current.has(msg.id)) continue;
      welcomeConfettiIdsRef.current.add(msg.id);

      // 刷新/重进房会加载历史欢迎消息，仅对本次会话内新产生的欢迎喷礼花
      if (msg.timestamp < welcomeConfettiSessionStartRef.current - WELCOME_CONFETTI_LIVE_GRACE_MS) continue;

      const targetId = msg.targetUserId || msg.id;
      const lastAt = welcomeConfettiCooldownRef.current.get(targetId) || 0;
      const now = Date.now();
      if (now - lastAt < WELCOME_CONFETTI_COOLDOWN_MS) continue;

      welcomeConfettiCooldownRef.current.set(targetId, now);
      fireWelcomeConfetti(container);
    }
  }, [messages, pureMode]);

  useEffect(() => {
    const el = chatScrollRoot;
    if (!el || reactionPickerOpenRef.current) {
      if (scrollBottomRafRef.current != null) {
        cancelAnimationFrame(scrollBottomRafRef.current);
        scrollBottomRafRef.current = null;
      }
      return;
    }
    const scrollToBottom = (behavior: ScrollBehavior) => {
      if (scrollBottomRafRef.current != null) cancelAnimationFrame(scrollBottomRafRef.current);
      scrollBottomRafRef.current = requestAnimationFrame(() => {
        scrollBottomRafRef.current = null;
        if (reactionPickerOpenRef.current) return;
        el.scrollTo({ top: el.scrollHeight, behavior });
      });
    };
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (stickToBottomRef.current) scrollToBottom('instant');
    else if (distanceToBottom < 120) scrollToBottom('smooth');
  }, [chatScrollRoot, messagesLayoutKey, room?.id, reactionPickerMessageId]);

  useEffect(() => {
    const el = chatScrollRoot;
    if (!el) return;
    const syncBottom = () => {
      if (!stickToBottomRef.current || reactionPickerOpenRef.current) return;
      el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
    };
    const ro = new ResizeObserver(syncBottom);
    const observeChildren = () => {
      ro.disconnect();
      Array.from(el.children).forEach((child) => ro.observe(child));
    };
    observeChildren();
    const mo = new MutationObserver(observeChildren);
    mo.observe(el, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [chatScrollRoot, messagesLayoutKey]);

  useEffect(() => {
    const el = chatScrollRoot;
    if (!el || !room?.id) return;

    const handleScroll = () => {
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distanceToBottom < 80;
      stickToBottomRef.current = atBottom;
      setShowScrollToBottom(!atBottom);

      if (el.scrollTop > 48 || !hasMoreOlder || loadingOlderRef.current) return;

      const oldest = useChatStore.getState().messages[0];
      if (!oldest) return;

      const requestRoomId = room.id;
      loadingOlderRef.current = true;
      useChatStore.getState().setLoadingOlder(true);
      const prevHeight = el.scrollHeight;
      const prevTop = el.scrollTop;

      void loadChatHistory(oldest.timestamp, oldest.id).then((res) => {
        loadingOlderRef.current = false;
        if (useChatStore.getState().roomId !== requestRoomId) {
          useChatStore.getState().setLoadingOlder(false);
          return;
        }
        if (!res.success || !res.messages?.length) {
          useChatStore.getState().setLoadingOlder(false);
          if (res.success) {
            useChatStore.getState().prependOlder([], false);
          }
          return;
        }

        useChatStore.getState().prependOlder(res.messages, Boolean(res.hasMore));
        requestAnimationFrame(() => {
          if (useChatStore.getState().roomId !== requestRoomId) return;
          el.scrollTop = el.scrollHeight - prevHeight + prevTop;
        });
      });
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [chatScrollRoot, room?.id, hasMoreOlder, loadChatHistory]);

  useEffect(() => {
    if (!room?.id || !messages.length || typeof Notification === 'undefined') return;
    const myUserId = mySocketId || getClientId();
    const myName = nickname.trim();
    const latestMessages = messages.slice(-5);

    for (const msg of latestMessages) {
      if (notifiedMessageIdsRef.current.has(msg.id) || msg.userId === myUserId) continue;
      const mentionedById = msg.mentions?.some((mention) => mention.id === myUserId);
      const mentionedByName = myName ? hasMentionInText(msg.text, myName) : false;
      const mentionedByAll = hasMentionAllInText(msg.text);
      if (!mentionedById && !mentionedByName && !mentionedByAll) continue;

      notifiedMessageIdsRef.current.add(msg.id);
      const notify = () => {
        if (Notification.permission !== 'granted') return;
        const notification = new Notification(`${msg.nickname} 提到了你`, {
          body: compactReplyText(msg.text, msg.imageUrl, msg.imageKey),
          tag: `openmusic-mention-${room.id}-${msg.id}`,
          silent: false,
        });
        notification.onclick = () => window.focus();
      };

      if (Notification.permission === 'default') {
        void Notification.requestPermission().then(notify);
      } else {
        notify();
      }
    }
  }, [mySocketId, nickname, room?.id, messages]);

  useEffect(() => {
    if (!showEmoji) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (reactionPickerOpenRef.current) return;
      const target = event.target as Node;
      if (emojiPanelRef.current?.contains(target)) return;
      if (emojiPickerPortalRef.current?.contains(target)) return;
      setShowEmoji(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [showEmoji]);

  useEffect(() => subscribeQQFaces((faces) => {
    setQQFaces(faces);
    setLoadingFaces(!hasFullQQFaces());
  }), []);

  useEffect(() => {
    if (!showEmoji) return;
    ensureQQFacesLoaded();
  }, [showEmoji]);

  useEffect(() => {
    if (!showMutePicker) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowMutePicker(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showMutePicker]);

  if (!room) return null;

  const readEditorNode = (node: ChildNode): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (!(node instanceof HTMLElement)) return '';
    if (node.dataset.qqFaceId) return qqFaceToken(node.dataset.qqFaceId);
    if (node.tagName === 'BR') return '';
    return Array.from(node.childNodes).map(readEditorNode).join('');
  };

  const serializeEditorNodes = (nodes: Iterable<ChildNode>) => {
    return Array.from(nodes).map(readEditorNode).join('');
  };

  const serializeEditor = () => {
    const editor = inputRef.current;
    if (!editor) return text;
    return serializeEditorNodes(editor.childNodes);
  };

  const getTextBeforeCursor = () => {
    const editor = inputRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return serializeEditor();
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return serializeEditor();
    const preRange = document.createRange();
    preRange.selectNodeContents(editor);
    preRange.setEnd(range.startContainer, range.startOffset);
    const container = document.createElement('div');
    container.appendChild(preRange.cloneContents());
    return serializeEditorNodes(container.childNodes);
  };

  const getActiveMentionQuery = (beforeCursor: string) => {
    const match = beforeCursor.match(/@([^\s@]*)$/);
    return match ? match[1] : null;
  };

  const syncEditorState = () => {
    const nextText = serializeEditor();
    setText(nextText);
    const activeQuery = getActiveMentionQuery(getTextBeforeCursor());
    if (activeQuery === null) {
      setShowMentionPicker(false);
      setMentionQuery('');
      mentionQueryRef.current = '';
      return;
    }
    const queryChanged = mentionQueryRef.current !== activeQuery;
    mentionQueryRef.current = activeQuery;
    setMentionQuery(activeQuery);
    const filtered = (room?.users || [])
      .filter((user) => user.id !== (mySocketId || getClientId()))
      .filter((user) => !user.readOnly)
      .filter((user) => !activeQuery || user.nickname.toLowerCase().includes(activeQuery.toLowerCase()));
    const showAll = canControlPlayback && matchesMentionAllQuery(activeQuery);
    setShowMentionPicker(filtered.length > 0 || showAll);
    if (queryChanged) setMentionIndex(0);
  };

  const getSelectedTextLength = () => {
    const editor = inputRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !selection.anchorNode || !editor.contains(selection.anchorNode)) return 0;
    return selection.toString().length;
  };

  const insertPlainText = (value: string) => {
    const editor = inputRef.current;
    if (!editor) {
      setText((current) => `${current}${value}`.slice(0, MAX_CHAT_LENGTH));
      setShowMentionPicker(false);
      return;
    }
    editor.focus();
    document.execCommand('insertText', false, value);
    syncEditorState();
  };

  const setEditorPlainText = (value: string) => {
    const editor = inputRef.current;
    if (!editor) {
      setText(value);
      return;
    }
    editor.textContent = value;
    syncEditorState();
    requestAnimationFrame(() => {
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  };

  const applyReplyMention = (targetNickname: string) => {
    const body = stripLeadingMention(serializeEditor());
    const editor = inputRef.current;
    if (!editor) {
      setText((buildMentionPrefix(targetNickname) + body).slice(0, MAX_CHAT_LENGTH));
      return;
    }
    editor.textContent = '';
    setText('');
    insertPlainText(`${buildMentionPrefix(targetNickname)}${body}`.slice(0, MAX_CHAT_LENGTH));
  };

  const clearEditor = () => {
    if (inputRef.current) inputRef.current.textContent = '';
    setText('');
    setShowMentionPicker(false);
    setMentionQuery('');
    mentionQueryRef.current = '';
    setMentionIndex(0);
  };

  const buildMentions = (messageText: string) => {
    const myUserId = mySocketId || getClientId();
    if (hasMentionAllInText(messageText)) {
      return (room.users || [])
        .filter((user) => user.id !== myUserId && !user.readOnly)
        .map((user) => ({ id: user.id, nickname: user.nickname }));
    }
    return room.users
      .filter((user) => hasMentionInText(messageText, user.nickname))
      .slice(0, 10)
      .map((user) => ({ id: user.id, nickname: user.nickname }));
  };

  const scrollChatToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const el = chatScrollRoot;
    if (!el) return;
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  const clearPendingImage = () => {
    setPendingImage((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const submitChatImage = async (file: File) => {
    if (!room?.id || chatMuted || uploadingImage) return;

    setError('');
    setUploadingImage(true);
    try {
      const uploaded = await uploadChatImage(room.id, file);
      setPendingImage((current) => {
        if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
        return {
          url: uploaded.url,
          key: uploaded.key,
          previewUrl: uploaded.previewUrl,
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片上传失败');
    } finally {
      setUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const handleImagePick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await submitChatImage(file);
  };

  const handleSend = async () => {
    const messageText = serializeEditor().trim();
    const currentImage = pendingImage;
    if ((!messageText && !currentImage) || sending) return;

    const mentions = buildMentions(messageText);
    const currentReplyTo = replyTo;

    stickToBottomRef.current = true;
    clearEditor();
    setReplyTo(null);
    clearPendingImage();
    setSending(true);
    setError('');

    const res = await sendChat(messageText, {
      mentions,
      replyTo: currentReplyTo,
      imageUrl: currentImage?.url,
      imageKey: currentImage?.key,
    });
    if (!res.success) {
      insertPlainText(messageText);
      setReplyTo(currentReplyTo);
      if (currentImage) {
        setPendingImage({
          url: currentImage.url,
          key: currentImage.key,
          previewUrl: currentImage.previewUrl,
        });
      }
      setError(res.error || '发送失败');
    }
    setSending(false);
  };

  const handleSendSticker = async (imageUrl: string) => {
    if (chatMuted || sending) {
      throw new Error(chatMuted ? '当前无法发送' : '正在发送');
    }

    const currentReplyTo = replyTo;

    stickToBottomRef.current = true;
    setReplyTo(null);
    setSending(true);
    setError('');

    const res = await sendChat('', { imageUrl, replyTo: currentReplyTo });
    if (!res.success) {
      setReplyTo(currentReplyTo);
      setError(res.error || '发送失败');
      setSending(false);
      throw new Error(res.error || '发送失败');
    }

    setSending(false);
    setShowEmoji(false);
    setEmojiPickerTab('faces');
  };

  const handleReply = (msg: ChatMessage) => {
    setReplyTo({
      id: msg.id,
      userId: msg.userId,
      nickname: msg.nickname,
      text: compactReplyText(msg.text, msg.imageUrl, msg.imageKey),
      imageUrl: msg.imageUrl || null,
      imageKey: msg.imageKey || null,
    });
    const isSelf = msg.userId === mySocketId || msg.nickname === nickname;
    if (!isSelf) {
      applyReplyMention(msg.nickname);
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    const res = await toggleChatReaction(messageId, emoji);
    if (!res.success && res.error) {
      setError(res.error);
    }
  };

  const deleteTextBeforeCursor = (count: number) => {
    const editor = inputRef.current;
    if (!editor || count <= 0) return;
    editor.focus();
    for (let i = 0; i < count; i += 1) {
      document.execCommand('delete', false, 'Backward');
    }
  };

  const handleMentionOption = (option: MentionOption) => {
    const partialMention = getTextBeforeCursor().match(/@([^\s@]*)$/);
    if (partialMention) deleteTextBeforeCursor(partialMention[0].length);
    const token = option.type === 'all'
      ? `@${MENTION_ALL_LABEL} `
      : `@${option.user.nickname} `;
    insertPlainText(token);
    setShowMentionPicker(false);
    setMentionQuery('');
    mentionQueryRef.current = '';
    setMentionIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const insertEmoji = (face: QFaceItem) => {
    const editor = inputRef.current;
    const token = qqFaceToken(face.id);
    if (!editor) {
      setText((value) => `${value}${token}`.slice(0, MAX_CHAT_LENGTH));
      return;
    }
    if (serializeEditor().length - getSelectedTextLength() + token.length > MAX_CHAT_LENGTH) {
      setError(`消息最多 ${MAX_CHAT_LENGTH} 字`);
      editor.focus();
      setShowMentionPicker(false);
      return;
    }
    void requestQFaceImage(face.id, QFaceLoadPriority.MESSAGE).then(() => {
      const img = document.createElement('img');
      img.src = face.url;
      img.alt = face.text;
      img.title = face.text;
      img.dataset.qqFaceId = face.id;
      img.contentEditable = 'false';
      img.className = 'mx-0.5 inline-block h-5 w-auto max-w-6 object-contain align-[-0.2em]';
      const selection = window.getSelection();
      let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const anchorNode = selection?.anchorNode;
      if (!range || !anchorNode || !editor.contains(anchorNode)) {
        range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
      }
      range.deleteContents();
      range.insertNode(img);
      range.setStartAfter(img);
      range.collapse(true);
      requestAnimationFrame(() => {
        editor.focus();
        selection?.removeAllRanges();
        selection?.addRange(range);
        syncEditorState();
      });
    });
  };

  const renderMessageText = (
    messageText: string,
    variant: 'message' | 'reply' = 'message',
  ) => {
    const isReply = variant === 'reply';
    const faceClass = isReply
      ? 'mx-0.5 inline-block h-4 w-auto max-w-5 object-contain align-middle'
      : 'mx-0.5 inline-block h-7 w-auto max-w-8 object-contain align-middle';
    const facePlaceholderClass = isReply
      ? 'mx-0.5 inline-block h-4 w-4 align-middle'
      : 'mx-0.5 inline-block h-7 w-6 align-middle';
    const keyPrefix = isReply ? 'reply' : 'msg';

    return parseQQFaceTokens(messageText).map((part, index) => {
      if (typeof part === 'string') {
        const pieces = part.split(MENTION_TOKEN_RE);
        return pieces.map((piece, pieceIndex) => piece.startsWith('@')
          ? <span key={`${keyPrefix}-mention-${index}-${pieceIndex}`} className="break-words text-sky-300 [overflow-wrap:anywhere]">{piece}</span>
          : <span key={`${keyPrefix}-text-${index}-${pieceIndex}`} className="break-words [overflow-wrap:anywhere]">{piece}</span>);
      }
      return (
        <QFaceImage
          key={`${keyPrefix}-face-${part.id}-${index}`}
          id={part.id}
          priority={QFaceLoadPriority.MESSAGE}
          nearPriority={QFaceLoadPriority.NEAR}
          observeRoot={chatScrollRoot}
          className={faceClass}
          placeholderClassName={facePlaceholderClass}
        />
      );
    });
  };

  const renderReplyRefContent = (reply: ChatReplyRef, alignEnd = false) => {
    const hasText = reply.text.trim().length > 0;
    const isSticker = Boolean(reply.imageUrl && !reply.imageKey);
    const isPhoto = Boolean(reply.imageUrl && reply.imageKey);

    return (
      <span className={`inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 ${alignEnd ? 'justify-end' : ''}`}>
        {hasText && renderMessageText(reply.text, 'reply')}
        {isSticker && (
          <img
            src={reply.imageUrl!}
            alt="表情包"
            loading="lazy"
            className="max-h-8 max-w-[3.5rem] shrink-0 rounded object-contain"
          />
        )}
        {isPhoto && !hasText && <span>[图片]</span>}
      </span>
    );
  };

  const renderEmojiPickerContent = (gridClassName: string) => {
    if (emojiPickerTab === 'search') {
      return (
        <StickerSearchPanel
          disabled={chatMuted || sending}
          onBack={() => setEmojiPickerTab('faces')}
          onPick={handleSendSticker}
        />
      );
    }

    return (
      <>
        <div className="mb-1.5 flex flex-shrink-0 items-center justify-between px-1">
          <span className="text-[11px] text-netease-muted">QQNT 表情</span>
          <div className="flex items-center gap-1.5">
            {stickerSearchEnabled && (
              <Tooltip content="搜索表情包">
                <button
                  type="button"
                  onClick={() => setEmojiPickerTab('search')}
                  className="rounded-lg p-1 text-netease-muted transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="搜索表情包"
                >
                  <Search className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            )}
            {loadingFaces && (
              <span className="text-[11px] text-netease-muted/60">正在补全...</span>
            )}
          </div>
        </div>
        <div ref={bindEmojiGridRef} className={gridClassName}>
          {qqFaces.map((face) => (
            <Tooltip key={face.id} content={face.text}>
              <button
                type="button"
                data-face-id={face.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertEmoji(face)}
                className="flex h-8 items-center justify-center rounded-lg transition-colors hover:bg-white/10 active:bg-white/15"
                aria-label={face.text}
              >
                <QFaceImage
                  id={face.id}
                  priority={QFaceLoadPriority.PANEL}
                  nearPriority={QFaceLoadPriority.NEAR}
                  observeRoot={emojiGridRoot}
                  className="h-6 w-auto max-w-7 object-contain"
                  placeholderClassName="h-6 w-6"
                />
              </button>
            </Tooltip>
          ))}
        </div>
      </>
    );
  };

  const mobileEmojiPickerPortal = showEmoji && isMobileLayout ? (
    <div className="fixed inset-0 z-[80]">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={() => setShowEmoji(false)}
        aria-label="关闭表情"
      />
      <div
        ref={emojiPickerPortalRef}
        className={`absolute inset-x-0 bottom-0 flex flex-col rounded-t-2xl border-t border-netease-border/70 bg-netease-dark/98 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] shadow-2xl backdrop-blur ${emojiPickerTab === 'search' ? '' : 'max-h-[min(68vh,480px)]'}`}
        style={emojiPickerTab === 'search' ? { height: STICKER_SEARCH_PICKER_HEIGHT } : undefined}
      >
        {renderEmojiPickerContent('grid min-h-0 flex-1 grid-cols-8 gap-0.5 overflow-y-auto overscroll-contain px-0.5 py-0.5')}
      </div>
    </div>
  ) : null;

  const renderMutePickerBody = () => (
    <>
      <div className="mb-3 flex flex-shrink-0 items-center justify-between px-1">
        <h2 className="text-base font-semibold text-white">禁言管理</h2>
        <button
          type="button"
          onClick={() => setShowMutePicker(false)}
          className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
        <button
          type="button"
          disabled={muteSaving}
          onClick={() => void toggleMuteAll()}
          className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-50 ${room.muteAll ? 'bg-amber-400/15 text-amber-300' : 'text-white/90 hover:bg-white/10'}`}
        >
          <span className="font-medium">全体禁言</span>
          <span className="text-xs text-netease-muted">{room.muteAll ? '点击解禁' : '点击禁言'}</span>
        </button>
        {orderedMuteUsers.map((user) => {
          const isMuted = mutedSet.has(user.id);
          return (
            <button
              key={user.id}
              type="button"
              disabled={muteSaving}
              onClick={() => void toggleUserMute(user)}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-40 ${isMuted ? 'bg-amber-400/15 text-amber-300' : 'text-white/90 hover:bg-white/10'}`}
            >
              <span className="min-w-0 truncate">{user.nickname}</span>
              <span className="ml-2 flex-shrink-0 text-xs text-netease-muted">
                {isMuted ? '点击解禁' : '点击禁言'}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );

  const desktopMutePickerPortal = showMutePicker && !isMobileLayout && chatPanelRef.current ? (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-3">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        onClick={() => setShowMutePicker(false)}
        aria-label="关闭禁言管理"
      />
      <div className="relative z-10 flex w-[min(320px,92%)] max-h-[min(72%,360px)] flex-col rounded-2xl border border-white/10 glass p-4 shadow-2xl animate-fade-in">
        {renderMutePickerBody()}
      </div>
    </div>
  ) : null;

  const mobileMutePickerPortal = showMutePicker && isMobileLayout ? (
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => setShowMutePicker(false)}
        aria-label="关闭禁言管理"
      />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[min(75vh,480px)] flex-col rounded-t-2xl border-t border-white/10 glass p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-2xl animate-fade-in">
        {renderMutePickerBody()}
      </div>
    </div>
  ) : null;

  return (
    <div ref={chatPanelRef} className={`relative flex h-full flex-col overflow-hidden rounded-2xl border border-netease-border/50 bg-netease-card/30 ${className}`}>
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-netease-border/50 px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <MessageCircle className="h-4 w-4 text-netease-muted" />
          <h3 className="text-sm font-medium">聊天室</h3>
          {room.muteAll && (
            <span className="text-[10px] text-amber-400/90 bg-amber-400/10 px-1.5 py-0.5 rounded-full">全体禁言</span>
          )}
        </div>
        {canControlPlayback && (
          <Tooltip side="bottom" content="禁言管理">
            <button
              type="button"
              onClick={() => setShowMutePicker(true)}
              className="rounded-lg p-1.5 text-netease-muted transition-colors hover:bg-white/10 hover:text-white"
              aria-label="禁言管理"
            >
              <MicOff className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
      </div>

      <div ref={chatConfettiRootRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={setChatScrollRoot} className="h-full space-y-2 overflow-x-hidden overflow-y-auto px-3 py-2 pb-3">
          {(loadingOlder || hasMoreOlder) && (
            <p className="py-1 text-center text-[10px] text-netease-muted">
              {loadingOlder ? '加载更早的消息…' : '上滑加载更多'}
            </p>
          )}
          {messages.length === 0 ? (
            <p className="py-8 text-center text-xs text-netease-muted">暂无消息，打个招呼吧</p>
          ) : messages.map((msg) => {
          if (msg.kind === 'welcome') {
            if (pureMode) return null;
            return (
              <div key={msg.id} className="flex justify-center py-1">
                <div className="welcome-chat-card max-w-[92%] rounded-2xl px-4 py-3 text-center">
                  <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
                    {msg.memberTier && <MemberTierBadge tier={msg.memberTier} />}
                    {msg.targetNickname && (
                      <span className="text-sm font-medium text-white">{msg.targetNickname}</span>
                    )}
                  </div>
                  <p className="break-words text-sm leading-6 text-white/95 [overflow-wrap:anywhere]">{msg.text}</p>
                  {msg.timestamp > 0 && (
                    <p className="mt-2 text-[10px] text-netease-muted/70">{formatChatTime(msg.timestamp)}</p>
                  )}
                </div>
              </div>
            );
          }

          const myUserId = mySocketId || getClientId();
          const isMe = msg.userId === myUserId;
          const isRoomCreator = msg.userId === room.creatorId;
          const userMemberTier = room.memberTiers?.[msg.userId];
          const user = userMap.get(msg.userId);
          const isStickerImage = Boolean(msg.imageUrl && !msg.imageKey);
          const isPureImageRevealed = pureMode && Boolean(msg.imageUrl) && revealedPureImages.has(msg.id);
          const isPureStickerHidden = pureMode && isStickerImage && !isPureImageRevealed;
          const isPhotoOnly = Boolean(
            msg.imageUrl && !msg.text && !isStickerImage && (!pureMode || isPureImageRevealed),
          );
          const bubbleClass = `min-w-0 max-w-full rounded-2xl text-sm leading-7 break-words [overflow-wrap:anywhere] ${isPhotoOnly ? 'p-1' : 'px-3 py-1.5'} ${isMe ? 'rounded-br-md bg-netease-red/20 text-white' : 'rounded-bl-md bg-netease-dark/80 text-white/90'}`;
          const replyBubbleClass = `min-w-0 max-w-full rounded-2xl px-3 py-1.5 text-sm ${isMe ? 'rounded-br-md bg-netease-red/20 text-white' : 'rounded-bl-md bg-netease-dark/80 text-white/90'}`;

          const renderReplyPreview = () => {
            if (!msg.replyTo) return null;
            const borderClass = isMe ? 'border-r-2 border-white/20' : 'border-l-2 border-white/20';
            return (
              <div className={`min-w-0 max-w-full rounded-lg bg-black/20 px-2 py-1 text-xs leading-5 text-netease-muted ${borderClass}`}>
                <div className={`flex min-w-0 max-w-full flex-col gap-0.5 ${isMe ? 'items-end text-right' : 'items-start'}`}>
                  <span>回复 {msg.replyTo.nickname}：</span>
                  {renderReplyRefContent(msg.replyTo, isMe)}
                </div>
              </div>
            );
          };

          const renderStickerContent = () => {
            if (!msg.imageUrl || !isStickerImage) return null;
            if (isPureStickerHidden) {
              return (
                <button
                  type="button"
                  onClick={() => {
                    setRevealedPureImages((prev) => {
                      const next = new Set(prev);
                      next.add(msg.id);
                      return next;
                    });
                  }}
                  className="text-sky-300/90 transition-colors hover:text-sky-200"
                  aria-label="加载表情包"
                >
                  表情包
                </button>
              );
            }
            return (
              <img
                src={msg.imageUrl}
                alt="表情包"
                loading="lazy"
                className={CHAT_STICKER_CLASS}
              />
            );
          };

          const renderPhotoContent = () => {
            if (!msg.imageUrl || isStickerImage) return null;
            if (pureMode && !isPureImageRevealed) {
              return (
                <button
                  type="button"
                  onClick={() => {
                    setRevealedPureImages((prev) => {
                      const next = new Set(prev);
                      next.add(msg.id);
                      return next;
                    });
                  }}
                  className="text-sky-300/90 transition-colors hover:text-sky-200"
                  aria-label="加载查看图片"
                >
                  图片
                </button>
              );
            }
            if (pureMode && isPureImageRevealed) {
              return (
                <div className="overflow-hidden rounded-lg">
                  <img
                    src={msg.imageUrl}
                    alt="聊天图片"
                    loading="lazy"
                    className={CHAT_PHOTO_CLASS}
                  />
                </div>
              );
            }
            return (
              <Tooltip content="点击查看大图">
                <button
                  type="button"
                  onClick={() => setPreviewImageUrl(msg.imageUrl!)}
                  className="block cursor-zoom-in overflow-hidden rounded-lg"
                  aria-label="查看聊天图片"
                >
                  <img
                    src={msg.imageUrl}
                    alt="聊天图片"
                    loading="lazy"
                    className={CHAT_PHOTO_CLASS}
                  />
                </button>
              </Tooltip>
            );
          };

          return (
            <div key={msg.id} className={`group flex w-full min-w-0 max-w-full flex-col ${isMe ? 'items-end' : 'items-start'}`} onContextMenu={(event) => { event.preventDefault(); handleReply(msg); }}>
              <div className={`mb-0.5 flex max-w-full min-w-0 items-center gap-1.5 ${isMe ? 'flex-row-reverse' : ''}`}>
                <button type="button" onClick={() => user && handleMentionOption({ type: 'user', user })} className={`max-w-full truncate text-[10px] ${isMe ? 'text-netease-red/80' : 'text-netease-muted'} hover:text-sky-300`}>
                  {msg.nickname}
                </button>
                {isRoomCreator && <RoleBadge role="owner" />}
                {userMemberTier && <MemberTierBadge tier={userMemberTier} />}
                {msg.timestamp > 0 && (
                  <Tooltip content={new Date(msg.timestamp).toLocaleString('zh-CN')} side="bottom">
                    <time
                      dateTime={new Date(msg.timestamp).toISOString()}
                      className="text-[10px] text-netease-muted/65 tabular-nums whitespace-nowrap"
                    >
                      {formatChatTime(msg.timestamp)}
                    </time>
                  </Tooltip>
                )}
              </div>
              <div className={`flex min-w-0 max-w-[90%] items-start gap-1.5 ${isMe ? 'flex-row-reverse justify-end' : ''}`}>
                <div className={`flex min-w-0 max-w-full flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  {isStickerImage ? (
                    <div className={`flex min-w-0 max-w-full flex-col gap-1 ${isMe ? 'items-end' : 'items-start'}`}>
                      {msg.replyTo && (
                        <div className={replyBubbleClass}>
                          {renderReplyPreview()}
                        </div>
                      )}
                      <div className="min-w-0 max-w-full">
                        {renderStickerContent()}
                      </div>
                    </div>
                  ) : (
                    <div className={bubbleClass}>
                      {msg.replyTo && (
                        <div className={`mb-1 ${isPhotoOnly ? 'mx-1 mt-1' : ''}`}>
                          {renderReplyPreview()}
                        </div>
                      )}
                      {renderPhotoContent()}
                      {msg.text ? renderMessageText(msg.text) : null}
                    </div>
                  )}
                  <ChatMessageReactions
                    reactions={msg.reactions}
                    myUserId={myUserId}
                    alignEnd={isMe}
                    onToggle={(emoji) => handleToggleReaction(msg.id, emoji)}
                    containerRef={chatPanelRef}
                    scrollRoot={chatScrollRoot}
                  />
                </div>
                <div
                  className={`relative mt-1 flex flex-col gap-0.5 transition-opacity ${
                    reactionPickerMessageId === msg.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                >
                  <Tooltip content="回复">
                    <button type="button" onClick={() => handleReply(msg)} className="rounded p-0.5 text-netease-muted hover:bg-white/10 hover:text-white" aria-label="回复">
                      <Reply className="h-3 w-3" />
                    </button>
                  </Tooltip>
                  <Tooltip content="点评表情">
                    <button
                      type="button"
                      disabled={chatMuted}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setReactionPickerMessageId((current) => (current === msg.id ? null : msg.id))}
                      className="rounded p-0.5 text-netease-muted hover:bg-white/10 hover:text-white disabled:opacity-40"
                      aria-label="点评表情"
                    >
                      <Smile className="h-3 w-3" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>
          );
          })}
        </div>
        {showScrollToBottom && (
          <Tooltip content="回到底部">
            <button
              type="button"
              onClick={() => scrollChatToBottom('smooth')}
              className="absolute bottom-3 right-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-netease-dark/95 text-white shadow-lg backdrop-blur transition-colors hover:bg-white/15"
              aria-label="回到底部"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
      </div>

      <div ref={chatOverlayHostRef} className="pointer-events-none absolute inset-0 z-30" />

      <ChatReactionPicker
        open={reactionPickerMessageId !== null}
        disabled={chatMuted}
        scrollRoot={chatScrollRoot}
        containerRef={chatPanelRef}
        overlayHostRef={chatOverlayHostRef}
        onClose={() => setReactionPickerMessageId(null)}
        onPick={(emoji) => {
          if (reactionPickerMessageId) {
            void handleToggleReaction(reactionPickerMessageId, emoji);
          }
        }}
      />

      <div className="flex-shrink-0 border-t border-netease-border/50 p-2">
        {chatMuted && (
          <p className="mb-1.5 text-center text-xs text-amber-400/90">
            {room.muteAll ? '房主已开启全体禁言' : '你已被禁言，无法发送消息'}
          </p>
        )}
        {replyTo && (
          <div className="mb-1.5 flex items-center justify-between rounded-xl bg-white/5 px-2 py-1 text-xs text-netease-muted">
            <span className="min-w-0 flex flex-1 items-center gap-1 overflow-hidden leading-5">
              <span className="flex-shrink-0">回复 {replyTo.nickname}：</span>
              <span className="min-w-0 overflow-hidden">{renderReplyRefContent(replyTo)}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                if (replyTo) {
                  const current = serializeEditor();
                  const stripped = stripLeadingMention(current);
                  if (stripped !== current) setEditorPlainText(stripped);
                }
                setReplyTo(null);
              }}
              className="ml-2 rounded p-0.5 hover:bg-white/10"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        {error && <p className="mb-1 text-xs text-netease-red">{error}</p>}
        {pendingImage && (
          <div className="mb-1.5 flex items-center gap-2 rounded-xl bg-white/5 px-2 py-1.5">
            <button
              type="button"
              onClick={() => setPreviewImageUrl(pendingImage.previewUrl)}
              className="flex-shrink-0 cursor-zoom-in overflow-hidden rounded-lg"
              aria-label="预览待发送图片"
            >
              <img
                src={pendingImage.previewUrl}
                alt="待发送图片"
                className="h-14 w-14 object-cover"
              />
            </button>
            <span className="min-w-0 flex-1 truncate text-xs text-netease-muted">
              {uploadingImage ? '正在压缩并上传…' : '已选择图片，可附带文字后发送'}
            </span>
            <button
              type="button"
              onClick={clearPendingImage}
              className="rounded p-0.5 text-netease-muted hover:bg-white/10 hover:text-white"
              aria-label="移除图片"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="relative flex items-center gap-2" ref={emojiPanelRef}>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={(event) => { void handleImagePick(event); }}
          />
          {showEmoji && !isMobileLayout && (
            <div
              className={`absolute bottom-full left-0 z-20 mb-2 box-border flex w-full max-w-full flex-col rounded-2xl border border-netease-border/70 bg-netease-dark/95 p-2 shadow-2xl backdrop-blur ${emojiPickerTab === 'search' ? '' : 'max-h-80'}`}
              style={emojiPickerTab === 'search' ? { height: STICKER_SEARCH_PICKER_HEIGHT } : undefined}
            >
              {renderEmojiPickerContent('grid max-h-64 grid-cols-8 gap-0.5 overflow-y-auto overscroll-contain px-0.5 py-0.5')}
            </div>
          )}
          <Tooltip content="QQ 表情">
            <button
              type="button"
              onClick={() => setShowEmoji((value) => !value)}
              disabled={chatMuted}
              className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-netease-border/50 transition-colors disabled:opacity-40 ${showEmoji ? 'border-netease-red/30 bg-netease-red/15 text-netease-red' : 'bg-netease-dark text-netease-muted hover:bg-white/5 hover:text-white'}`}
              aria-label="QQ 表情"
            >
              <Smile className="h-4 w-4" />
            </button>
          </Tooltip>
          {chatUploadEnabled && (
            <Tooltip content="发送图片（支持粘贴截图）">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={chatMuted || uploadingImage || sending}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-netease-border/50 bg-netease-dark text-netease-muted transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
                aria-label="发送图片"
              >
                <ImagePlus className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
          <div className="relative min-w-0 flex-1">
            {showMentionPicker && (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-56 overflow-hidden rounded-2xl border border-netease-border/70 bg-netease-dark/95 p-1.5 shadow-2xl backdrop-blur">
                {mentionOptions.map((option, index) => (
                  option.type === 'all' ? (
                    <button
                      key="mention-all"
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setMentionIndex(index)}
                      onClick={() => handleMentionOption(option)}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${index === mentionIndex ? 'bg-white/10 text-white' : 'text-white/85 hover:bg-white/10'}`}
                    >
                      <span className="min-w-0 truncate text-sky-300">@{MENTION_ALL_LABEL}</span>
                      <span className="ml-2 flex-shrink-0 text-[10px] text-sky-400/80">全员</span>
                    </button>
                  ) : (
                    <button
                      key={option.user.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setMentionIndex(index)}
                      onClick={() => handleMentionOption(option)}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${index === mentionIndex ? 'bg-white/10 text-white' : 'text-white/85 hover:bg-white/10'}`}
                    >
                      <span className="min-w-0 truncate">{option.user.nickname}</span>
                      {option.user.id === room.creatorId && <RoleBadge role="owner" className="ml-2" />}
                    </button>
                  )
                ))}
              </div>
            )}
            {!text && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-netease-muted/50">{nickname || '你'}说点什么...</span>}
            <div
              ref={inputRef}
              role="textbox"
              aria-label="聊天输入框"
              contentEditable={!chatMuted}
              suppressContentEditableWarning
              onBeforeInput={(event) => {
                const nativeEvent = event.nativeEvent as InputEvent;
                const inputType = nativeEvent.inputType ?? '';
                if (inputType.startsWith('delete') || nativeEvent.isComposing) return;
                const data = nativeEvent.data || '';
                if (serializeEditor().length - getSelectedTextLength() + data.length > MAX_CHAT_LENGTH) {
                  event.preventDefault();
                  setError(`消息最多 ${MAX_CHAT_LENGTH} 字`);
                }
              }}
              onInput={syncEditorState}
              onPaste={(event) => {
                if (chatUploadEnabled && !chatMuted && !uploadingImage) {
                  const clipboardFile = readClipboardImageFile(event.clipboardData);
                  if (clipboardFile) {
                    event.preventDefault();
                    void submitChatImage(clipboardFile);
                    return;
                  }
                }

                event.preventDefault();
                const remaining = MAX_CHAT_LENGTH - serializeEditor().length + getSelectedTextLength();
                if (remaining <= 0) return setError(`消息最多 ${MAX_CHAT_LENGTH} 字`);
                document.execCommand('insertText', false, event.clipboardData.getData('text/plain').slice(0, remaining));
                syncEditorState();
              }}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; syncEditorState(); }}
              onKeyDown={(event) => {
                if (showMentionPicker && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                  event.preventDefault();
                  setMentionIndex((current) => {
                    const delta = event.key === 'ArrowDown' ? 1 : -1;
                    return (current + delta + mentionOptions.length) % mentionOptions.length;
                  });
                  return;
                }
                if (showMentionPicker && (event.key === 'Tab' || event.key === 'Enter')) {
                  event.preventDefault();
                  const option = mentionOptions[mentionIndex];
                  if (option) handleMentionOption(option);
                  return;
                }
                if (event.key === 'Escape' && showMentionPicker) {
                  event.preventDefault();
                  setShowMentionPicker(false);
                  setMentionIndex(0);
                  return;
                }
                if (event.key !== 'Enter') return;
                if (event.nativeEvent.isComposing || composingRef.current) return;
                event.preventDefault();
                void handleSend();
              }}
              className={`h-9 overflow-x-auto overflow-y-hidden whitespace-nowrap rounded-xl border border-netease-border/50 bg-netease-dark px-3 py-1.5 text-sm leading-6 text-white focus:border-netease-red/40 focus:outline-none ${chatMuted ? 'opacity-50 pointer-events-none' : ''}`}
            />
          </div>
          <button
            onClick={() => { void handleSend(); }}
            disabled={sending || uploadingImage || (!text.trim() && !pendingImage) || chatMuted}
            className="rounded-xl bg-netease-red px-3 py-1.5 text-white transition-colors hover:bg-red-500 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>

      {mobileEmojiPickerPortal && createPortal(mobileEmojiPickerPortal, document.body)}

      {desktopMutePickerPortal && createPortal(desktopMutePickerPortal, chatPanelRef.current!)}
      {mobileMutePickerPortal && createPortal(mobileMutePickerPortal, document.body)}

      <ChatImageLightbox
        imageUrl={previewImageUrl}
        onClose={() => setPreviewImageUrl(null)}
      />
    </div>
  );
}
