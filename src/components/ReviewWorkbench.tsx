import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, CheckCircle, Info, GitMerge, X, Maximize2, Play, FileText, UploadCloud, Trash2, FileUp } from 'lucide-react';
import { Conflict, DocBlock } from '../types';
import { reviewApi, ingestionApi } from '../api';

export default function ReviewWorkbench() {
  const [blocks, setBlocks] = useState<DocBlock[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  
  const [modules, setModules] = useState<string[]>(['支付模块', '任务调度', '用户中心']);
  const [selectedModule, setSelectedModule] = useState<string>('支付模块');
  
  const [inputText, setInputText] = useState<string>('');
  const [inputHistory, setInputHistory] = useState<string[]>(['']);
  const [inputHistoryIndex, setInputHistoryIndex] = useState(0);
  
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isReadingFile, setIsReadingFile] = useState(false);
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [processTime, setProcessTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [originContentDisplay, setOriginContentDisplay] = useState<string>('');
  const [optimizedContentDisplay, setOptimizedContentDisplay] = useState<string>('');
  const [isEditingOptimized, setIsEditingOptimized] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const canUndoInput = inputHistoryIndex > 0;
  const canRedoInput = inputHistoryIndex < inputHistory.length - 1;

  const getFinalContent = useCallback(() => {
    if (fileContent.trim()) {
      return fileContent;
    }
    return inputText;
  }, [fileContent, inputText]);

  const toFinalAiText = useCallback((originalText: string, aiText: string) => {
    if (!aiText) return aiText;
    const marker = "【优化建议】";
    const idx = aiText.indexOf(marker);
    if (idx === -1) return aiText.trim();
    const before = aiText.slice(0, idx).trim();
    const suggestion = aiText.slice(idx + marker.length).trim();
    if (before && before !== originalText.trim()) {
      return before;
    }
    if (suggestion.includes("不具备强制覆盖性") || suggestion.includes("非强制覆盖") || suggestion.includes("参考建议")) {
      return originalText
        .replace("具备强制覆盖性，能直接修改业务逻辑。", "不具备强制覆盖性，作为参考建议用于提示评审，不直接修改业务逻辑。")
        .replace("强制覆盖", "参考建议（非强制）")
        .trim();
    }
    if (suggestion.includes("建议") && originalText.includes("必须")) {
      return originalText.replace("必须", "建议").trim();
    }
    return before || originalText;
  }, []);

  const buildOptimizedDocument = useCallback((origin: string, blks: any[]) => {
    let finalDoc = origin || '';
    if (!finalDoc) return finalDoc;
    const blocksSorted = [...blks].sort((a, b) => (b.originalText?.length || 0) - (a.originalText?.length || 0));
    const normalizeForMatch = (s: string) =>
      (s || '')
        .replace(/[*`#>\-_\[\]\(\)]/g, '')
        .replace(/[\s\u3000]+/g, '')
        .replace(/[：:，,。；;！!？?]/g, '')
        .toLowerCase()
        .trim();
    const replaceOnce = (src: string, search: string, replacement: string) => {
      if (!search) return src;
      const idx = src.indexOf(search);
      if (idx === -1) return src;
      return src.slice(0, idx) + replacement + src.slice(idx + search.length);
    };
    const replaceByNormalizedLine = (src: string, search: string, replacement: string) => {
      const nSearch = normalizeForMatch(search);
      if (!nSearch) return src;
      const lines = src.split('\n');
      let replaced = false;
      const nextLines = lines.map((line) => {
        if (replaced) return line;
        const nLine = normalizeForMatch(line);
        if (!nLine) return line;
        if (nLine.includes(nSearch) || nSearch.includes(nLine)) {
          replaced = true;
          const indent = (line.match(/^\s*/) || [''])[0];
          const bullet = (line.match(/^\s*([*\-]\s+)/) || [,''])[1];
          const cleanedReplacement = replacement.replace(/^\s*([*\-]\s+)/, '').trim();
          const prefix = `${indent}${bullet || ''}`;
          return `${prefix}${cleanedReplacement}`;
        }
        return line;
      });
      return replaced ? nextLines.join('\n') : src;
    };
    const dedupeNearLines = (doc: string) => {
      const lines = doc.split('\n');
      const out: string[] = [];
      for (const line of lines) {
        const n = normalizeForMatch(line);
        const prev = out.length > 0 ? normalizeForMatch(out[out.length - 1]) : '';
        if (n && prev && n === prev) continue;
        out.push(line);
      }
      return out.join('\n');
    };
    let applied = 0;
    for (const b of blocksSorted) {
      const orig = (b.originalText || '').trim();
      const ai = toFinalAiText(orig, b.aiText || '');
      if (!orig || !ai) continue;
      if (orig === ai) continue;
      const next = replaceOnce(finalDoc, orig, ai);
      if (next !== finalDoc) {
        finalDoc = next;
        applied += 1;
        continue;
      }
      const fuzzyNext = replaceByNormalizedLine(finalDoc, orig, ai);
      if (fuzzyNext !== finalDoc) {
        finalDoc = fuzzyNext;
        applied += 1;
      }
    }
    if (applied === 0) {
      // Fallback: 拼接块级 AI 文本，确保能看到优化内容
      return dedupeNearLines(
        blks.map(b => toFinalAiText(b.originalText || '', b.aiText || '') || b.originalText || '').join('\n\n')
      );
    }
    return dedupeNearLines(finalDoc);
  }, [toFinalAiText]);

  const normalizeForCompare = useCallback((s: string) =>
    (s || '')
      .replace(/[*`#>\-_\[\]\(\)]/g, '')
      .replace(/[\s\u3000]+/g, '')
      .replace(/[：:，,。；;！!？?]/g, '')
      .toLowerCase()
      .trim()
  , []);

  const computeHighlighted = useCallback((origin: string, optimized: string) => {
    const oLines = (origin || '').split('\n');
    const set = new Set(oLines.map(normalizeForCompare).filter(Boolean));
    return (optimized || '').split('\n').map((line) => {
      const n = normalizeForCompare(line);
      const changed = n.length > 0 && !set.has(n);
      return { line, changed };
    });
  }, [normalizeForCompare]);

  const undoInputText = useCallback(() => {
    if (canUndoInput) {
      const newIndex = inputHistoryIndex - 1;
      setInputHistoryIndex(newIndex);
      setInputText(inputHistory[newIndex]);
    }
  }, [canUndoInput, inputHistoryIndex, inputHistory]);

  const redoInputText = useCallback(() => {
    if (canRedoInput) {
      const newIndex = inputHistoryIndex + 1;
      setInputHistoryIndex(newIndex);
      setInputText(inputHistory[newIndex]);
    }
  }, [canRedoInput, inputHistoryIndex, inputHistory]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const newHistory = inputHistory.slice(0, inputHistoryIndex + 1);
    newHistory.push(newValue);
    setInputHistory(newHistory);
    setInputHistoryIndex(newHistory.length - 1);
    setInputText(newValue);
  }, [inputHistory, inputHistoryIndex]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey)) {
      if (e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redoInputText();
        } else {
          undoInputText();
        }
        return;
      }
      if (e.key === 'y') {
        e.preventDefault();
        redoInputText();
        return;
      }
    }
  }, [undoInputText, redoInputText]);

  const readFileContent = useCallback((file: File) => {
    setIsReadingFile(true);
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setFileContent(content);
      setIsReadingFile(false);
    };
    
    reader.onerror = () => {
      setError('文件读取失败');
      setIsReadingFile(false);
    };
    
    reader.readAsText(file);
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setUploadedFile(file);
      readFileContent(file);
    }
  }, [readFileContent]);

  const clearUploadedFile = useCallback(() => {
    setUploadedFile(null);
    setFileContent('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  useEffect(() => {
    ingestionApi.getModules()
      .then(res => {
        if (res.data && res.data.modules) {
          setModules(res.data.modules);
          if (res.data.modules.length > 0) {
            setSelectedModule(res.data.modules[0]);
          }
        }
      })
      .catch(err => console.error(err));
  }, []);

  const handleAnalyze = async () => {
    const finalContent = getFinalContent();
    if (!finalContent.trim()) {
      setError("请输入需求文档内容或上传文件");
      return;
    }
    
    setIsAnalyzing(true);
    setError(null);
    setOriginContentDisplay(finalContent);
    
    try {
      const response = await reviewApi.analyze({
        module: selectedModule,
        content: finalContent
      });
      
      const data = response.data;
      const cleanedBlocks = (data.blocks || []).map((b: any) => ({
        ...b,
        aiText: toFinalAiText(b.originalText || '', b.aiText || '')
      }));
      const effectiveConflicts = (data.conflicts || []).filter((c: any) => !c.ignored);
      const withConflictAwareChange = cleanedBlocks.map((b: any) => {
        const related = effectiveConflicts.filter((c: any) => c.blockId === b.id);
        const changed = (b.aiText || '').trim() !== (b.originalText || '').trim();
        return { ...b, hasChange: related.length > 0 ? changed : b.hasChange };
      });
      setBlocks(withConflictAwareChange);
      setConflicts(data.conflicts || []);
      setTaskId(data.task_id);
      setProcessTime(data.processing_time_sec);
      setOptimizedContentDisplay(buildOptimizedDocument(finalContent, withConflictAwareChange));
      
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.detail || "分析失败，请检查网络或后端服务。");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleResetInput = useCallback(() => {
    setBlocks([]);
    setConflicts([]);
    setTaskId(null);
    setInputText('');
    setOriginContentDisplay('');
    setOptimizedContentDisplay('');
    setInputHistory(['']);
    setInputHistoryIndex(0);
    setUploadedFile(null);
    setFileContent('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleIgnoreConflict = (conflictId: string) => {
    setConflicts(conflicts.map(c => c.id === conflictId ? { ...c, ignored: !c.ignored } : c));
  };

  const handleAiTextChange = (blockId: string, newText: string) => {};

  const handleMergeConfirm = async () => {
    if (!taskId) {
      setError('缺少任务 ID，请重新执行评审后再 Merge');
      return;
    }
    try {
      const finalContent = (optimizedContentDisplay || buildOptimizedDocument(originContentDisplay, blocks)).trim();
      if (!finalContent) {
        setError('Merge 内容为空，请先完成优化内容');
        return;
      }
      const response = await reviewApi.merge(taskId, finalContent);
      setIsMergeModalOpen(false);
      const mergeMsg = response.data?.message || 'Merge 成功！文档已归档。';
      const indexingErr = response.data?.indexing_error;
      alert(indexingErr ? `${mergeMsg}\n${indexingErr}` : mergeMsg);
      setBlocks([]);
      setConflicts([]);
      setInputText('');
      setTaskId(null);
    } catch (err: any) {
      console.error(err);
      const detail = err?.response?.data?.detail || err?.message || '未知错误';
      alert(`Merge 失败：${detail}`);
    }
  };

  if (blocks.length === 0 && !isAnalyzing) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 p-8">
        <div className="w-full max-w-5xl bg-white rounded-xl shadow-sm border border-slate-200 p-8">
          <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-2">
            <FileText className="w-6 h-6 text-indigo-600" />
            发起新需求评审
          </h2>
          
          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-200">
              {error}
            </div>
          )}

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">所属业务模块</label>
              <select 
                value={selectedModule}
                onChange={(e) => setSelectedModule(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 outline-none bg-slate-50"
              >
                {modules.map(mod => (
                  <option key={mod} value={mod}>{mod}</option>
                ))}
              </select>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="flex flex-col h-full">
                <label className="block text-sm font-medium text-slate-700 flex items-center gap-2 mb-2 shrink-0">
                  <FileText className="w-4 h-4 text-indigo-500" />
                  Markdown 输入
                  {inputText.trim() && !fileContent.trim() && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                      将使用此内容
                    </span>
                  )}
                </label>
                <div className="relative h-[350px] shrink-0">
                  <div className="absolute top-2 right-2 flex gap-1 z-10">
                    <button 
                      onClick={undoInputText}
                      disabled={!canUndoInput}
                      className="px-2 py-1 text-xs bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title="撤销 (Ctrl+Z)"
                    >
                      ↩ 撤销
                    </button>
                    <button 
                      onClick={redoInputText}
                      disabled={!canRedoInput}
                      className="px-2 py-1 text-xs bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title="重做 (Ctrl+Y 或 Ctrl+Shift+Z)"
                    >
                      ↪ 重做
                    </button>
                  </div>
                  <textarea 
                    value={inputText}
                    onChange={handleInputChange}
                    onKeyDown={handleInputKeyDown}
                    placeholder="# 需求标题&#10;## 1. 背景&#10;...在此输入需求内容..."
                    className="w-full h-full border border-slate-300 rounded-lg px-4 py-3 pt-10 focus:ring-2 focus:ring-indigo-500 outline-none bg-slate-50 font-mono text-sm resize-none overflow-y-auto"
                  />
                </div>
              </div>

              <div className="flex flex-col h-full">
                <label className="block text-sm font-medium text-slate-700 flex items-center gap-2 mb-2 shrink-0">
                  <FileUp className="w-4 h-4 text-emerald-500" />
                  上传文件
                  {fileContent.trim() && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                      将使用此内容
                    </span>
                  )}
                </label>
                {!uploadedFile ? (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="h-[350px] border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 transition-colors cursor-pointer group flex flex-col items-center justify-center shrink-0"
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      className="hidden"
                      accept=".md,.txt,.pdf"
                    />
                    <UploadCloud className="w-12 h-12 text-slate-400 mx-auto mb-4 group-hover:text-emerald-500 transition-colors" />
                    <p className="text-sm text-slate-600 font-medium">点击此处上传文件</p>
                    <p className="text-xs text-slate-400 mt-2">支持 .md, .txt, .pdf</p>
                  </div>
                ) : (
                  <div className="h-[350px] border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col shrink-0 overflow-hidden">
                    <div className="flex items-center justify-between mb-4 shrink-0">
                      <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-slate-500" />
                        <span className="text-sm font-medium text-slate-700 truncate max-w-[200px]">
                          {uploadedFile.name}
                        </span>
                      </div>
                      <button 
                        onClick={clearUploadedFile}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors shrink-0"
                        title="移除文件"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {isReadingFile ? (
                      <div className="flex-1 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                      </div>
                    ) : (
                      <div className="flex-1 bg-white rounded p-3 border border-slate-200 overflow-y-auto min-h-0">
                        <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono">
                          {fileContent}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <button 
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="w-full bg-indigo-600 text-white py-3 rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isAnalyzing ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  分析中...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  开始智能评审 (RAG + LLM)
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isAnalyzing) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
          <h3 className="text-lg font-medium text-slate-700">正在进行检索与冲突分析...</h3>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-100">
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-3">
            <span>需求评审任务</span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700 border border-indigo-200">
              进行中
            </span>
          </h1>
          <div className="flex items-center gap-4 mt-2 text-sm text-slate-500 font-medium">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300"></span>所属模块：{selectedModule}</span>
            <span className="text-slate-300">|</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400"></span>耗时：{processTime}s</span>
          </div>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={handleResetInput}
            className="bg-white border border-slate-300 text-slate-700 px-4 py-2.5 rounded-lg font-medium hover:bg-slate-50 transition-colors"
          >
            取消
          </button>
          <button 
            onClick={() => setIsMergeModalOpen(true)}
            className="bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-sm"
          >
            <GitMerge className="w-4 h-4" />
            <span>Merge 确认</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden p-6 gap-6">
        <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
          <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 font-semibold text-slate-700 flex justify-between items-center">
            <span>原始需求文档 (只读)</span>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-6 font-mono text-sm text-slate-600 leading-relaxed">
            <pre className="whitespace-pre-wrap">{originContentDisplay}</pre>
          </div>
        </div>

        <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden border-t-4 border-t-indigo-500">
          <div className="bg-indigo-50/50 px-5 py-3 border-b border-slate-200 font-semibold text-indigo-900 flex justify-between items-center">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
              AI 优化后文档 (可编辑)
            </span>
            <button
              onClick={() => setIsEditingOptimized(v => !v)}
              className="px-3 py-1.5 text-xs bg-white border border-indigo-200 rounded hover:bg-indigo-100 text-indigo-700"
            >
              {isEditingOptimized ? '完成编辑' : '编辑'}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-6 font-mono text-sm text-slate-800 leading-relaxed">
            {isEditingOptimized ? (
              <textarea
                value={optimizedContentDisplay}
                onChange={(e) => setOptimizedContentDisplay(e.target.value)}
                className="w-full min-h-[300px] h-full border border-slate-200 rounded-lg p-3 font-mono resize-y focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            ) : (
              <div className="space-y-1">
                {computeHighlighted(originContentDisplay, optimizedContentDisplay).map((row, idx) => (
                  <div
                    key={idx}
                    className={`whitespace-pre-wrap rounded ${
                      row.changed ? 'bg-amber-50 border-l-4 border-amber-400 pl-2' : ''
                    }`}
                  >
                    {row.line || ' '}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="h-64 bg-white border-t border-slate-200 flex flex-col shrink-0">
        <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            冲突与规范检查报告
            <span className="ml-2 px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-xs">
              {conflicts.filter(c => !c.ignored).length} 项待处理
            </span>
          </h3>
        </div>
        <div className="flex-1 overflow-x-auto p-4 flex gap-4">
          {conflicts.length === 0 ? (
            <div className="w-full flex items-center justify-center text-slate-400 text-sm">
              <CheckCircle className="w-5 h-5 mr-2 text-emerald-500" />
              未检测到明显冲突
            </div>
          ) : (
            conflicts.map(conflict => (
              <div 
                key={conflict.id} 
                className={`min-w-[320px] max-w-sm rounded-lg border p-4 flex flex-col transition-all ${
                  conflict.ignored 
                    ? 'bg-slate-50 border-slate-200 opacity-60' 
                    : conflict.type === 'conflict' 
                      ? 'bg-red-50 border-red-200 shadow-sm' 
                      : 'bg-amber-50 border-amber-200 shadow-sm'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                    conflict.ignored ? 'bg-slate-200 text-slate-500' :
                    conflict.type === 'conflict' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {conflict.type === 'conflict' ? '逻辑冲突' : '规范建议'}
                  </span>
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-500 cursor-pointer hover:text-slate-800">
                    <input 
                      type="checkbox" 
                      checked={conflict.ignored}
                      onChange={() => handleIgnoreConflict(conflict.id)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    忽略
                  </label>
                </div>
                <p className={`text-sm flex-1 ${conflict.ignored ? 'text-slate-500 line-through' : 'text-slate-700'}`}>
                  {conflict.description}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {isMergeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-8">
          <div className="bg-white w-full max-w-5xl h-full max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Maximize2 className="w-5 h-5 text-indigo-600" />
                二次确认 (干净文本)
              </h2>
              <button 
                onClick={() => setIsMergeModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-8 bg-slate-100">
              <div className="max-w-3xl mx-auto bg-white p-8 rounded-xl shadow-sm border border-slate-200 min-h-full">
                <div className="prose prose-slate max-w-none font-mono text-sm leading-loose whitespace-pre-wrap">
                  {(optimizedContentDisplay || buildOptimizedDocument(originContentDisplay, blocks)).trim()}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-white flex justify-end gap-3">
              <button 
                onClick={() => setIsMergeModalOpen(false)}
                className="px-5 py-2.5 rounded-lg font-medium text-slate-600 hover:bg-slate-100 transition-colors"
              >
                返回修改
              </button>
              <button 
                onClick={handleMergeConfirm}
                className="px-5 py-2.5 rounded-lg font-medium bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm transition-colors"
              >
                确认覆盖并归档
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
