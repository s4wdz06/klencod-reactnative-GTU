import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  Ban,
  Check,
  CheckCheck,
  ChevronUp,
  Copy,
  Edit3,
  Flag,
  Globe,
  Loader2,
  LogOut,
  Megaphone,
  MessageSquare,
  Paperclip,
  Pin,
  PinOff,
  Reply,
  Search,
  Send,
  ShieldAlert,
  SmilePlus,
  Trash2,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiRequest, enqueueOfflineAction, loadDraft, saveDraft } from '../lib/api.ts';
import { useOnlineStatus } from '../hooks/usePWA.ts';
import { ChatMessage, ConversationItem, MessageReactionSummary } from '../types/gtu.ts';

const QUICK_EMOJIS = ['👍', '❤️', '👏', '🔥', '💡', '✅'] as const;

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'الإدارة العليا',
  admin: 'إداري',
  wilaya_rep: 'ممثل ولاية',
};

function formatDateSeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === todayStr) return 'اليوم';
  if (d.toDateString() === yesterday.toDateString()) return 'أمس';
  return d.toLocaleDateString('ar-DZ', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatSidebarTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('ar-DZ', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('ar-DZ', { day: 'numeric', month: 'short' });
}

export const ChatWorkspacePage: React.FC<{
  initialFilter: 'all' | 'groups' | 'dm';
  initialDirectConvId?: number | null;
}> = ({ initialFilter, initialDirectConvId }) => {
  const { user, subscribeWs, sendWs, isWsConnected, refreshOfflineCount } = useAuth();
  const isOnline = useOnlineStatus();

  const [tab, setTab] = useState<'national' | 'groups' | 'dm' | 'official'>(
    initialFilter === 'groups' ? 'groups' : initialFilter === 'dm' ? 'dm' : 'national'
  );
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<number | null>(initialDirectConvId || null);
  const [mobileShowThread, setMobileShowThread] = useState<boolean>(Boolean(initialDirectConvId));

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pinnedMessages, setPinnedMessages] = useState<ChatMessage[]>([]);
  const [showPinnedExpanded, setShowPinnedExpanded] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [otherLastReadMessageId, setOtherLastReadMessageId] = useState(0);
  const [roomOnlineCount, setRoomOnlineCount] = useState(0);

  // Composer & interactive states
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<{ dataUrl: string; name: string; type: string } | null>(null);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [editingTarget, setEditingTarget] = useState<ChatMessage | null>(null);
  const [openEmojiForId, setOpenEmojiForId] = useState<number | null>(null);
  const [highlightedMsgId, setHighlightedMsgId] = useState<number | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<number | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Search states
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [roomSearchOpen, setRoomSearchOpen] = useState(false);
  const [roomSearchInput, setRoomSearchInput] = useState('');
  const [activeRoomQuery, setActiveRoomQuery] = useState('');

  // Typing & Scroll
  const [typingUsers, setTypingUsers] = useState<
    Record<number, { displayName: string; expiresAt: number }>
  >({});
  const [newBelowCount, setNewBelowCount] = useState(0);

  // Status / Inline Modals (zero native window.alert/confirm/prompt)
  const [errorMsg, setErrorMsg] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [reportTargetMsgId, setReportTargetMsgId] = useState<number | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [blockTargetUser, setBlockTargetUser] = useState<{ id: number; name: string } | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isAtBottomRef = useRef(true);
  const prevRoomRef = useRef<number | null>(null);
  const lastTypingEmitRef = useRef(0);
  const typingStopTimerRef = useRef<number | null>(null);
  const msgRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((curr) => (curr === msg ? '' : curr));
    }, 3500);
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const res = await apiRequest<{ conversations: ConversationItem[] }>('/api/conversations');
      setConversations(res.conversations);
      setSelectedConvId((prev) => {
        if (prev) return prev;
        const defaultConv =
          res.conversations.find((c) => c.type === 'national') || res.conversations[0];
        return defaultConv ? defaultConv.id : null;
      });
    } catch {
      // ignore offline
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (initialDirectConvId) {
      setTab('dm');
      setSelectedConvId(initialDirectConvId);
      setMobileShowThread(true);
    }
  }, [initialDirectConvId]);

  const markConversationRead = useCallback(async (convId: number, lastId?: number) => {
    try {
      await apiRequest(`/api/conversations/${convId}/read`, {
        method: 'POST',
        body: JSON.stringify(lastId ? { lastReadMessageId: lastId } : {}),
      });
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, unreadCount: 0 } : c))
      );
    } catch {
      // ignore offline
    }
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior });
      setNewBelowCount(0);
      isAtBottomRef.current = true;
    });
  }, []);

  const fetchInitialMessages = useCallback(
    async (convId: number, qStr = '') => {
      setLoadingMessages(true);
      setErrorMsg('');
      try {
        const qs = new URLSearchParams({ limit: '50' });
        if (qStr.trim()) qs.set('q', qStr.trim());
        const d = await apiRequest<{
          messages: ChatMessage[];
          hasMore: boolean;
          nextCursor: number | null;
          pinnedMessages?: ChatMessage[];
          otherLastReadMessageId?: number;
          onlineCount?: number;
        }>(`/api/conversations/${convId}/messages?${qs.toString()}`);

        setMessages(d.messages);
        setHasMore(Boolean(d.hasMore));
        setNextCursor(d.nextCursor || null);
        if (!qStr.trim()) {
          setPinnedMessages(d.pinnedMessages || []);
          setOtherLastReadMessageId(d.otherLastReadMessageId || 0);
          if (typeof d.onlineCount === 'number') setRoomOnlineCount(d.onlineCount);
          const lastReal = [...d.messages].reverse().find((m) => m.id > 0);
          if (lastReal) void markConversationRead(convId, lastReal.id);
        }
        scrollToBottom('auto');
      } catch (err: any) {
        setErrorMsg(err?.message || 'تعذر تحميل الرسائل');
      } finally {
        setLoadingMessages(false);
      }
    },
    [markConversationRead, scrollToBottom]
  );

  // Switch active room & restore draft
  useEffect(() => {
    if (!selectedConvId) return;
    setText(loadDraft<string>(`chat_draft_${selectedConvId}`) || '');
    setReplyTarget(null);
    setEditingTarget(null);
    setAttachment(null);
    setRoomSearchOpen(false);
    setRoomSearchInput('');
    setActiveRoomQuery('');
    setTypingUsers({});
    setNewBelowCount(0);
    setOpenEmojiForId(null);
    void fetchInitialMessages(selectedConvId);
  }, [selectedConvId, fetchInitialMessages]);

  // WebSocket Room Lifecycle: join on room change / WS reconnect + delta sync via afterId
  useEffect(() => {
    if (!selectedConvId) return;
    const prevRoom = prevRoomRef.current;
    if (prevRoom && prevRoom !== selectedConvId) {
      sendWs({ type: 'typing:stop', conversationId: prevRoom });
      sendWs({ type: 'room:leave', conversationId: prevRoom });
    }
    prevRoomRef.current = selectedConvId;

    if (isWsConnected) {
      sendWs({ type: 'room:join', conversationId: selectedConvId });
      // Delta catch-up for missed messages after a reconnect
      setMessages((curr) => {
        const maxRealId = curr.reduce((max, m) => (m.id > max ? m.id : max), 0);
        if (maxRealId > 0 && !activeRoomQuery) {
          void apiRequest<{ messages: ChatMessage[] }>(
            `/api/conversations/${selectedConvId}/messages?afterId=${maxRealId}&limit=100`
          )
            .then((delta) => {
              if (delta.messages.length > 0) {
                setMessages((prevList) => {
                  const existingIds = new Set(prevList.map((x) => x.id));
                  const fresh = delta.messages.filter((x) => !existingIds.has(x.id));
                  return fresh.length > 0 ? [...prevList, ...fresh] : prevList;
                });
                const newest = delta.messages[delta.messages.length - 1];
                if (newest) void markConversationRead(selectedConvId, newest.id);
              }
            })
            .catch(() => {});
        }
        return curr;
      });
    }

    return () => {
      sendWs({ type: 'typing:stop', conversationId: selectedConvId });
      sendWs({ type: 'room:leave', conversationId: selectedConvId });
    };
  }, [selectedConvId, isWsConnected, sendWs, activeRoomQuery, markConversationRead]);

  // Prune stale typing indicators every second
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTypingUsers((prev) => {
        let changed = false;
        const next: typeof prev = {};
        for (const [uidStr, info] of Object.entries(prev)) {
          if (info.expiresAt > now) {
            next[Number(uidStr)] = info;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Real-time WebSocket event handling
  useEffect(() => {
    return subscribeWs((ev) => {
      if (ev.type === 'message:new') {
        const incoming = ev.message;
        if (incoming.conversationId === selectedConvId && !activeRoomQuery) {
          setMessages((prev) => {
            const idx = prev.findIndex(
              (m) =>
                m.id === incoming.id ||
                (Boolean(incoming.clientTempId) && m.clientTempId === incoming.clientTempId)
            );
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = incoming;
              return copy;
            }
            return [...prev, incoming];
          });
          setTypingUsers((prev) => {
            if (!prev[incoming.senderId]) return prev;
            const copy = { ...prev };
            delete copy[incoming.senderId];
            return copy;
          });
          if (incoming.senderId === user?.id || isAtBottomRef.current) {
            scrollToBottom('smooth');
            void markConversationRead(selectedConvId, incoming.id);
          } else {
            setNewBelowCount((c) => c + 1);
          }
        }
      } else if (ev.type === 'message:updated') {
        if (ev.conversationId === selectedConvId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === ev.messageId ? { ...m, content: ev.content, editedAt: ev.editedAt } : m
            )
          );
          setPinnedMessages((prev) =>
            prev.map((m) =>
              m.id === ev.messageId ? { ...m, content: ev.content, editedAt: ev.editedAt } : m
            )
          );
        }
      } else if (ev.type === 'message:deleted') {
        if (ev.conversationId === selectedConvId) {
          setMessages((prev) => prev.filter((m) => m.id !== ev.messageId));
          setPinnedMessages((prev) => prev.filter((m) => m.id !== ev.messageId));
        }
      } else if (ev.type === 'message:pinned') {
        if (ev.conversationId === selectedConvId) {
          setMessages((prev) => {
            const updated = prev.map((m) =>
              m.id === ev.messageId ? { ...m, isPinned: ev.isPinned } : m
            );
            const targetMsg = updated.find((m) => m.id === ev.messageId);
            setPinnedMessages((currPinned) => {
              if (ev.isPinned && targetMsg) {
                if (currPinned.some((p) => p.id === targetMsg.id)) return currPinned;
                return [targetMsg, ...currPinned].slice(0, 5);
              }
              return currPinned.filter((p) => p.id !== ev.messageId);
            });
            return updated;
          });
        }
      } else if (ev.type === 'message:reaction') {
        if (ev.conversationId === selectedConvId) {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== ev.messageId) return m;
              const prevMap = new Map((m.reactions || []).map((r) => [r.emoji, r]));
              const nextReactions: MessageReactionSummary[] = ev.counts.map((c) => {
                const old = prevMap.get(c.emoji);
                const reactedByMe =
                  ev.actorUserId === user?.id && c.emoji === ev.emoji
                    ? ev.isAdded
                    : old?.reactedByMe || false;
                return { emoji: c.emoji, count: c.count, reactedByMe };
              });
              return { ...m, reactions: nextReactions };
            })
          );
        }
      } else if (ev.type === 'typing') {
        if (ev.conversationId === selectedConvId && ev.userId !== user?.id) {
          setTypingUsers((prev) => {
            const copy = { ...prev };
            if (ev.isTyping) {
              copy[ev.userId] = {
                displayName: ev.displayName,
                expiresAt: Date.now() + 4000,
              };
            } else {
              delete copy[ev.userId];
            }
            return copy;
          });
        }
      } else if (ev.type === 'room:presence') {
        if (ev.conversationId === selectedConvId) {
          setRoomOnlineCount(ev.onlineCount);
        }
        setConversations((prev) =>
          prev.map((c) =>
            c.id === ev.conversationId ? { ...c, onlineCount: ev.onlineCount } : c
          )
        );
      } else if (ev.type === 'conversation:updated') {
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== ev.conversationId) return c;
            const shouldIncrementUnread =
              ev.conversationId !== selectedConvId && ev.senderId !== user?.id && c.isMember;
            return {
              ...c,
              lastMessageAt: ev.lastMessageAt,
              lastMessagePreview: ev.lastMessagePreview,
              lastMessageSender: ev.lastMessageSender,
              unreadCount: shouldIncrementUnread ? (c.unreadCount || 0) + 1 : c.unreadCount || 0,
            };
          })
        );
      } else if (ev.type === 'conversation:read') {
        if (ev.conversationId === selectedConvId && ev.readerId !== user?.id) {
          setOtherLastReadMessageId((prev) => Math.max(prev, ev.lastReadMessageId));
        }
      }
    });
  }, [
    selectedConvId,
    activeRoomQuery,
    subscribeWs,
    user?.id,
    scrollToBottom,
    markConversationRead,
  ]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distFromBottom < 80;
    isAtBottomRef.current = atBottom;
    if (atBottom && newBelowCount > 0) {
      setNewBelowCount(0);
    }
  };

  const handleLoadOlder = async () => {
    if (!selectedConvId || !hasMore || !nextCursor || loadingOlder) return;
    const el = scrollContainerRef.current;
    const prevScrollHeight = el?.scrollHeight || 0;
    setLoadingOlder(true);
    try {
      const d = await apiRequest<{
        messages: ChatMessage[];
        hasMore: boolean;
        nextCursor: number | null;
      }>(`/api/conversations/${selectedConvId}/messages?beforeId=${nextCursor}&limit=50`);
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const older = d.messages.filter((m) => !existingIds.has(m.id));
        return [...older, ...prev];
      });
      setHasMore(Boolean(d.hasMore));
      setNextCursor(d.nextCursor || null);
      requestAnimationFrame(() => {
        if (el) {
          el.scrollTop = el.scrollHeight - prevScrollHeight;
        }
      });
    } catch {
      // ignore
    } finally {
      setLoadingOlder(false);
    }
  };

  const scrollToMessage = useCallback((msgId: number) => {
    const targetEl = msgRefs.current.get(msgId);
    if (!targetEl) {
      showToast('هذه الرسالة في أرشيف أقدم — استخدم "تحميل رسائل أقدم" للوصول إليها.');
      return;
    }
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMsgId(msgId);
    window.setTimeout(() => {
      setHighlightedMsgId((curr) => (curr === msgId ? null : curr));
    }, 2200);
  }, [showToast]);

  const selectedConv = conversations.find((c) => c.id === selectedConvId);

  const handleJoinGroup = async (groupId: number, convId: number) => {
    try {
      await apiRequest(`/api/groups/${groupId}/join`, { method: 'POST' });
      await loadConversations();
      setSelectedConvId(convId);
      setMobileShowThread(true);
      showToast('تم الانضمام للمجموعة الولائية بنجاح.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر الانضمام للمجموعة');
    }
  };

  const handleLeaveGroup = async (groupId: number) => {
    try {
      await apiRequest(`/api/groups/${groupId}/leave`, { method: 'POST' });
      await loadConversations();
      showToast('تمت مغادرة المجموعة.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر مغادرة المجموعة');
    }
  };

  const readAttachmentFile = useCallback((file: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setErrorMsg('حجم الملف يتجاوز 2 ميغابايت.');
      return;
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      setErrorMsg('يُسمح فقط بالصور (JPG/PNG/WebP) أو ملفات PDF.');
      return;
    }
    setErrorMsg('');
    const r = new FileReader();
    r.onload = () =>
      setAttachment({
        dataUrl: String(r.result || ''),
        name: file.name || 'attachment',
        type: file.type,
      });
    r.readAsDataURL(file);
  }, []);

  const handleAttachmentInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readAttachmentFile(file);
    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          readAttachmentFile(file);
          break;
        }
      }
    }
  };

  const emitTyping = useCallback(
    (convId: number) => {
      const now = Date.now();
      if (now - lastTypingEmitRef.current > 1200) {
        lastTypingEmitRef.current = now;
        sendWs({ type: 'typing:start', conversationId: convId });
      }
      if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = window.setTimeout(() => {
        sendWs({ type: 'typing:stop', conversationId: convId });
      }, 2500);
    },
    [sendWs]
  );

  const handleSubmitMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedConvId) return;

    // Handle Edit Mode
    if (editingTarget) {
      const cleanEdit = text.trim();
      if (!cleanEdit) return;
      setSending(true);
      setErrorMsg('');
      try {
        const res = await apiRequest<{ ok: boolean; content: string; editedAt: string }>(
          `/api/messages/${editingTarget.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ content: cleanEdit }),
          }
        );
        setMessages((prev) =>
          prev.map((m) =>
            m.id === editingTarget.id ? { ...m, content: res.content, editedAt: res.editedAt } : m
          )
        );
        setEditingTarget(null);
        setText('');
        saveDraft(`chat_draft_${selectedConvId}`, '');
        showToast('تم تعديل الرسالة بنجاح.');
      } catch (err: any) {
        setErrorMsg(err?.message || 'تعذر تعديل الرسالة');
      } finally {
        setSending(false);
      }
      return;
    }

    if (!text.trim() && !attachment) return;
    setErrorMsg('');

    const clientTempId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const payload = {
      content: text.trim(),
      attachmentDataUrl: attachment?.dataUrl,
      attachmentName: attachment?.name,
      replyToId: replyTarget?.id || undefined,
      clientTempId,
    };

    sendWs({ type: 'typing:stop', conversationId: selectedConvId });

    if (!isOnline) {
      enqueueOfflineAction({
        type: 'message',
        url: `/api/conversations/${selectedConvId}/messages`,
        payload,
        label: `رسالة في ${selectedConv?.title || 'الشات'}`,
      });
      refreshOfflineCount();
      setText('');
      saveDraft(`chat_draft_${selectedConvId}`, '');
      setAttachment(null);
      setReplyTarget(null);
      setErrorMsg('أنت غير متصل: تم وضع الرسالة في قائمة الانتظار وستُرسل تلقائياً عند عودة الإنترنت.');
      return;
    }

    // Optimistic instant bubble
    const optimisticMsg: ChatMessage = {
      id: -Date.now(),
      conversationId: selectedConvId,
      senderId: user?.id || 0,
      replyToId: replyTarget?.id || null,
      replyTo: replyTarget
        ? {
            id: replyTarget.id,
            senderName: replyTarget.senderName,
            content: replyTarget.content.slice(0, 120),
            attachmentName: replyTarget.attachmentName || undefined,
          }
        : null,
      content: payload.content || 'مرفق',
      attachmentUrl: attachment?.dataUrl || '',
      attachmentName: attachment?.name || '',
      attachmentType: attachment?.type || '',
      isOfficial: selectedConv?.type === 'official_channel',
      isPinned: false,
      editedAt: null,
      createdAt: new Date().toISOString(),
      senderName: user?.profile
        ? `${user.profile.firstName} ${user.profile.lastName}`
        : user?.username || 'أنت',
      senderAvatar: user?.profile?.avatarUrl || '',
      senderRole: user?.roleSlug || 'member',
      senderMemberNo: user?.nationalMemberNumber || '',
      reactions: [],
      clientTempId,
      pending: true,
    };

    if (!activeRoomQuery) {
      setMessages((prev) => [...prev, optimisticMsg]);
      scrollToBottom('smooth');
    }

    const savedText = text;
    const savedAttach = attachment;
    const savedReply = replyTarget;
    setText('');
    saveDraft(`chat_draft_${selectedConvId}`, '');
    setAttachment(null);
    setReplyTarget(null);
    setSending(true);

    try {
      const res = await apiRequest<{ message: ChatMessage }>(
        `/api/conversations/${selectedConvId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );
      if (!activeRoomQuery) {
        setMessages((prev) => {
          const idx = prev.findIndex(
            (m) =>
              (m.clientTempId && m.clientTempId === clientTempId) || m.id === res.message.id
          );
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = res.message;
            return copy;
          }
          return [...prev, res.message];
        });
      }
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedConvId
            ? {
                ...c,
                lastMessageAt: res.message.createdAt,
                lastMessagePreview:
                  res.message.content.slice(0, 100) ||
                  (res.message.attachmentName ? `مرفق: ${res.message.attachmentName}` : ''),
                lastMessageSender: res.message.senderName,
                unreadCount: 0,
              }
            : c
        )
      );
    } catch (err: any) {
      // Revert optimistic message on failure and restore draft
      setMessages((prev) => prev.filter((m) => m.clientTempId !== clientTempId));
      setText(savedText);
      setAttachment(savedAttach);
      setReplyTarget(savedReply);
      setErrorMsg(err?.message || 'تعذر إرسال الرسالة');
    } finally {
      setSending(false);
    }
  };

  const handleToggleReaction = async (msgId: number, emoji: string) => {
    setOpenEmojiForId(null);
    if (msgId <= 0) return;

    // Optimistic reaction update
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const curr = [...(m.reactions || [])];
        const idx = curr.findIndex((r) => r.emoji === emoji);
        if (idx >= 0) {
          const item = curr[idx];
          if (item.reactedByMe) {
            if (item.count <= 1) curr.splice(idx, 1);
            else curr[idx] = { ...item, count: item.count - 1, reactedByMe: false };
          } else {
            curr[idx] = { ...item, count: item.count + 1, reactedByMe: true };
          }
        } else {
          curr.push({ emoji, count: 1, reactedByMe: true });
        }
        return { ...m, reactions: curr };
      })
    );

    try {
      const res = await apiRequest<{ ok: boolean; reactions: MessageReactionSummary[] }>(
        `/api/messages/${msgId}/reactions`,
        {
          method: 'POST',
          body: JSON.stringify({ emoji }),
        }
      );
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, reactions: res.reactions } : m))
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر تحديث التفاعل');
    }
  };

  const handleTogglePin = async (msg: ChatMessage) => {
    try {
      const res = await apiRequest<{ ok: boolean; isPinned: boolean }>(
        `/api/messages/${msg.id}/pin`,
        {
          method: 'POST',
          body: JSON.stringify({ isPinned: !msg.isPinned }),
        }
      );
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, isPinned: res.isPinned } : m))
      );
      setPinnedMessages((prev) => {
        if (res.isPinned) {
          if (prev.some((p) => p.id === msg.id)) return prev;
          return [{ ...msg, isPinned: true }, ...prev].slice(0, 5);
        }
        return prev.filter((p) => p.id !== msg.id);
      });
      showToast(res.isPinned ? 'تم تثبيت الرسالة في أعلى المحادثة.' : 'تم إلغاء تثبيت الرسالة.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر تغيير حالة التثبيت');
    }
  };

  const handleDeleteMessage = async (msgId: number) => {
    try {
      await apiRequest(`/api/messages/${msgId}`, { method: 'DELETE' });
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      setPinnedMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر حذف الرسالة');
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportTargetMsgId || !reportReason.trim()) return;
    try {
      await apiRequest('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          targetType: 'message',
          targetId: reportTargetMsgId,
          reason: reportReason.trim(),
        }),
      });
      setReportTargetMsgId(null);
      setReportReason('');
      showToast('تم إرسال البلاغ للإدارة للمراجعة.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر إرسال البلاغ');
    }
  };

  const handleConfirmBlockUser = async () => {
    if (!blockTargetUser) return;
    try {
      await apiRequest(`/api/users/${blockTargetUser.id}/block`, { method: 'POST' });
      setBlockTargetUser(null);
      showToast('تم حظر العضو ومنعه من المراسلة الخاصة.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر حظر العضو');
    }
  };

  const handleCopyMessage = async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedMsgId(msg.id);
      window.setTimeout(() => setCopiedMsgId((curr) => (curr === msg.id ? null : curr)), 1800);
    } catch {
      // ignore clipboard restrictions
    }
  };

  const canModerate =
    user?.roleSlug === 'super_admin' || Boolean(user?.permissions?.includes('moderate_chat'));
  const isAdmin =
    user?.roleSlug === 'super_admin' || Boolean(user?.permissions?.includes('publish_announcements'));

  // Unread totals per tab
  const tabUnread = useMemo(() => {
    const totals = { national: 0, groups: 0, dm: 0, official: 0 };
    for (const c of conversations) {
      const cnt = c.unreadCount || 0;
      if (c.type === 'national') totals.national += cnt;
      else if (c.type === 'wilaya_group') totals.groups += cnt;
      else if (c.type === 'direct') totals.dm += cnt;
      else if (c.type === 'official_channel') totals.official += cnt;
    }
    return totals;
  }, [conversations]);

  const filteredConvs = useMemo(() => {
    const q = sidebarSearch.trim();
    return conversations.filter((c) => {
      if (tab === 'national' && c.type !== 'national') return false;
      if (tab === 'official' && c.type !== 'official_channel') return false;
      if (tab === 'dm' && c.type !== 'direct') return false;
      if (tab === 'groups' && c.type !== 'wilaya_group') return false;
      if (!q) return true;
      return (
        c.title.includes(q) ||
        (c.lastMessagePreview || '').includes(q) ||
        (c.slug || '').includes(q)
      );
    });
  }, [conversations, tab, sidebarSearch]);

  const activeTypingList = Object.values(typingUsers).map((t) => t.displayName);

  const canEditMsg = (m: ChatMessage) => {
    if (m.id <= 0 || m.senderId !== user?.id) return false;
    return Date.now() - new Date(m.createdAt).getTime() <= 24 * 60 * 60 * 1000;
  };

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display">
              فضاء التواصل والشات الوطني
            </h1>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${
                isWsConnected
                  ? 'bg-[#27866F]/10 text-[#27866F] border-[#27866F]/25'
                  : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
              }`}
            >
              {isWsConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              <span>{isWsConnected ? 'اتصال فوري مباشر' : 'إعادة الاتصال...'}</span>
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-300 mt-0.5">
            تواصل فوري عالي الأداء بين الخريجين عبر الشات الوطني، المجموعات الولائية الـ 58، والمحادثات الخاصة
          </p>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] rounded-xl overflow-x-auto max-w-full">
          {(
            [
              ['national', 'الشات الوطني', tabUnread.national],
              ['groups', 'المجموعات الولائية (58)', tabUnread.groups],
              ['dm', 'الخاصة', tabUnread.dm],
              ['official', 'إعلانات الإدارة', tabUnread.official],
            ] as const
          ).map(([k, label, unread]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setTab(k);
                setSidebarSearch('');
                const first = conversations.find((c) =>
                  k === 'national'
                    ? c.type === 'national'
                    : k === 'official'
                    ? c.type === 'official_channel'
                    : k === 'dm'
                    ? c.type === 'direct'
                    : c.type === 'wilaya_group' && c.isMember
                );
                if (first) {
                  setSelectedConvId(first.id);
                }
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer whitespace-nowrap flex items-center gap-1.5 transition-colors ${
                tab === k
                  ? 'bg-[#102D40] text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-[#F3F6F8] dark:hover:bg-[#173D53]'
              }`}
            >
              <span>{label}</span>
              {unread > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-[#D3AD68] text-[#102D40] text-[10px] font-bold font-mono-tabular">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-210px)] min-h-[560px]">
        {/* Conversations Sidebar */}
        <div
          className={`lg:col-span-4 rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-3 flex flex-col h-full overflow-hidden ${
            mobileShowThread ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="relative mb-3">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              placeholder={
                tab === 'groups'
                  ? 'ابحث عن ولاية (مثال: الجزائر، وهران...)'
                  : 'بحث في المحادثات...'
              }
              className="w-full pr-9 pl-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e] text-[#172B38] dark:text-slate-100 focus:outline-none focus:border-[#27866F]"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pl-0.5">
            {filteredConvs.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400">
                {tab === 'dm'
                  ? 'لا توجد محادثات خاصة بعد. افتح الدليل الوطني لمراسلة أحد الزملاء.'
                  : 'لا توجد محادثات مطابقة للبحث.'}
              </div>
            ) : (
              filteredConvs.map((c) => {
                const isSelected = selectedConvId === c.id;
                const unread = isSelected ? 0 : c.unreadCount || 0;
                return (
                  <div
                    key={c.id}
                    onClick={() => {
                      setSelectedConvId(c.id);
                      setMobileShowThread(true);
                    }}
                    className={`p-3 rounded-xl border transition-colors flex items-center justify-between gap-2.5 cursor-pointer ${
                      isSelected
                        ? 'bg-[#102D40] text-white border-[#102D40]'
                        : 'bg-[#F3F6F8]/80 dark:bg-[#0b202e] border-transparent hover:border-[#dce4ea] dark:hover:border-[#24526e]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {/* Avatar / Room Icon */}
                      <div className="relative shrink-0">
                        {c.type === 'direct' && c.otherAvatar ? (
                          <img
                            src={c.otherAvatar}
                            alt={c.title}
                            referrerPolicy="no-referrer"
                            className="w-9 h-9 rounded-full object-cover border border-[#dce4ea]/40"
                          />
                        ) : (
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                              isSelected
                                ? 'bg-white/15 text-[#D3AD68]'
                                : c.type === 'official_channel'
                                ? 'bg-[#D3AD68]/15 text-[#D3AD68]'
                                : c.type === 'wilaya_group'
                                ? 'bg-[#27866F]/15 text-[#27866F]'
                                : 'bg-[#102D40]/10 dark:bg-white/10 text-[#102D40] dark:text-[#D3AD68]'
                            }`}
                          >
                            {c.type === 'official_channel' ? (
                              <Megaphone className="w-4 h-4" />
                            ) : c.type === 'wilaya_group' ? (
                              <Users className="w-4 h-4" />
                            ) : c.type === 'national' ? (
                              <Globe className="w-4 h-4" />
                            ) : (
                              <MessageSquare className="w-4 h-4" />
                            )}
                          </div>
                        )}
                        {c.type === 'direct' && c.isOnline && (
                          <span
                            title="متصل الآن"
                            className="w-2.5 h-2.5 rounded-full bg-[#27866F] ring-2 ring-white dark:ring-[#102D40] absolute -bottom-0.5 -left-0.5"
                          />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold truncate">{c.title}</span>
                          {c.lastMessageAt && (
                            <span
                              className={`text-[10px] shrink-0 font-mono-tabular ${
                                isSelected ? 'text-slate-300' : 'text-slate-400'
                              }`}
                            >
                              {formatSidebarTime(c.lastMessageAt)}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p
                            className={`text-[11px] truncate ${
                              isSelected ? 'text-slate-200' : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {c.lastMessagePreview
                              ? `${c.lastMessageSender ? `${c.lastMessageSender}: ` : ''}${c.lastMessagePreview}`
                              : c.type === 'wilaya_group'
                              ? `${c.memberCount || 0} عضو مسجل`
                              : 'انقر لفتح المحادثة'}
                          </p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {(c.onlineCount || 0) > 0 && (
                              <span
                                className={`text-[10px] font-mono-tabular ${
                                  isSelected ? 'text-[#D3AD68]' : 'text-[#27866F]'
                                }`}
                              >
                                {c.onlineCount} متصل
                              </span>
                            )}
                            {unread > 0 && (
                              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#27866F] text-white text-[10px] font-bold flex items-center justify-center font-mono-tabular">
                                {unread > 99 ? '99+' : unread}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {!c.isMember && c.groupId && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleJoinGroup(c.groupId!, c.id);
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-[#27866F] hover:bg-[#1f6d5a] text-white text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        <UserPlus className="w-3 h-3" />
                        <span>انضمام</span>
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Active Chat Thread */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (selectedConv?.isMember) setIsDraggingFile(true);
          }}
          onDragLeave={() => setIsDraggingFile(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingFile(false);
            const f = e.dataTransfer.files?.[0];
            if (f && selectedConv?.isMember) readAttachmentFile(f);
          }}
          className={`lg:col-span-8 rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] flex flex-col h-full overflow-hidden relative ${
            mobileShowThread ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {/* Drag-drop overlay */}
          {isDraggingFile && (
            <div className="absolute inset-0 z-30 bg-[#102D40]/85 backdrop-blur-xs flex flex-col items-center justify-center text-white border-2 border-dashed border-[#D3AD68] rounded-xl pointer-events-none">
              <Paperclip className="w-10 h-10 text-[#D3AD68] mb-2" />
              <div className="text-sm font-bold">أفلت الصورة أو ملف PDF لإرفاقه بالرسالة</div>
            </div>
          )}

          {/* Room Top Bar */}
          <div className="px-4 py-3 border-b border-[#dce4ea] dark:border-[#1e465f] flex items-center justify-between gap-2 bg-white dark:bg-[#102D40]">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => setMobileShowThread(false)}
                className="lg:hidden p-1.5 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-slate-600 dark:text-slate-200 cursor-pointer"
                aria-label="العودة لقائمة المحادثات"
              >
                <ArrowRight className="w-4 h-4" />
              </button>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-[#102D40] dark:text-white truncate">
                    {selectedConv?.title || 'اختر محادثة'}
                  </h2>
                  {roomOnlineCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#27866F] font-medium font-mono-tabular shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#27866F]" />
                      <span>{roomOnlineCount} متصل بالغرفة</span>
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-300 truncate">
                  {selectedConv?.type === 'official_channel'
                    ? 'قناة إعلانات وتوجيهات رسمية من الإدارة'
                    : selectedConv?.type === 'wilaya_group'
                    ? `${selectedConv.memberCount || 0} خريج منتسب لهذه المجموعة الولائية`
                    : selectedConv?.type === 'direct'
                    ? selectedConv.isOnline
                      ? 'متصل الآن · محادثة خاصة'
                      : 'محادثة خاصة'
                    : 'الفضاء الوطني الموحد لجميع خريجي التقنيات الحضرية'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {selectedConv && (
                <button
                  type="button"
                  onClick={() => {
                    setRoomSearchOpen((v) => !v);
                    if (roomSearchOpen && activeRoomQuery) {
                      setRoomSearchInput('');
                      setActiveRoomQuery('');
                      void fetchInitialMessages(selectedConv.id, '');
                    }
                  }}
                  title="البحث داخل المحادثة"
                  className={`p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                    roomSearchOpen
                      ? 'bg-[#102D40] text-white border-[#102D40]'
                      : 'border-[#dce4ea] dark:border-[#24526e] text-slate-600 dark:text-slate-300 hover:bg-[#F3F6F8] dark:hover:bg-[#173D53]'
                  }`}
                >
                  <Search className="w-3.5 h-3.5" />
                </button>
              )}

              {selectedConv?.type === 'wilaya_group' && selectedConv.isMember && selectedConv.groupId && (
                <button
                  type="button"
                  onClick={() => handleLeaveGroup(selectedConv.groupId!)}
                  title="مغادرة المجموعة"
                  className="px-2.5 py-1.5 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-[11px] text-slate-600 dark:text-slate-300 hover:text-red-600 flex items-center gap-1 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">مغادرة</span>
                </button>
              )}

              {selectedConv?.type === 'direct' && selectedConv.otherUserId && (
                <button
                  type="button"
                  onClick={() =>
                    setBlockTargetUser({ id: selectedConv.otherUserId!, name: selectedConv.title })
                  }
                  className="px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-900/50 text-[11px] text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center gap-1 cursor-pointer"
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span>حظر</span>
                </button>
              )}
            </div>
          </div>

          {/* In-room Search Bar */}
          {roomSearchOpen && selectedConvId && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setActiveRoomQuery(roomSearchInput.trim());
                void fetchInitialMessages(selectedConvId, roomSearchInput.trim());
              }}
              className="px-4 py-2 bg-[#F3F6F8] dark:bg-[#0b202e] border-b border-[#dce4ea] dark:border-[#1e465f] flex items-center gap-2"
            >
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="text"
                value={roomSearchInput}
                onChange={(e) => setRoomSearchInput(e.target.value)}
                placeholder="ابحث في رسائل أو مرفقات أو أسماء مرسلي هذه الغرفة..."
                className="flex-1 bg-transparent text-xs focus:outline-none text-[#172B38] dark:text-slate-100"
              />
              <button
                type="submit"
                className="px-2.5 py-1 rounded bg-[#102D40] text-white text-[11px] font-medium cursor-pointer"
              >
                بحث
              </button>
              {(activeRoomQuery || roomSearchInput) && (
                <button
                  type="button"
                  onClick={() => {
                    setRoomSearchInput('');
                    setActiveRoomQuery('');
                    void fetchInitialMessages(selectedConvId, '');
                  }}
                  className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </form>
          )}

          {/* Pinned Messages Banner */}
          {pinnedMessages.length > 0 && !activeRoomQuery && (
            <div className="bg-[#D3AD68]/12 dark:bg-[#D3AD68]/10 border-b border-[#D3AD68]/30 px-4 py-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => scrollToMessage(pinnedMessages[0].id)}
                  className="flex items-center gap-2 min-w-0 text-right flex-1 cursor-pointer"
                >
                  <Pin className="w-3.5 h-3.5 text-[#D3AD68] shrink-0" />
                  <div className="min-w-0">
                    <span className="text-[11px] font-bold text-[#102D40] dark:text-[#D3AD68] ml-1.5">
                      رسالة مثبتة ({pinnedMessages[0].senderName}):
                    </span>
                    <span className="text-xs text-[#172B38] dark:text-slate-200 truncate">
                      {pinnedMessages[0].content}
                    </span>
                  </div>
                </button>

                <div className="flex items-center gap-1.5 shrink-0">
                  {pinnedMessages.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setShowPinnedExpanded((v) => !v)}
                      className="text-[11px] text-[#102D40] dark:text-[#D3AD68] font-medium underline cursor-pointer"
                    >
                      {showPinnedExpanded ? 'إخفاء' : `+${pinnedMessages.length - 1} مثبتة`}
                    </button>
                  )}
                  {(canModerate || isAdmin) && (
                    <button
                      type="button"
                      onClick={() => void handleTogglePin(pinnedMessages[0])}
                      title="إلغاء التثبيت"
                      className="p-1 text-slate-500 hover:text-red-600 cursor-pointer"
                    >
                      <PinOff className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {showPinnedExpanded && pinnedMessages.length > 1 && (
                <div className="mt-2 pt-2 border-t border-[#D3AD68]/25 space-y-1.5">
                  {pinnedMessages.slice(1).map((pm) => (
                    <div key={pm.id} className="flex items-center justify-between gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => scrollToMessage(pm.id)}
                        className="truncate text-right hover:underline cursor-pointer"
                      >
                        <strong className="ml-1">{pm.senderName}:</strong>
                        {pm.content}
                      </button>
                      {(canModerate || isAdmin) && (
                        <button
                          type="button"
                          onClick={() => void handleTogglePin(pm)}
                          className="text-[10px] text-slate-500 hover:text-red-600 shrink-0 cursor-pointer"
                        >
                          إلغاء
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Messages Feed */}
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-4 space-y-1.5 bg-[#F3F6F8]/70 dark:bg-[#0b202e]/65 relative"
          >
            {hasMore && !activeRoomQuery && (
              <div className="flex justify-center pb-2">
                <button
                  type="button"
                  onClick={handleLoadOlder}
                  disabled={loadingOlder}
                  className="px-3.5 py-1.5 rounded-full bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#24526e] text-xs font-medium text-[#102D40] dark:text-slate-200 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {loadingOlder ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ChevronUp className="w-3.5 h-3.5" />
                  )}
                  <span>تحميل رسائل أقدم</span>
                </button>
              </div>
            )}

            {activeRoomQuery && (
              <div className="text-center text-xs text-slate-500 pb-2">
                نتائج البحث عن: <strong className="text-[#102D40] dark:text-white">{activeRoomQuery}</strong> ({messages.length})
              </div>
            )}

            {loadingMessages ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-[#27866F]" />
                <span>جاري تحميل المحادثة...</span>
              </div>
            ) : messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
                <MessageSquare className="w-8 h-8 opacity-30" />
                <span>
                  {activeRoomQuery
                    ? 'لم يتم العثور على رسائل مطابقة لبحثك.'
                    : 'لا توجد رسائل بعد. ابدأ النقاش المهني الآن.'}
                </span>
              </div>
            ) : (
              messages.map((m, idx) => {
                const isMine = m.senderId === user?.id;
                const prev = idx > 0 ? messages[idx - 1] : null;
                const showDateSep =
                  !prev ||
                  new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();

                const isGroupedWithPrev =
                  Boolean(prev) &&
                  !showDateSep &&
                  prev!.senderId === m.senderId &&
                  !prev!.isOfficial &&
                  !m.isOfficial &&
                  new Date(m.createdAt).getTime() - new Date(prev!.createdAt).getTime() < 3 * 60 * 1000;

                const isHighlighted = highlightedMsgId === m.id;
                const roleLabel = ROLE_LABELS[m.senderRole];

                return (
                  <React.Fragment key={m.clientTempId || m.id}>
                    {showDateSep && (
                      <div className="flex items-center justify-center my-3">
                        <span className="px-3 py-1 rounded-full bg-white/90 dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] text-[11px] font-medium text-slate-500 dark:text-slate-300">
                          {formatDateSeparator(m.createdAt)}
                        </span>
                      </div>
                    )}

                    <div
                      ref={(el) => {
                        if (el && m.id > 0) msgRefs.current.set(m.id, el);
                      }}
                      className={`group flex flex-col ${isMine ? 'items-start' : 'items-end'} ${
                        isGroupedWithPrev ? 'mt-0.5' : 'mt-3'
                      }`}
                    >
                      <div
                        className={`relative max-w-[85%] sm:max-w-[75%] rounded-2xl px-3.5 py-2.5 border transition-all ${
                          m.isOfficial
                            ? 'bg-[#102D40] text-white border-[#D3AD68]'
                            : isMine
                            ? 'bg-[#173D53] text-white border-[#173D53]'
                            : 'bg-white dark:bg-[#102D40] text-[#172B38] dark:text-slate-100 border-[#dce4ea] dark:border-[#1e465f]'
                        } ${isHighlighted ? 'ring-2 ring-[#D3AD68] scale-[1.01]' : ''} ${
                          m.pending ? 'opacity-75' : ''
                        }`}
                      >
                        {/* Sender header (hidden when grouped) */}
                        {!isGroupedWithPrev && (
                          <div className="flex items-center justify-between gap-4 mb-1 text-[11px]">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {m.senderAvatar && !isMine && (
                                <img
                                  src={m.senderAvatar}
                                  alt={m.senderName}
                                  referrerPolicy="no-referrer"
                                  className="w-4 h-4 rounded-full object-cover"
                                />
                              )}
                              <span
                                className={`font-bold ${
                                  m.isOfficial
                                    ? 'text-[#D3AD68]'
                                    : isMine
                                    ? 'text-[#D3AD68]'
                                    : 'text-[#102D40] dark:text-[#D3AD68]'
                                }`}
                              >
                                {m.isOfficial && (
                                  <ShieldAlert className="w-3 h-3 inline ml-1 text-[#D3AD68]" />
                                )}
                                {m.senderName}
                              </span>
                              {roleLabel && (
                                <span
                                  className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                    isMine || m.isOfficial
                                      ? 'bg-white/15 text-[#D3AD68]'
                                      : 'bg-[#102D40]/10 dark:bg-white/10 text-[#102D40] dark:text-[#D3AD68]'
                                  }`}
                                >
                                  {roleLabel}
                                </span>
                              )}
                              {m.isPinned && (
                                <span title="رسالة مثبتة">
                                  <Pin className="w-3 h-3 text-[#D3AD68]" />
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Quote Reply Block */}
                        {m.replyTo && (
                          <button
                            type="button"
                            onClick={() => scrollToMessage(m.replyTo!.id)}
                            className={`w-full text-right mb-2 px-2.5 py-1.5 rounded-lg border-r-2 text-[11px] block cursor-pointer ${
                              isMine || m.isOfficial
                                ? 'bg-black/20 border-[#D3AD68] text-slate-200'
                                : 'bg-[#F3F6F8] dark:bg-[#0b202e] border-[#27866F] text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            <div className="font-bold text-[10px] mb-0.5">{m.replyTo.senderName}</div>
                            <div className="truncate opacity-85">
                              {m.replyTo.content || m.replyTo.attachmentName || 'مرفق'}
                            </div>
                          </button>
                        )}

                        {/* Message Body */}
                        <p className="text-sm whitespace-pre-wrap leading-relaxed break-words">
                          {m.content}
                        </p>

                        {/* Attachment */}
                        {m.attachmentUrl && (
                          <div className="mt-2 pt-2 border-t border-white/15 dark:border-white/10">
                            {m.attachmentType?.startsWith('image/') ? (
                              <button
                                type="button"
                                onClick={() => setLightboxUrl(m.attachmentUrl)}
                                className="block cursor-zoom-in"
                              >
                                <img
                                  src={m.attachmentUrl}
                                  alt={m.attachmentName}
                                  referrerPolicy="no-referrer"
                                  className="max-h-56 rounded-lg border border-white/20 object-cover"
                                />
                              </button>
                            ) : (
                              <a
                                href={m.attachmentUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs underline flex items-center gap-1.5"
                              >
                                <Paperclip className="w-3.5 h-3.5" />
                                <span>{m.attachmentName || 'ملف مرفق'}</span>
                              </a>
                            )}
                          </div>
                        )}

                        {/* Footer: Time, Edited marker, Read receipt & Actions */}
                        <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] opacity-75">
                          <div className="flex items-center gap-1.5 font-mono-tabular">
                            <span>
                              {new Date(m.createdAt).toLocaleTimeString('ar-DZ', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            {m.editedAt && <span>(معدّلة)</span>}
                            {isMine && selectedConv?.type === 'direct' && (
                              <span>
                                {m.pending ? (
                                  <Loader2 className="w-3 h-3 animate-spin inline" />
                                ) : m.id > 0 && otherLastReadMessageId >= m.id ? (
                                  <CheckCheck className="w-3.5 h-3.5 text-[#D3AD68] inline" />
                                ) : (
                                  <Check className="w-3.5 h-3.5 inline opacity-75" />
                                )}
                              </span>
                            )}
                          </div>

                          {/* Action Toolbar */}
                          {m.id > 0 && (
                            <div className="flex items-center gap-1.5 opacity-85 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                title="تفاعل"
                                onClick={() =>
                                  setOpenEmojiForId((curr) => (curr === m.id ? null : m.id))
                                }
                                className="hover:opacity-100 p-0.5 cursor-pointer"
                              >
                                <SmilePlus className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title="رد"
                                onClick={() => {
                                  setEditingTarget(null);
                                  setReplyTarget(m);
                                  inputRef.current?.focus();
                                }}
                                className="hover:opacity-100 p-0.5 cursor-pointer"
                              >
                                <Reply className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title="نسخ"
                                onClick={() => void handleCopyMessage(m)}
                                className="hover:opacity-100 p-0.5 cursor-pointer"
                              >
                                {copiedMsgId === m.id ? (
                                  <Check className="w-3.5 h-3.5 text-[#27866F]" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                              {canEditMsg(m) && (
                                <button
                                  type="button"
                                  title="تعديل"
                                  onClick={() => {
                                    setReplyTarget(null);
                                    setEditingTarget(m);
                                    setText(m.content);
                                    inputRef.current?.focus();
                                  }}
                                  className="hover:opacity-100 p-0.5 cursor-pointer"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {(canModerate || isAdmin) && (
                                <button
                                  type="button"
                                  title={m.isPinned ? 'إلغاء التثبيت' : 'تثبيت الرسالة'}
                                  onClick={() => void handleTogglePin(m)}
                                  className="hover:opacity-100 p-0.5 cursor-pointer"
                                >
                                  {m.isPinned ? (
                                    <PinOff className="w-3.5 h-3.5" />
                                  ) : (
                                    <Pin className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}
                              {!isMine && (
                                <button
                                  type="button"
                                  title="إبلاغ"
                                  onClick={() => {
                                    setReportTargetMsgId(m.id);
                                    setReportReason('');
                                  }}
                                  className="hover:opacity-100 p-0.5 cursor-pointer"
                                >
                                  <Flag className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {(isMine || canModerate) && (
                                <button
                                  type="button"
                                  title="حذف"
                                  onClick={() => void handleDeleteMessage(m.id)}
                                  className="hover:opacity-100 p-0.5 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Emoji Quick Popover */}
                        {openEmojiForId === m.id && (
                          <div className="mt-2 p-1 rounded-full bg-white dark:bg-[#0b202e] border border-[#dce4ea] dark:border-[#24526e] shadow-md inline-flex items-center gap-1">
                            {QUICK_EMOJIS.map((em) => (
                              <button
                                key={em}
                                type="button"
                                onClick={() => void handleToggleReaction(m.id, em)}
                                className="w-7 h-7 rounded-full hover:bg-[#F3F6F8] dark:hover:bg-[#173D53] flex items-center justify-center text-sm cursor-pointer transition-transform hover:scale-110"
                              >
                                {em}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Reactions Row */}
                      {m.reactions && m.reactions.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 mt-1 px-1">
                          {m.reactions.map((r) => (
                            <button
                              key={r.emoji}
                              type="button"
                              onClick={() => void handleToggleReaction(m.id, r.emoji)}
                              className={`px-2 py-0.5 rounded-full text-[11px] font-medium border flex items-center gap-1 cursor-pointer transition-colors ${
                                r.reactedByMe
                                  ? 'bg-[#27866F]/15 border-[#27866F] text-[#102D40] dark:text-white'
                                  : 'bg-white dark:bg-[#102D40] border-[#dce4ea] dark:border-[#1e465f] text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              <span>{r.emoji}</span>
                              <span className="font-mono-tabular text-[10px]">{r.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </React.Fragment>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {/* Floating Jump-to-Latest Button */}
          {newBelowCount > 0 && (
            <button
              type="button"
              onClick={() => scrollToBottom('smooth')}
              className="absolute bottom-24 left-6 z-20 px-3 py-1.5 rounded-full bg-[#102D40] text-white border border-[#D3AD68] shadow-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowDown className="w-3.5 h-3.5 text-[#D3AD68]" />
              <span>{newBelowCount} رسالة جديدة</span>
            </button>
          )}

          {/* Typing Indicator */}
          {activeTypingList.length > 0 && (
            <div className="px-4 py-1 text-[11px] text-[#27866F] dark:text-[#D3AD68] bg-white dark:bg-[#102D40] border-t border-[#dce4ea]/60 dark:border-[#1e465f]/60 flex items-center gap-1.5">
              <span className="inline-flex gap-0.5">
                <span className="w-1 h-1 rounded-full bg-current animate-bounce" />
                <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
                <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
              </span>
              <span>
                {activeTypingList.length === 1
                  ? `${activeTypingList[0]} يكتب الآن...`
                  : `${activeTypingList.slice(0, 2).join(' و ')} يكتبون الآن...`}
              </span>
            </div>
          )}

          {/* Toast & Error Alerts */}
          {toastMsg && (
            <div className="px-4 py-2 bg-[#27866F]/10 text-xs text-[#27866F] dark:text-emerald-300 border-t border-[#27866F]/25">
              {toastMsg}
            </div>
          )}
          {errorMsg && (
            <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/50 text-xs text-amber-800 dark:text-amber-200 border-t border-amber-200 flex items-center justify-between gap-2">
              <span>{errorMsg}</span>
              <button type="button" onClick={() => setErrorMsg('')} className="cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Composer Area */}
          {selectedConv?.type === 'wilaya_group' && !selectedConv.isMember && selectedConv.groupId ? (
            <div className="p-3.5 bg-[#F3F6F8] dark:bg-[#0b202e] border-t border-[#dce4ea] dark:border-[#1e465f] flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-slate-600 dark:text-slate-300">
                أنت تتصفح هذه المجموعة الولائية كزائر. انضم للمجموعة للمشاركة في النقاشات واستلام الإشعارات.
              </span>
              <button
                type="button"
                onClick={() => void handleJoinGroup(selectedConv.groupId!, selectedConv.id)}
                className="px-4 py-2 rounded-lg bg-[#27866F] hover:bg-[#1f6d5a] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>انضمام الآن</span>
              </button>
            </div>
          ) : selectedConv?.type === 'official_channel' && !isAdmin ? (
            <div className="p-3.5 text-center text-xs text-slate-500 border-t border-[#dce4ea] dark:border-[#1e465f]">
              هذه القناة مخصصة لإعلانات وتوجيهات الإدارة فقط.
            </div>
          ) : (
            <div className="border-t border-[#dce4ea] dark:border-[#1e465f] bg-white dark:bg-[#102D40]">
              {/* Reply or Edit Preview Bar */}
              {(replyTarget || editingTarget) && (
                <div className="px-4 py-2 bg-[#F3F6F8] dark:bg-[#0b202e] border-b border-[#dce4ea] dark:border-[#1e465f] flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0 border-r-2 border-[#D3AD68] pr-2.5">
                    <div className="font-bold text-[#102D40] dark:text-[#D3AD68]">
                      {editingTarget
                        ? 'تعديل الرسالة'
                        : `الرد على ${replyTarget?.senderName}`}
                    </div>
                    <div className="text-slate-500 dark:text-slate-300 truncate">
                      {(editingTarget || replyTarget)?.content}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setReplyTarget(null);
                      if (editingTarget) {
                        setEditingTarget(null);
                        setText('');
                      }
                    }}
                    className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Pending Attachment Chip */}
              {attachment && (
                <div className="px-4 pt-2 flex items-center gap-2">
                  <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#F3F6F8] dark:bg-[#0b202e] border border-[#dce4ea] dark:border-[#24526e] text-xs">
                    {attachment.type.startsWith('image/') && (
                      <img
                        src={attachment.dataUrl}
                        alt={attachment.name}
                        className="w-6 h-6 rounded object-cover"
                      />
                    )}
                    <span className="truncate max-w-[200px]">{attachment.name}</span>
                    <button
                      type="button"
                      onClick={() => setAttachment(null)}
                      className="text-slate-400 hover:text-red-500 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmitMessage} className="p-3 flex items-end gap-2">
                {!editingTarget && (
                  <label
                    title="إرفاق صورة أو PDF"
                    className="p-2.5 rounded-lg border border-[#dce4ea] dark:border-[#24526e] hover:bg-[#F3F6F8] dark:hover:bg-[#173D53] cursor-pointer text-slate-600 dark:text-slate-300 shrink-0"
                  >
                    <Paperclip className="w-4 h-4" />
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={handleAttachmentInput}
                      className="hidden"
                    />
                  </label>
                )}

                <textarea
                  ref={inputRef}
                  rows={1}
                  value={text}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSubmitMessage();
                    }
                  }}
                  onChange={(e) => {
                    const val = e.target.value;
                    setText(val);
                    if (selectedConvId && !editingTarget) {
                      saveDraft(`chat_draft_${selectedConvId}`, val);
                      if (val.trim()) emitTyping(selectedConvId);
                    }
                  }}
                  placeholder={
                    editingTarget
                      ? 'عدّل نص الرسالة...'
                      : attachment
                      ? `تعليق على ${attachment.name}...`
                      : 'اكتب رسالتك... (Enter للإرسال، Shift+Enter لسطر جديد، أو الصق صورة)'
                  }
                  className="flex-1 px-3.5 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e] resize-none max-h-28 focus:outline-none focus:border-[#27866F]"
                />

                <button
                  type="submit"
                  disabled={sending || (!text.trim() && !attachment)}
                  className="px-4 py-2.5 rounded-lg bg-[#27866F] hover:bg-[#1f6d5a] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {sending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>{editingTarget ? 'حفظ' : 'إرسال'}</span>
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Inline Report Modal */}
      {reportTargetMsgId !== null && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitReport}
            className="w-full max-w-md rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#102D40] dark:text-white flex items-center gap-2">
                <Flag className="w-4 h-4 text-red-600" />
                <span>الإبلاغ عن رسالة</span>
              </h3>
              <button
                type="button"
                onClick={() => setReportTargetMsgId(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              rows={3}
              required
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="اذكر سبب الإبلاغ ليتم مراجعته من طرف الإدارة..."
              className="w-full p-3 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReportTargetMsgId(null)}
                className="px-3.5 py-1.5 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer"
              >
                إرسال البلاغ
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Inline Block Confirmation Modal */}
      {blockTargetUser && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-[#102D40] dark:text-white">
              تأكيد حظر العضو
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              هل تريد حظر <strong>{blockTargetUser.name}</strong> ومنعه من إرسال رسائل خاصة لك مستقبلاً؟
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBlockTargetUser(null)}
                className="px-3.5 py-1.5 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmBlockUser()}
                className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer"
              >
                تأكيد الحظر
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Image Viewer */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-zoom-out"
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 left-4 p-2 rounded-full bg-white/15 text-white hover:bg-white/25 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={lightboxUrl}
            alt="معاينة المرفق"
            referrerPolicy="no-referrer"
            className="max-w-full max-h-[88vh] rounded-xl object-contain"
          />
        </div>
      )}
    </div>
  );
};
