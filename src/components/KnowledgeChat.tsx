import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { Send, Bot, User, Loader2, BookOpen, Search, Square, Plus, RefreshCcw, MessageSquareText, Pencil, Trash2 } from 'lucide-react';
import { chatApi, ingestionApi } from '../api';

interface SourceDoc {
  id?: number;
  source_id?: string;
  filename: string;
  header_path?: string;
  content: string;
  score: number;
  module: string;
  doc_type?: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceDoc[];
}

interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
}

interface RecommendedQuestionItem {
  label: string;
  question: string;
}

const createSession = (): ChatSession => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  title: '新对话',
  updatedAt: Date.now(),
  messages: []
});

const CHAT_SESSIONS_KEY = 'rag-review.chat.sessions.v1';
const CHAT_ACTIVE_KEY = 'rag-review.chat.active.v1';
const RECOMMENDED_QUESTIONS: RecommendedQuestionItem[] = [
  { label: '需求完整性检查', question: '请帮我检查当前模块 PRD 是否有缺失的关键需求点，并给出补充建议。' },
  { label: 'SOP 对齐校验', question: '请对照该模块 SOP，指出 PRD 中与 SOP 不一致或冲突的地方。' },
  { label: '流程梳理', question: '请按步骤梳理该模块核心业务流程，并标注每步对应的文档依据。' },
  { label: '风险点识别', question: '请列出当前需求中可能导致上线风险的点，并说明影响范围。' },
  { label: '验收标准生成', question: '请基于现有文档生成一份可执行的验收标准清单。' },
  { label: '改动影响分析', question: '如果新增一个审批节点，会影响哪些已有功能和流程？请给出依据。' }
];

const deriveTitle = (messages: Message[]) => {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return '新对话';
  return (firstUser.content || '新对话').slice(0, 24);
};

const shouldShowSources = (msg: Message) => {
  const text = (msg.content || '').trim();
  if (!msg.sources || msg.sources.length === 0) return false;
  if (!text) return false;
  // If explicit citations exist in answer content, always show the source list.
  if (extractCitationIds(text).size > 0) return true;
  const noEvidenceSignals = [
    '未检索到直接依据',
    '知识库中未提供相关依据',
    '根据现有知识库内容，我无法回答这个问题',
    '无法回答这个问题'
  ];
  return !noEvidenceSignals.some((s) => text.includes(s));
};

const CITATION_REGEX = /\[(S\d+)\]/gi;

const normalizeSourceId = (src: SourceDoc, index: number) => {
  const raw = String(src.source_id || '').trim();
  if (!raw) return `S${index + 1}`;
  const upper = raw.toUpperCase().replace(/[\[\]\s]/g, '');
  if (/^S\d+$/.test(upper)) return upper;
  if (/^\d+$/.test(upper)) return `S${upper}`;
  const matched = upper.match(/S?(\d+)/);
  if (matched?.[1]) return `S${matched[1]}`;
  return `S${index + 1}`;
};

const extractCitationIds = (text: string) => {
  const ids = new Set<string>();
  if (!text) return ids;
  CITATION_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITATION_REGEX.exec(text)) !== null) {
    if (match[1]) ids.add(match[1].toUpperCase());
  }
  return ids;
};

const dedupeSources = (sources: SourceDoc[]) =>
  sources.reduce((acc, src) => {
    const key = `${(src.source_id || '').toUpperCase()}|${src.filename}|${src.header_path || ''}`;
    const existing = acc.find((s) => `${(s.source_id || '').toUpperCase()}|${s.filename}|${s.header_path || ''}` === key);
    if (!existing || src.score > existing.score) {
      return [
        ...acc.filter((s) => `${(s.source_id || '').toUpperCase()}|${s.filename}|${s.header_path || ''}` !== key),
        src
      ];
    }
    return acc;
  }, [] as SourceDoc[]);

const SessionItem = React.memo(function SessionItem({
  session,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  session: ChatSession;
  active: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(session.id)}
      className={`group w-full text-left rounded-lg border p-3 transition-colors ${
        active ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'
      }`}
    >
      <div className="flex items-center gap-2">
        <MessageSquareText className="w-4 h-4 text-slate-500 shrink-0" />
        <span className="text-sm text-slate-700 truncate flex-1">{session.title}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <span
            onClick={(e) => {
              e.stopPropagation();
              onRename(session.id);
            }}
            className="p-1 rounded hover:bg-white"
            title="重命名"
          >
            <Pencil className="w-3.5 h-3.5 text-slate-500" />
          </span>
          <span
            onClick={(e) => {
              e.stopPropagation();
              onDelete(session.id);
            }}
            className="p-1 rounded hover:bg-white"
            title="删除"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-500" />
          </span>
        </div>
      </div>
      <div className="mt-1 text-[11px] text-slate-400">{new Date(session.updatedAt).toLocaleString()}</div>
    </button>
  );
});

const ChatMessageItem = React.memo(function ChatMessageItem({ msg }: { msg: Message }) {
  const uniqueSources = useMemo(
    () => (msg.sources && msg.sources.length > 0 ? dedupeSources(msg.sources) : []),
    [msg.sources]
  );
  const sourceMap = useMemo(() => {
    const map = new Map<string, SourceDoc>();
    uniqueSources.forEach((src, idx) => {
      map.set(normalizeSourceId(src, idx), src);
    });
    return map;
  }, [uniqueSources]);
  const citedIds = useMemo(() => extractCitationIds(msg.content || ''), [msg.content]);
  const displayedSources = useMemo(() => {
    const withSid = uniqueSources.map((src, sIdx) => ({ src, sid: normalizeSourceId(src, sIdx) }));
    if (citedIds.size === 0) return withSid;
    const citedOnly = withSid.filter((item) => citedIds.has(item.sid));
    return citedOnly.length > 0 ? citedOnly : withSid;
  }, [uniqueSources, citedIds]);

  return (
    <div className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
        msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-emerald-500 text-white'
      }`}>
        {msg.role === 'user' ? <User className="w-6 h-6" /> : <Bot className="w-6 h-6" />}
      </div>

      <div className={`max-w-[80%] flex flex-col gap-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
        <div className={`px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed ${
          msg.role === 'user'
            ? 'bg-indigo-600 text-white rounded-tr-sm'
            : 'bg-white text-slate-800 border border-slate-200 rounded-tl-sm shadow-sm whitespace-pre-wrap'
        }`}>
          {msg.content}
        </div>

        {shouldShowSources(msg) && displayedSources.length > 0 && (
          <div className="mt-2 w-full">
            <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
              <Search className="w-3 h-3" />
              参考来源 ({displayedSources.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {displayedSources.map(({ src, sid }, sIdx) => {
                const cited = citedIds.has(sid);
                return (
                <div
                  key={`${src.filename}-${sIdx}-${sid}`}
                  className={`group relative flex items-center gap-1.5 px-3 py-1.5 bg-white border rounded-lg text-xs cursor-pointer transition-colors shadow-sm ${
                    cited
                      ? 'border-indigo-400 text-indigo-700'
                      : 'border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-700'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5 text-indigo-500" />
                  <span className="text-indigo-500">{sid}</span>
                  <span className="font-medium max-w-[150px] truncate">{src.filename}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-400">{src.doc_type?.toUpperCase() || 'PRD'}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-400">{(src.score * 100).toFixed(0)}%</span>

                  <div className="absolute bottom-full left-0 mb-2 w-80 p-4 bg-slate-800 text-slate-200 text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 shadow-xl">
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-700">
                      <p className="font-semibold text-white">{src.filename}</p>
                      <span className="text-indigo-400 text-[10px]">匹配度: {(src.score * 100).toFixed(1)}%</span>
                    </div>
                    <p className="text-slate-400 mb-2">章节：{src.header_path || '未分段'}</p>
                    <p className="text-slate-300 leading-relaxed line-clamp-8">{src.content}</p>
                    <div className="absolute -bottom-1 left-4 w-2 h-2 bg-slate-800 transform rotate-45"></div>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default function KnowledgeChat() {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [modules, setModules] = useState<string[]>(['全部']);
  const [selectedModule, setSelectedModule] = useState('全部');
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const raw = localStorage.getItem(CHAT_SESSIONS_KEY);
      if (!raw) return [createSession()];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return [createSession()];
      return parsed;
    } catch {
      return [createSession()];
    }
  });
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    try {
      return localStorage.getItem(CHAT_ACTIVE_KEY) || '';
    } catch {
      return '';
    }
  });
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const persistTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, sessions]);

  useEffect(() => {
    if (persistTimerRef.current) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(sessions));
        localStorage.setItem(CHAT_ACTIVE_KEY, activeSessionId || '');
      } catch {}
    }, 300);
    return () => {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
      }
    };
  }, [sessions, activeSessionId]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || sessions[0],
    [sessions, activeSessionId]
  );
  const activeMessages = activeSession?.messages || [];

  const updateSessionMessages = (sessionId: string, messages: Message[]) => {
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              messages,
              updatedAt: Date.now(),
              title: deriveTitle(messages)
            }
          : s
      );
      return [...next].sort((a, b) => b.updatedAt - a.updatedAt);
    });
  };

  const startNewSession = () => {
    const next = createSession();
    setSessions((prev) => [next, ...prev]);
    setActiveSessionId(next.id);
    setInput('');
  };

  const handleRenameSession = useCallback((sessionId: string) => {
    const target = sessions.find((s) => s.id === sessionId);
    if (!target) return;
    const next = window.prompt('请输入新的会话名称', target.title);
    if (!next) return;
    const title = next.trim();
    if (!title) return;
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title } : s)));
  }, [sessions]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    const ok = window.confirm('确认删除该会话吗？');
    if (!ok) return;
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      if (next.length === 0) {
        const fresh = createSession();
        setActiveSessionId(fresh.id);
        return [fresh];
      }
      if (sessionId === activeSessionId) {
        setActiveSessionId(next[0].id);
      }
      return next;
    });
  }, [activeSessionId]);

  const handleClearAllSessions = () => {
    const ok = window.confirm('确认清空全部会话历史吗？');
    if (!ok) return;
    const fresh = createSession();
    setSessions([fresh]);
    setActiveSessionId(fresh.id);
    setInput('');
  };

  // Load modules on mount
  useEffect(() => {
    ingestionApi.getModules()
      .then(res => {
        if (res.data && res.data.modules) {
          setModules(['全部', ...res.data.modules]);
        }
      })
      .catch(err => console.error('Failed to load modules:', err));
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages]);

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  };

  /**
   * Send a user question to chat API and append assistant response into active session.
   * @param overrideMessage Optional message text used for quick-question click send.
   * @returns Promise<void> completes after request lifecycle and state sync.
   */
  const handleSend = async (overrideMessage?: string) => {
    const resolvedMessage = (overrideMessage ?? input).trim();
    if (!resolvedMessage || isLoading || !activeSession) return;

    if (!overrideMessage) {
      setInput('');
    }
    const previousMessages = activeMessages;
    const newMessages: Message[] = [...previousMessages, { role: 'user', content: resolvedMessage }];
    updateSessionMessages(activeSession.id, newMessages);
    setIsLoading(true);

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      // Prepare history for API (exclude sources in the last message for API call)
      const apiHistory = previousMessages.map(m => ({
        role: m.role,
        content: m.content
      }));

      const response = await chatApi.ask(
        {
          query: resolvedMessage,
          module: selectedModule,
          history: apiHistory
        },
        abortControllerRef.current.signal
      );

      if (response.data) {
        updateSessionMessages(activeSession.id, [
          ...newMessages,
          {
            role: 'assistant',
            content: response.data.answer,
            sources: response.data.sources
          }
        ]);
      }
    } catch (error: any) {
      if (axios.isCancel(error)) {
        updateSessionMessages(activeSession.id, previousMessages);
      } else {
        console.error('Chat error:', error);
        updateSessionMessages(activeSession.id, [
          ...newMessages,
          {
            role: 'assistant',
            content: '抱歉，系统暂时出现问题，无法回答您的提问。请稍后再试。'
          }
        ]);
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleRegenerate = async () => {
    if (isLoading || !activeSession) return;
    const messages = activeMessages;
    if (messages.length < 2) return;
    const last = messages[messages.length - 1];
    const prev = messages[messages.length - 2];
    if (last.role !== 'assistant' || prev.role !== 'user') return;

    const baseMessages = messages.slice(0, -1); // remove last assistant answer
    const query = prev.content;
    const apiHistory = baseMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
    updateSessionMessages(activeSession.id, baseMessages);
    setIsLoading(true);
    abortControllerRef.current = new AbortController();

    try {
      const response = await chatApi.ask(
        {
          query,
          module: selectedModule,
          history: apiHistory
        },
        abortControllerRef.current.signal
      );
      updateSessionMessages(activeSession.id, [
        ...baseMessages,
        {
          role: 'assistant',
          content: response.data?.answer || '抱歉，系统暂时出现问题，无法回答您的提问。请稍后再试。',
          sources: response.data?.sources
        }
      ]);
    } catch (error) {
      console.error(error);
      updateSessionMessages(activeSession.id, [
        ...baseMessages,
        { role: 'assistant', content: '抱歉，系统暂时出现问题，无法回答您的提问。请稍后再试。' }
      ]);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const isEmptySession = activeMessages.length === 0;

  return (
    <div className="flex-1 h-full bg-slate-50 overflow-hidden">
      <div className="h-full flex">
        <aside className="w-72 border-r border-slate-200 bg-white p-4 flex flex-col gap-3">
          <button
            onClick={startNewSession}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            新建对话
          </button>
          <div className="flex items-center justify-between px-1">
            <div className="text-xs text-slate-500">对话历史</div>
            <button
              onClick={handleClearAllSessions}
              className="text-xs text-slate-500 hover:text-red-600 transition-colors"
            >
              清空全部
            </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {sessions.map((s) => (
              <SessionItem
                key={s.id}
                session={s}
                active={s.id === activeSession?.id}
                onSelect={setActiveSessionId}
                onRename={handleRenameSession}
                onDelete={handleDeleteSession}
              />
            ))}
          </div>
        </aside>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center justify-between shrink-0">
            <div>
              <h1 className="text-xl font-bold text-slate-800">智能问答</h1>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-slate-600">知识范围:</label>
              <select
                value={selectedModule}
                onChange={(e) => setSelectedModule(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white text-slate-700"
              >
                {modules.map(mod => (
                  <option key={mod} value={mod}>{mod}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <div className={`max-w-4xl mx-auto ${isEmptySession ? 'h-full flex flex-col justify-center' : 'space-y-6'}`}>
              {!isEmptySession && activeMessages.map((msg, idx) => (
                <ChatMessageItem key={idx} msg={msg} />
              ))}
              {!isLoading && isEmptySession && (
                <div className="w-full flex flex-col items-center">
                  <h2 className="text-4xl font-bold text-slate-900 tracking-tight">你好，我是智能问答助手</h2>
                  <p className="mt-3 text-sm text-slate-500">试试下面这些问题，或直接输入你的需求</p>
                  <div className="mt-8 flex flex-wrap justify-center gap-3 max-w-3xl">
                    {RECOMMENDED_QUESTIONS.map((item) => (
                      <button
                        key={item.label}
                        onClick={() => {
                          void handleSend(item.question);
                        }}
                        className="px-4 py-2 rounded-full border border-slate-200 bg-white text-slate-700 text-sm hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50 transition-colors shadow-sm"
                        title={item.question}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {isLoading && (
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                    <Bot className="w-6 h-6" />
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm shadow-sm px-5 py-4 flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
                    <span className="text-sm text-slate-500 font-medium">正在检索知识库并生成回答...</span>
                    <button
                      onClick={handleStop}
                      className="ml-2 p-1.5 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
                      title="停止生成"
                    >
                      <Square className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
              {!isLoading && activeMessages.length > 0 && activeMessages[activeMessages.length - 1]?.role === 'assistant' && (
                <button
                  onClick={handleRegenerate}
                  className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                >
                  <RefreshCcw className="w-4 h-4" />
                  重新生成
                </button>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="p-4 bg-white border-t border-slate-200 shrink-0">
            <div className="max-w-4xl mx-auto relative flex items-end gap-3">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入您想了解的问题，支持 Shift+Enter 换行..."
                className="flex-1 max-h-32 min-h-[52px] resize-none border border-slate-300 rounded-xl pl-4 pr-12 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-slate-50 text-slate-700 text-[15px] leading-relaxed"
                rows={1}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="absolute right-2 bottom-1.5 p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
            <p className="text-center text-xs text-slate-400 mt-2">
              AI 生成的内容可能不完全准确，请结合引用的参考来源进行判断。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
