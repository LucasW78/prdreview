import React, { useCallback, useEffect, useRef, useState } from 'react';

interface EditableTextBlockProps {
  value: string;
  onChange: (newValue: string) => void;
  isHighlighted?: boolean;
  className?: string;
}

export default function EditableTextBlock({ value, onChange, isHighlighted = false, className = '' }: EditableTextBlockProps) {
  const [history, setHistory] = useState<string[]>([value]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const onChangeRef = useRef(onChange);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (value !== history[historyIndex]) {
      setHistory([value]);
      setHistoryIndex(0);
    }
  }, [value]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const undo = useCallback(() => {
    if (canUndo) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      onChangeRef.current(history[newIndex]);
    }
  }, [canUndo, historyIndex, history]);

  const redo = useCallback(() => {
    if (canRedo) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      onChangeRef.current(history[newIndex]);
    }
  }, [canRedo, historyIndex, history]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newValue);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    onChangeRef.current(newValue);
  }, [history, historyIndex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey)) {
      if (e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }
      if (e.key === 'y') {
        e.preventDefault();
        redo();
        return;
      }
    }
  }, [undo, redo]);

  const handleUndoClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    undo();
  }, [undo]);

  const handleRedoClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    redo();
  }, [redo]);

  return (
    <div className="relative group">
      <div className="absolute top-1 right-1 hidden group-hover:flex gap-0.5 z-10">
        <button 
          onMouseDown={handleUndoClick}
          disabled={!canUndo}
          className="px-1.5 py-0.5 text-[10px] bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
          title="撤销 (Ctrl+Z)"
        >
          ↩
        </button>
        <button 
          onMouseDown={handleRedoClick}
          disabled={!canRedo}
          className="px-1.5 py-0.5 text-[10px] bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
          title="重做 (Ctrl+Y)"
        >
          ↪
        </button>
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className={`w-full resize-none outline-none rounded-md p-2 transition-colors ${
          isHighlighted ? 'bg-amber-50 focus:bg-amber-100' : 'hover:bg-slate-50 focus:bg-slate-50'
        } ${className}`}
        rows={value.split('\n').length || 3}
      />
    </div>
  );
}
