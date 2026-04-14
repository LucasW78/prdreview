import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { reviewApi } from '../api';

export default function PromptManagement() {
  const [reviewSystemPrompt, setReviewSystemPrompt] = useState('');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [hint, setHint] = useState('');

  useEffect(() => {
    setIsLoading(true);
    reviewApi.getSystemPrompt()
      .then((res) => {
        const prompt = res.data?.prompt || '';
        setReviewSystemPrompt(prompt);
        setDraftPrompt(prompt);
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

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
      setReviewSystemPrompt(saved);
      setDraftPrompt(saved);
      setHint('已应用到评审工作台');
      window.setTimeout(() => setHint(''), 1500);
    } catch (err) {
      console.error(err);
      setHint('应用失败，请稍后重试');
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 px-6 pt-6 pb-0">
      <div className="max-w-7xl mx-auto bg-white rounded-xl shadow-sm border border-slate-200 p-6 h-[calc(100vh-76px)] flex flex-col gap-4">
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-indigo-600" />
            <h1 className="text-2xl font-bold text-slate-900">提示词管理</h1>
          </div>
          <div className="flex items-center gap-2">
            {hint && <span className="text-xs text-emerald-600">{hint}</span>}
            <button
              onClick={() => setDraftPrompt(reviewSystemPrompt)}
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
        </div>
        <p className="text-sm text-slate-500 shrink-0">评审工作台系统提示词，支持编辑后应用。</p>
        <textarea
          value={draftPrompt}
          onChange={(e) => setDraftPrompt(e.target.value)}
          disabled={isLoading}
          className="w-full flex-1 min-h-0 resize-none border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono bg-slate-50 focus:ring-2 focus:ring-indigo-500 outline-none overflow-y-auto"
          placeholder={isLoading ? '加载中...' : '请输入系统提示词'}
        />
      </div>
    </div>
  );
}
