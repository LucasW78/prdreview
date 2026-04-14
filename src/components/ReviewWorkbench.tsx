import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, CheckCircle, GitMerge, X, Maximize2, Play, FileText, UploadCloud, Trash2, FileUp } from 'lucide-react';
import { Conflict, DocBlock, SupplementaryInfo } from '../types';
import { reviewApi, ingestionApi } from '../api';

interface ReviewWorkbenchProps {
  onNavigateKnowledge?: (module?: string) => void;
}

export default function ReviewWorkbench({ onNavigateKnowledge }: ReviewWorkbenchProps) {
  const [blocks, setBlocks] = useState<DocBlock[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [supplementaryInfo, setSupplementaryInfo] = useState<SupplementaryInfo[]>([]);
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [modules, setModules] = useState<string[]>(['支付模块', '任务调度', '用户中心']);
  const [selectedModule, setSelectedModule] = useState<string>('支付模块');
  
  const [inputText, setInputText] = useState<string>('');
  const [inputHistory, setInputHistory] = useState<string[]>(['']);
  const [inputHistoryIndex, setInputHistoryIndex] = useState(0);
  
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isReadingFile, setIsReadingFile] = useState(false);
  
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [processTime, setProcessTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [originContentDisplay, setOriginContentDisplay] = useState<string>('');
  const [optimizedContentDisplay, setOptimizedContentDisplay] = useState<string>('');
  const [isEditingOrigin, setIsEditingOrigin] = useState<boolean>(false);
  const [focusedLineIndex, setFocusedLineIndex] = useState<number | null>(null);
  const [focusTrigger, setFocusTrigger] = useState(0);
  const [activeInputTab, setActiveInputTab] = useState<'markdown' | 'file'>('markdown');
  const [snapshotHistory, setSnapshotHistory] = useState<any[]>([]);
  const [saveHint, setSaveHint] = useState<string>('');
  const [reviewJobs, setReviewJobs] = useState<any[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [mergeResultModal, setMergeResultModal] = useState<{
    open: boolean;
    success: boolean;
    message: string;
    module?: string;
    canView?: boolean;
  }>({ open: false, success: false, message: '' });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingTimerRef = useRef<number | null>(null);
  const jobsRef = useRef<any[]>([]);
  const activeTaskIdRef = useRef<number | null>(null);
  const originLineRefs = useRef<Record<number, HTMLDivElement | null>>({});

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
      // Always keep full original document as baseline when no replacement is applied.
      return dedupeNearLines(finalDoc);
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

  const findLineIndexBySnippet = useCallback((content: string, snippet: string) => {
    const lines = (content || '').split('\n');
    const target = normalizeForCompare(snippet || '');
    if (!target) return -1;
    for (let i = 0; i < lines.length; i += 1) {
      const n = normalizeForCompare(lines[i] || '');
      if (!n) continue;
      if (n.includes(target) || target.includes(n)) return i;
    }
    return -1;
  }, [normalizeForCompare]);

  const jumpToBlockInOrigin = useCallback((blockId?: string, fallbackSnippet?: string) => {
    const matchedBlock = blockId ? blocks.find((b) => b.id === blockId) : undefined;
    const fallbackBlock = matchedBlock || blocks[0];
    let snippet = matchedBlock?.originalText || fallbackBlock?.originalText || '';
    if (!snippet && fallbackSnippet) {
      snippet = fallbackSnippet;
    }
    if (!snippet) {
      if (isEditingOrigin) setIsEditingOrigin(false);
      setFocusedLineIndex(0);
      setFocusTrigger((v) => v + 1);
      return;
    }
    let idx = findLineIndexBySnippet(originContentDisplay, snippet);
    if (idx < 0) {
      idx = 0;
    }
    if (isEditingOrigin) setIsEditingOrigin(false);
    setFocusedLineIndex(idx);
    setFocusTrigger((v) => v + 1);
  }, [blocks, originContentDisplay, findLineIndexBySnippet, isEditingOrigin]);

  useEffect(() => {
    if (focusedLineIndex === null) return;
    const el = originLineRefs.current[focusedLineIndex];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusedLineIndex, focusTrigger, isEditingOrigin]);

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
    if (file.name.toLowerCase().endsWith('.pdf')) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const pdfjsLib = await import('pdfjs-dist');
          pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
            'pdfjs-dist/build/pdf.worker.min.mjs',
            import.meta.url
          ).toString();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          const texts: string[] = [];
          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
              .map((item: any) => ('str' in item ? item.str : ''))
              .join(' ')
              .trim();
            if (pageText) {
              texts.push(pageText);
            }
          }
          const content = texts.join('\n\n');
          if (!content.trim()) {
            setError('PDF 文本提取失败，请确认文件内容可复制或先转换为文本版后上传。');
            setFileContent('');
          } else {
            setFileContent(content);
            setError(null);
          }
        } catch (err) {
          console.error(err);
          setError('PDF 解析失败，请确认文件未加密且内容可读取。');
          setFileContent('');
        } finally {
          setIsReadingFile(false);
        }
      };
      reader.onerror = () => {
        setError('PDF 文件读取失败');
        setIsReadingFile(false);
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setFileContent(content);
      setError(null);
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

  useEffect(() => {
    jobsRef.current = reviewJobs;
  }, [reviewJobs]);

  useEffect(() => {
    activeTaskIdRef.current = activeTaskId;
  }, [activeTaskId]);

  const stopPolling = useCallback(() => {
    if (pollingTimerRef.current) {
      window.clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  }, []);

  const applyReviewResult = useCallback((data: any, finalContent: string) => {
    const result = data?.result;
    if (!result) return;
    const cleanedBlocks = (result.blocks || []).map((b: any) => ({
      ...b,
      aiText: toFinalAiText(b.originalText || '', b.aiText || '')
    }));
    setBlocks(cleanedBlocks);
    setConflicts(result.conflicts || []);
    setTaskId(data.task_id);
    setProcessTime(data.processing_time_sec || result.processing_time_sec || null);
    setSnapshotHistory(data.snapshots || []);
    setOptimizedContentDisplay(buildOptimizedDocument(finalContent, cleanedBlocks));
    setSupplementaryInfo(result.supplementaryInfo || []);
  }, [toFinalAiText, buildOptimizedDocument]);

  const openCompletedTask = useCallback((job: any) => {
    if (!job?.result) return;
    setActiveTaskId(job.taskId);
    setTaskId(job.taskId);
    setIsEditingOrigin(false);
    setOriginContentDisplay(job.originContent || '');
    applyReviewResult(
      {
        task_id: job.taskId,
        processing_time_sec: job.processing_time_sec,
        result: job.result,
        snapshots: job.snapshots || []
      },
      job.originContent || ''
    );
  }, [applyReviewResult]);

  const mapTaskToJob = useCallback((task: any) => ({
    taskId: task.task_id,
    module: task.module,
    documentName: task.document_name || '未命名文档',
    status: task.status,
    originContent: task.origin_content || '',
    processing_time_sec: task.processing_time_sec ?? null,
    error_message: task.error_message ?? null,
    snapshots: task.snapshots || [],
    snapshots_count: task.snapshots_count ?? (task.snapshots || []).length ?? 0,
    result: task.result || null,
    created_at: task.snapshots?.[0]?.created_at || ''
  }), []);

  useEffect(() => {
    if (pollingTimerRef.current) return;
    pollingTimerRef.current = window.setInterval(async () => {
      const currentJobs = jobsRef.current;
      const pendingJobs = currentJobs.filter((j) => j.status === 'pending' || j.status === 'processing');
      if (pendingJobs.length === 0) return;
      const updates = await Promise.all(
        pendingJobs.map(async (j) => {
          try {
            const res = await reviewApi.getTaskStatus(j.taskId);
            return { ok: true, taskId: j.taskId, data: res.data };
          } catch {
            return { ok: false, taskId: j.taskId };
          }
        })
      );
      setReviewJobs((prev) =>
        prev.map((job) => {
          const matched = updates.find((u) => u.taskId === job.taskId && u.ok);
          if (!matched || !matched.ok) return job;
          const d: any = matched.data;
          const next = {
            ...job,
            documentName: d.document_name || job.documentName,
            status: d.status,
            originContent: d.origin_content || job.originContent,
            processing_time_sec: d.processing_time_sec,
            error_message: d.error_message,
            snapshots: d.snapshots || [],
            result: d.result || job.result
          };
          return next;
        })
      );
    }, 1500);
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  useEffect(() => {
    reviewApi.listTasks({ page: 1, page_size: 50, include_snapshots: false })
      .then((res) => {
        const tasks = res.data?.tasks || [];
        setReviewJobs(tasks.map(mapTaskToJob));
      })
      .catch((err) => {
        console.error(err);
      });
  }, [mapTaskToJob]);

  const handleAnalyze = async () => {
    const finalContent = getFinalContent();
    if (!finalContent.trim()) {
      setError("请输入需求文档内容或上传文件");
      return;
    }
    
    setIsSubmittingReview(true);
    setError(null);
    const deriveDocumentName = () => {
      if (uploadedFile?.name?.trim()) return uploadedFile.name.trim();
      const firstLine = (finalContent || '')
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0) || '';
      const heading = firstLine.replace(/^#{1,6}\s*/, '').trim();
      return (heading || '未命名文档').slice(0, 120);
    };
    const documentName = deriveDocumentName();
    
    const enqueueReviewTask = async (content: string, docName: string) => {
      const response = await reviewApi.analyze({
        module: selectedModule,
        content
      });
      const newTaskId = response.data?.task_id;
      if (!newTaskId) {
        throw new Error('提交评审任务失败，未返回 task_id');
      }
      setReviewJobs((prev) => [
        {
          taskId: newTaskId,
          module: selectedModule,
          documentName: docName,
          status: response.data?.status || 'pending',
          originContent: content,
          processing_time_sec: null,
          error_message: null,
          snapshots: [],
          result: null,
          created_at: new Date().toISOString()
        },
        ...prev
      ]);
    };

    try {
      await enqueueReviewTask(finalContent, documentName);

      // 提交后仅保留左侧任务记录，右侧评审页面重置
      setBlocks([]);
      setConflicts([]);
      setTaskId(null);
      setActiveTaskId(null);
      setProcessTime(null);
      setIsEditingOrigin(false);
      setOriginContentDisplay('');
      setOptimizedContentDisplay('');
      setSnapshotHistory([]);
      setInputText('');
      setInputHistory(['']);
      setInputHistoryIndex(0);
      setUploadedFile(null);
      setFileContent('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.detail || "分析失败，请检查网络或后端服务。");
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handleReReview = useCallback(async () => {
    const currentTaskId = taskId ?? activeTaskId;
    if (!currentTaskId) {
      setError('请先选择一个评审任务再重新评审');
      return;
    }
    // Re-review should use original requirement content, not optimized draft.
    const content = (originContentDisplay || '').trim();
    if (!content) {
      setError('当前无可重新评审内容');
      return;
    }
    const firstLine = content
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) || '';
    const heading = firstLine.replace(/^#{1,6}\s*/, '').trim();
    const documentName = (heading || '未命名文档').slice(0, 120);

    setIsSubmittingReview(true);
    setError(null);
    try {
      const response = await reviewApi.rerunTask(currentTaskId, {
        module: selectedModule,
        content
      });
      setReviewJobs((prev) =>
        prev.map((job) =>
          job.taskId === currentTaskId
            ? {
                ...job,
                module: selectedModule,
                documentName,
                status: response.data?.status || 'pending',
                originContent: content,
                processing_time_sec: null,
                error_message: null,
                snapshots: [],
                result: null
              }
            : job
        )
      );
      setBlocks([]);
      setConflicts([]);
      setTaskId(null);
      setActiveTaskId(null);
      setProcessTime(null);
      setIsEditingOrigin(false);
      setOriginContentDisplay('');
      setOptimizedContentDisplay('');
      setSnapshotHistory([]);
      setInputText('');
      setInputHistory(['']);
      setInputHistoryIndex(0);
      setUploadedFile(null);
      setFileContent('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.detail || "重新评审失败，请检查网络或后端服务。");
    } finally {
      setIsSubmittingReview(false);
    }
  }, [taskId, activeTaskId, originContentDisplay, selectedModule]);

  const handleResetInput = useCallback(async () => {
    const currentTaskId = taskId ?? activeTaskId;
    if (currentTaskId) {
      try {
        await reviewApi.deleteTask(currentTaskId);
      } catch (err) {
        console.error(err);
      }
      setReviewJobs((prev) => prev.filter((job) => job.taskId !== currentTaskId));
    }
    setBlocks([]);
    setConflicts([]);
    setTaskId(null);
    setActiveTaskId(null);
    setProcessTime(null);
    setIsEditingOrigin(false);
    setInputText('');
    setOriginContentDisplay('');
    setOptimizedContentDisplay('');
    setInputHistory(['']);
    setInputHistoryIndex(0);
    setUploadedFile(null);
    setFileContent('');
    setSnapshotHistory([]);
    setSupplementaryInfo([]);
    setFocusedLineIndex(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [taskId, activeTaskId]);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  const handleSelectTask = useCallback((job: any) => {
    setActiveTaskId(job.taskId);
    setIsEditingOrigin(false);
    setFocusedLineIndex(null);
    if (job.status === 'completed' && job.result) {
      openCompletedTask(job);
      return;
    }
    setBlocks([]);
    setConflicts([]);
    setSupplementaryInfo([]);
    setTaskId(job.taskId);
    setProcessTime(job.processing_time_sec ?? null);
    setOriginContentDisplay(job.originContent || '');
    setOptimizedContentDisplay('');
    setSnapshotHistory(job.snapshots || []);
  }, [openCompletedTask]);

  const statusMeta = (status: string) => {
    if (status === 'completed') return { text: '已完成', cls: 'bg-emerald-100 text-emerald-700' };
    if (status === 'processing') return { text: '评审中', cls: 'bg-indigo-100 text-indigo-700' };
    if (status === 'failed') return { text: '失败', cls: 'bg-red-100 text-red-700' };
    return { text: '待评审', cls: 'bg-amber-100 text-amber-700' };
  };

  const isConflictType = (type?: string) => {
    const t = (type || '').toLowerCase();
    return t === 'conflict' || t.endsWith('_conflict') || t.includes('logic') || t.includes('rule') || t.includes('data') || t.includes('process');
  };

  const conflictItems = conflicts.filter((c) => isConflictType(c.type));
  const specItems = conflicts.filter((c) => !isConflictType(c.type));
  const improvementItems = supplementaryInfo || [];
  const reportCount = conflictItems.length + specItems.length + improvementItems.length;

  const sidebarPanel = (
    <div className="p-2 sm:p-3 h-full min-h-[420px] border-r border-slate-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800">评审快照列表</h3>
        <span className="text-xs text-slate-500">
          {reviewJobs.length} 任务 / {reviewJobs.reduce((acc, j) => acc + ((j.snapshots || []).length || 0), 0)} 快照
        </span>
      </div>
      <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-240px)] pr-1">
        {reviewJobs.length === 0 ? (
          <div className="text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg p-3">
            暂无评审任务
          </div>
        ) : (
          reviewJobs.map((job) => {
            const meta = statusMeta(job.status);
            const active = activeTaskId === job.taskId;
            return (
              <button
                key={job.taskId}
                onClick={() => handleSelectTask(job)}
                className={`w-full text-left border rounded-lg p-3 transition-colors ${active ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-xs font-medium text-slate-700 truncate block min-w-0 flex-1"
                    title={job.documentName || `任务 #${job.taskId}`}
                  >
                    {job.documentName || `任务 #${job.taskId}`}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded ${meta.cls}`}>{meta.text}</span>
                </div>
                <div className="mt-1 text-xs text-slate-500 flex items-center gap-1 min-w-0">
                  <span className="truncate min-w-0" title={job.module}>{job.module}</span>
                  <span className="shrink-0">· 任务 #{job.taskId}</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">快照 {job.snapshots_count ?? (job.snapshots || []).length}</div>
                {job.status === 'processing' && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-indigo-600">
                    <div className="animate-spin rounded-full h-3 w-3 border-b border-indigo-600"></div>
                    正在检索与冲突分析
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  const handleMergeConfirm = async () => {
    if (!taskId) {
      setError('缺少任务 ID，请重新执行评审后再导入知识库');
      return;
    }
    try {
      const autoContent = buildOptimizedDocument(originContentDisplay, blocks).trim();
      const finalContent = (autoContent || optimizedContentDisplay).trim();
      if (!finalContent) {
        setError('导入内容为空，请先完成优化内容');
        return;
      }
      const response = await reviewApi.merge(taskId, finalContent);
      setIsMergeModalOpen(false);
      const mergeMsg = response.data?.message || '导入知识库成功！文档已归档。';
      const indexingErr = response.data?.indexing_error;
      setMergeResultModal({
        open: true,
        success: true,
        message: indexingErr ? `${mergeMsg}\n${indexingErr}` : mergeMsg,
        module: selectedModule,
        canView: true
      });
      setReviewJobs((prev) => prev.filter((job) => job.taskId !== taskId));
      setActiveTaskId(null);
      setSnapshotHistory([]);
      setBlocks([]);
      setConflicts([]);
      setInputText('');
      setOriginContentDisplay('');
      setOptimizedContentDisplay('');
      setTaskId(null);
    } catch (err: any) {
      console.error(err);
      const detail = err?.response?.data?.detail || err?.message || '未知错误';
      setMergeResultModal({
        open: true,
        success: false,
        message: `导入知识库失败：${detail}`,
        canView: false
      });
    }
  };

  const handleSaveSnapshot = useCallback(async () => {
    const currentTaskId = taskId ?? activeTaskId;
    if (!currentTaskId) {
      setError('请先发起或选择一个评审任务后再保存快照');
      alert('请先发起或选择一个评审任务后再保存快照');
      return;
    }
    try {
      const res = await reviewApi.saveSnapshot(currentTaskId, {
        module: selectedModule,
        processing_time_sec: processTime ?? undefined,
        blocks: blocks || [],
        conflicts: conflicts || [],
        supplementaryInfo: supplementaryInfo || []
      });
      const updated = mapTaskToJob(res.data);
      setReviewJobs((prev) =>
        prev.map((job) => (job.taskId === currentTaskId ? { ...job, ...updated } : job))
      );
      if (activeTaskId === currentTaskId) {
        setSnapshotHistory(res.data?.snapshots || []);
      }
      setSaveHint('快照已保存');
      window.setTimeout(() => setSaveHint(''), 1600);
      // 保存后回到空态待上传页（不删除左侧任务记录）
      setBlocks([]);
      setConflicts([]);
      setSupplementaryInfo([]);
      setTaskId(null);
      setActiveTaskId(null);
      setProcessTime(null);
      setIsEditingOrigin(false);
      setFocusedLineIndex(null);
      setOriginContentDisplay('');
      setOptimizedContentDisplay('');
      setSnapshotHistory([]);
      setInputText('');
      setInputHistory(['']);
      setInputHistoryIndex(0);
      setUploadedFile(null);
      setFileContent('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err: any) {
      console.error(err);
      alert(err?.response?.data?.detail || '快照保存失败');
    }
  }, [taskId, activeTaskId, selectedModule, processTime, blocks, conflicts, supplementaryInfo, mapTaskToJob]);

  const renderMergeResultModal = () => {
    if (!mergeResultModal.open) return null;
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/35 p-4">
        <div className="bg-white w-full max-w-sm rounded-xl shadow-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
            <h3 className={`text-base font-semibold ${mergeResultModal.success ? 'text-emerald-700' : 'text-red-700'}`}>
              {mergeResultModal.success ? '导入知识库成功' : '导入知识库失败'}
            </h3>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-slate-700 whitespace-pre-wrap leading-5">{mergeResultModal.message}</p>
          </div>
          <div className="px-4 py-3 border-t border-slate-200 bg-white flex justify-end gap-2">
            {mergeResultModal.success && mergeResultModal.canView && (
              <button
                onClick={() => {
                  const module = mergeResultModal.module || selectedModule;
                  setMergeResultModal({ open: false, success: false, message: '' });
                  onNavigateKnowledge?.(module);
                }}
                className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700 transition-colors"
              >
                查看
              </button>
            )}
            <button
              onClick={() => setMergeResultModal({ open: false, success: false, message: '' })}
              className="px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 transition-colors"
            >
              确定
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (blocks.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto bg-slate-50 px-6 pt-6 pb-0">
        <div className="w-full max-w-7xl mx-auto bg-white rounded-xl shadow-sm border border-slate-200 p-4 grid grid-cols-[280px_1fr] gap-4 h-[calc(100vh-76px)]">
          {sidebarPanel}
          <div className="p-2 sm:p-4 h-full overflow-y-auto min-h-0">
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
                className="w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 outline-none bg-slate-50 truncate"
                title={selectedModule}
              >
                {modules.map(mod => (
                  <option key={mod} value={mod}>{mod}</option>
                ))}
              </select>
            </div>
            <div className="flex border-b border-slate-200">
              <button
                onClick={() => setActiveInputTab('markdown')}
                className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${
                  activeInputTab === 'markdown'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Markdown 输入
                </div>
              </button>
              <button
                onClick={() => setActiveInputTab('file')}
                className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${
                  activeInputTab === 'file'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileUp className="w-4 h-4" />
                  上传文件
                </div>
              </button>
            </div>

            <div>
              {activeInputTab === 'markdown' && (
                <div className="relative h-[310px] shrink-0">
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
              )}

              {activeInputTab === 'file' && (
                <>
                  {!uploadedFile ? (
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="h-[310px] border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 transition-colors cursor-pointer group flex flex-col items-center justify-center shrink-0"
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
                    <div className="h-[310px] border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col shrink-0 overflow-hidden">
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
                </>
              )}
            </div>

            <button 
              onClick={handleAnalyze}
              disabled={isSubmittingReview}
              className="w-full bg-indigo-600 text-white py-3 rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isSubmittingReview ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  提交中...
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
        {renderMergeResultModal()}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 px-6 pt-6 pb-0">
      <div className="max-w-7xl mx-auto bg-white rounded-xl shadow-sm border border-slate-200 p-4 grid grid-cols-[280px_1fr] gap-4 h-[calc(100vh-76px)]">
      {sidebarPanel}
      <div className="flex flex-col overflow-hidden h-full min-h-0 pl-0 lg:pl-2">
      <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-3">
            <span>需求评审任务</span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700 border border-indigo-200">
              进行中
            </span>
          </h1>
          <div className="flex items-center gap-4 mt-2 text-sm text-slate-500 font-medium">
            <span className="flex items-center gap-1 min-w-0" title={selectedModule}>
              <span className="w-2 h-2 rounded-full bg-slate-300 shrink-0"></span>
              <span className="truncate">所属模块：{selectedModule}</span>
            </span>
            <span className="text-slate-300">|</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400"></span>耗时：{processTime}s</span>
          </div>
        </div>
        <div className="flex gap-3">
          {saveHint && (
            <span className="inline-flex items-center text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded">
              {saveHint}
            </span>
          )}
          <button 
            onClick={handleSaveSnapshot}
            className="bg-white border border-slate-300 text-slate-700 px-4 py-2.5 rounded-lg font-medium hover:bg-slate-50 transition-colors"
          >
            保存
          </button>
          <button 
            onClick={handleResetInput}
            className="bg-white border border-slate-300 text-slate-700 px-4 py-2.5 rounded-lg font-medium hover:bg-slate-50 transition-colors"
          >
            取消
          </button>
          <button 
            onClick={handleReReview}
            disabled={isSubmittingReview}
            className="bg-white border border-slate-300 text-slate-700 px-4 py-2.5 rounded-lg font-medium hover:bg-slate-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            重新评审
          </button>
          <button 
            onClick={() => setIsMergeModalOpen(true)}
            className="bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-sm"
          >
            <GitMerge className="w-4 h-4" />
            <span>导入知识库</span>
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden p-6 gap-6">
        <div className="flex-1 min-h-0 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
          <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 font-semibold text-slate-700 flex justify-between items-center">
            <span>原始需求文档</span>
            <button
              onClick={() => setIsEditingOrigin((v) => !v)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded hover:bg-slate-100 text-slate-700"
            >
              {isEditingOrigin ? '完成编辑' : '编辑'}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-6 font-mono text-sm text-slate-600 leading-relaxed">
            {isEditingOrigin ? (
              <textarea
                value={originContentDisplay}
                onChange={(e) => setOriginContentDisplay(e.target.value)}
                className="w-full min-h-[300px] h-full border border-slate-200 rounded-lg p-3 font-mono resize-y focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            ) : (
              <div className="space-y-0.5">
                {originContentDisplay.split('\n').map((line, idx) => (
                  <div
                    key={idx}
                    ref={(el) => { originLineRefs.current[idx] = el; }}
                    className={`whitespace-pre-wrap rounded px-1 transition-colors ${
                      focusedLineIndex === idx ? 'bg-yellow-100 ring-1 ring-yellow-300' : ''
                    }`}
                  >
                    {line || ' '}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      <div className="h-48 bg-white border-t border-slate-200 flex flex-col shrink-0">
        <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              冲突与规范检查报告
              <span className="ml-2 px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-xs">
                {reportCount} 项待处理
              </span>
            </h3>
            <span className="text-xs text-slate-500">评审快照：{snapshotHistory.length}</span>
          </div>
          {snapshotHistory.length > 0 && (
            <div className="mt-2 flex items-center gap-2 overflow-x-auto">
              {snapshotHistory.map((snap: any, idx: number) => (
                <div key={`${snap.created_at || idx}`} className="px-2 py-1 rounded-md bg-white border border-slate-200 text-xs text-slate-600 whitespace-nowrap">
                  快照 {idx + 1} · {snap.status || 'completed'} · {snap.processing_time_sec ?? '-'}s
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-x-auto p-4 flex gap-4">
          {reportCount === 0 ? (
            <div className="w-full flex items-center justify-center text-slate-400 text-sm">
              <CheckCircle className="w-5 h-5 mr-2 text-emerald-500" />
              未检测到明显冲突
            </div>
          ) : (
            <>
            {conflictItems.map(conflict => (
              <div 
                key={conflict.id} 
                className="min-w-[320px] max-w-sm h-full rounded-lg border p-4 flex flex-col min-h-0 transition-all bg-red-50 border-red-200 shadow-sm overflow-hidden cursor-pointer"
                onClick={() => jumpToBlockInOrigin(conflict.blockId, conflict.description)}
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="px-2 py-1 rounded text-xs font-bold bg-red-100 text-red-700">
                    冲突
                  </span>
                </div>
                <p className="text-sm flex-1 min-h-0 overflow-y-auto pr-1 text-slate-700 whitespace-pre-wrap break-words overflow-wrap-anywhere">
                  {conflict.description}
                </p>
              </div>
            ))}
            {specItems.map(conflict => (
              <div
                key={conflict.id}
                className="min-w-[320px] max-w-sm h-full rounded-lg border p-4 flex flex-col min-h-0 transition-all bg-amber-50 border-amber-200 shadow-sm overflow-hidden cursor-pointer"
                onClick={() => jumpToBlockInOrigin(conflict.blockId, conflict.description)}
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="px-2 py-1 rounded text-xs font-bold bg-amber-100 text-amber-700">
                    规范建议
                  </span>
                </div>
                <p className="text-sm flex-1 min-h-0 overflow-y-auto pr-1 text-slate-700 whitespace-pre-wrap break-words overflow-wrap-anywhere">
                  {conflict.description}
                </p>
              </div>
            ))}
            {improvementItems.map((item) => (
              <div
                key={item.id}
                className="min-w-[320px] max-w-sm h-full rounded-lg border p-4 flex flex-col min-h-0 transition-all bg-indigo-50 border-indigo-200 shadow-sm overflow-hidden"
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="px-2 py-1 rounded text-xs font-bold bg-indigo-100 text-indigo-700">
                    完善建议
                  </span>
                  <span className="text-xs text-slate-500 ml-2 whitespace-nowrap truncate max-w-[180px]" title={item.title}>
                    {item.title}
                  </span>
                </div>
                <p className="text-sm flex-1 min-h-0 overflow-y-auto pr-1 text-slate-700 whitespace-pre-wrap break-words overflow-wrap-anywhere">
                  {item.content}
                </p>
              </div>
            ))}
            </>
          )}
        </div>
      </div>

      </div>
      </div>

      {isMergeModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-8">
          <div className="bg-white w-full max-w-5xl h-full max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Maximize2 className="w-5 h-5 text-indigo-600" />
                导入知识库确认 (干净文本)
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

      {renderMergeResultModal()}
    </div>
  );
}
