import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { Send, Bot, User, Loader2, BookOpen, Search, Square } from 'lucide-react';
import { chatApi, ingestionApi } from '../api';

interface SourceDoc {
  id?: number;
  filename: string;
  content: string;
  score: number;
  module: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceDoc[];
}

interface KnowledgeChatProps {
  history: Message[];
  setHistory: React.Dispatch<React.SetStateAction<Message[]>>;
}

export default function KnowledgeChat({ history, setHistory }: KnowledgeChatProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [modules, setModules] = useState<string[]>(['全部']);
  const [selectedModule, setSelectedModule] = useState('全部');
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
  }, [history]);

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg = input.trim();
    setInput('');

    // Add user message to history (managed by parent)
    const newMessages: Message[] = [
      ...history,
      { role: 'user', content: userMsg }
    ];
    setHistory(newMessages);
    setIsLoading(true);

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      // Prepare history for API (exclude sources in the last message for API call)
      const apiHistory = history.map(m => ({
        role: m.role,
        content: m.content
      }));

      const response = await chatApi.ask(
        {
          query: userMsg,
          module: selectedModule,
          history: apiHistory
        },
        abortControllerRef.current.signal
      );

      if (response.data) {
        setHistory([
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
        console.log('Request was cancelled');
        // Don't add an error message for cancelled requests
        // Just remove the user message that was added
        setHistory(history); // Revert to previous state
      } else {
        console.error('Chat error:', error);
        setHistory([
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  // Initial greeting if no history
  const displayMessages = history.length === 0
    ? [{
        role: 'assistant' as const,
        content: '你好！我是智能知识库助手。你可以向我询问关于已有 PRD 和 SOP 的任何问题。'
      }]
    : history;

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* Header */}
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

      {/* Main Chat Area */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {displayMessages.map((msg, idx) => (
            <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              {/* Avatar */}
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-emerald-500 text-white'
              }`}>
                {msg.role === 'user' ? <User className="w-6 h-6" /> : <Bot className="w-6 h-6" />}
              </div>

              {/* Message Content */}
              <div className={`max-w-[80%] flex flex-col gap-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-tr-sm'
                    : 'bg-white text-slate-800 border border-slate-200 rounded-tl-sm shadow-sm whitespace-pre-wrap'
                }`}>
                  {msg.content}
                </div>

                {/* Citations / Sources */}
                {msg.sources && msg.sources.length > 0 && (() => {
                  // Deduplicate sources by filename, keeping the one with highest score
                  const uniqueSources = msg.sources.reduce((acc, src) => {
                    const existing = acc.find(s => s.filename === src.filename);
                    if (!existing || src.score > existing.score) {
                      return [...acc.filter(s => s.filename !== src.filename), src];
                    }
                    return acc;
                  }, [] as typeof msg.sources);

                  return (
                    <div className="mt-2 w-full">
                      <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
                        <Search className="w-3 h-3" />
                        参考来源 ({uniqueSources.length})
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {uniqueSources.map((src, sIdx) => (
                          <div
                            key={`${src.filename}-${sIdx}`}
                            className="group relative flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-600 hover:border-indigo-300 hover:text-indigo-700 cursor-pointer transition-colors shadow-sm"
                          >
                            <BookOpen className="w-3.5 h-3.5 text-indigo-500" />
                            <span className="font-medium max-w-[150px] truncate">{src.filename}</span>
                            <span className="text-slate-400">·</span>
                            <span className="text-slate-400">{(src.score * 100).toFixed(0)}%</span>

                            {/* Hover Popover for detailed snippet */}
                            <div className="absolute bottom-full left-0 mb-2 w-80 p-4 bg-slate-800 text-slate-200 text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 shadow-xl">
                              <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-700">
                                <p className="font-semibold text-white">{src.filename}</p>
                                <span className="text-indigo-400 text-[10px]">匹配度: {(src.score * 100).toFixed(1)}%</span>
                              </div>
                              <p className="text-slate-300 leading-relaxed line-clamp-8">{src.content}</p>
                              <div className="absolute -bottom-1 left-4 w-2 h-2 bg-slate-800 transform rotate-45"></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          ))}
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
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
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
  );
}
