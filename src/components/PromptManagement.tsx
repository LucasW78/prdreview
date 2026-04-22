import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { reviewApi } from '../api';

interface PromptHistoryItem {
  version: string;
  prompt: string;
  updated_by?: string;
  created_at?: string;
}

export default function PromptManagement() {
  const [reviewSystemPrompt, setReviewSystemPrompt] = useState('');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [history, setHistory] = useState<PromptHistoryItem[]>([]);
  const [activeVersion, setActiveVersion] = useState('');
  const [previewVersion, setPreviewVersion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [rollingVersion, setRollingVersion] = useState('');
  const [hint, setHint] = useState('');

  /**
   * Load active prompt and history versions when entering Prompt Management page.
   * @returns Promise<void> resolves when remote prompt data is synced into local state.
   */
  const loadPromptData = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const res = await reviewApi.getSystemPrompt();
      const prompt = res.data?.prompt || '';
      const versions = Array.isArray(res.data?.history) ? res.data.history : [];
      setReviewSystemPrompt(prompt);
      setDraftPrompt(prompt);
      setHistory(versions);
      setActiveVersion(res.data?.current_version || (versions[0]?.version || ''));
      setPreviewVersion('');
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadPromptData();
  }, []);

  /**
   * Persist draft prompt as a new version and switch active prompt to this version.
   * @returns Promise<void> resolves after backend save succeeds or fails with hint update.
   */
  const handleApply = async () => {
    const next = draftPrompt.trim();
    if (!next) {
      setHint('提示词不能为空');
      return;
    }
    setIsApplying(true);
    try {
      const res = await reviewApi.applySystemPrompt(next);
      const saved = res.data?.prompt || next;
      const versions = Array.isArray(res.data?.history) ? res.data.history : history;
      setReviewSystemPrompt(saved);
      setDraftPrompt(saved);
      setHistory(versions);
      setActiveVersion(res.data?.current_version || (versions[0]?.version || ''));
      setPreviewVersion('');
      setHint('已应用到评审工作台');
      window.setTimeout(() => setHint(''), 1500);
    } catch (err) {
      console.error(err);
      setHint('应用失败，请稍后重试');
    } finally {
      setIsApplying(false);
    }
  };

  /**
   * Roll back active prompt to the selected historical version.
   * @param version Target prompt version identifier.
   * @returns Promise<void> resolves after rollback and state refresh.
   */
  const handleRollback = async (version: string): Promise<void> => {
    if (!version || rollingVersion) {
      return;
    }
    setRollingVersion(version);
    try {
      const res = await reviewApi.rollbackSystemPrompt(version);
      const versions = Array.isArray(res.data?.history) ? res.data.history : history;
      const prompt = res.data?.prompt || '';
      setReviewSystemPrompt(prompt);
      setDraftPrompt(prompt);
      setHistory(versions);
      setActiveVersion(res.data?.current_version || version);
      setPreviewVersion('');
      setHint(`已回滚到 ${version}`);
      window.setTimeout(() => setHint(''), 1500);
    } catch (err) {
      console.error(err);
      setHint('回滚失败，请稍后重试');
    } finally {
      setRollingVersion('');
    }
  };

  /**
   * Format ISO timestamp into concise local datetime text for version list.
   * @param value ISO datetime string.
   * @returns Formatted datetime text, or '-' when missing.
   */
  const formatDateTime = (value?: string): string => {
    if (!value) {
      return '-';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString('zh-CN', { hour12: false });
  };

  /**
   * Preview a historical prompt version in the editor without changing active version.
   * @param item Prompt history item selected from the version list.
   * @returns void
   */
  const handlePreviewVersion = (item: PromptHistoryItem): void => {
    if (!item?.prompt) {
      return;
    }
    setDraftPrompt(item.prompt);
    setPreviewVersion(item.version);
    setHint(`正在查看 ${item.version}`);
    window.setTimeout(() => setHint(''), 1200);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 px-6 pt-6 pb-0">
      <div className="max-w-7xl mx-auto bg-white rounded-xl shadow-sm border border-slate-200 p-6 h-[calc(100vh-76px)] flex flex-col gap-4 min-h-0">
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-indigo-600" />
            <h1 className="text-2xl font-bold text-slate-900">提示词管理</h1>
          </div>
          {hint && <span className="text-xs text-emerald-600">{hint}</span>}
        </div>
        <p className="text-sm text-slate-500 shrink-0">评审工作台系统提示词，支持编辑后应用。</p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
          <div className="border border-slate-200 rounded-lg p-3 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <h2 className="text-sm font-semibold text-slate-800">历史版本</h2>
              <span className="text-xs text-slate-500">当前：{activeVersion || '-'}</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
              {history.length === 0 && (
                <div className="text-xs text-slate-500 bg-slate-50 border border-dashed border-slate-300 rounded-lg p-3">
                  暂无历史版本
                </div>
              )}
              {history.map((item) => {
                const isActive = item.version === activeVersion;
                const isRolling = rollingVersion === item.version;
                const isPreview = item.version === previewVersion;
                return (
                  <div
                    key={item.version}
                    onClick={() => handlePreviewVersion(item)}
                    className={`rounded-lg border p-2 cursor-pointer transition-colors ${
                      isActive ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white'
                    } ${
                      isPreview
                        ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-300 shadow-sm'
                        : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-700">{item.version}</span>
                      <div className="flex items-center gap-1">
                        {isPreview && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-700">查看中</span>
                        )}
                        {isActive ? (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-700">当前</span>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleRollback(item.version);
                            }}
                            disabled={isRolling}
                            className="text-[10px] px-2 py-0.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {isRolling ? '回滚中...' : '回滚'}
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">更新时间：{formatDateTime(item.created_at)}</p>
                    <p className="text-[11px] text-slate-500">操作人：{item.updated_by || '-'}</p>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="lg:col-span-2 flex flex-col min-h-0">
            <div className="flex items-center justify-end gap-2 mb-2 shrink-0">
              {previewVersion && (
                <button
                  onClick={() => {
                    setDraftPrompt(reviewSystemPrompt);
                    setPreviewVersion('');
                  }}
                  disabled={isLoading || isApplying}
                  className="px-3 py-1.5 text-xs border border-indigo-300 rounded-lg text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                >
                  返回当前版本
                </button>
              )}
              <button
                onClick={() => {
                  setDraftPrompt(reviewSystemPrompt);
                  setPreviewVersion('');
                }}
                disabled={isLoading || isApplying}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                重置
              </button>
              <button
                onClick={handleApply}
                disabled={isLoading || isApplying}
                className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {isApplying ? '应用中...' : '应用'}
              </button>
            </div>
            <textarea
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              disabled={isLoading}
              className="w-full flex-1 min-h-0 resize-none border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono bg-slate-50 focus:ring-2 focus:ring-indigo-500 outline-none overflow-y-auto"
              placeholder={isLoading ? '加载中...' : '请输入系统提示词'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
