import React from 'react';
import { BookOpen, FileText, Search, Database, X, Eye, Trash2, AlertTriangle, Upload } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { ingestionApi } from '../api';
import DataIngestion from './DataIngestion';

export default function KnowledgeBase() {
  const [modules, setModules] = useState<string[]>(['支付模块', '任务调度', '用户中心']);
  const [selectedModule, setSelectedModule] = useState<string>('全部');
  const [documents, setDocuments] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'prd' | 'sop'>('prd');
  const [loading, setLoading] = useState(false);
  const [hasQueried, setHasQueried] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalDocs, setTotalDocs] = useState(0);
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [deleteDoc, setDeleteDoc] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const loadDocuments = useCallback(() => {
    setLoading(true);
    setHasQueried(true);
    ingestionApi.getHistory({
      module: selectedModule === '全部' ? undefined : selectedModule,
      keyword: searchQuery.trim() || undefined,
      doc_type: activeTab,
      page: currentPage
    })
      .then(res => {
        if (res.data && res.data.documents) {
          setDocuments(res.data.documents);
          setTotalDocs(res.data.total || 0);
        } else {
          setDocuments([]);
          setTotalDocs(0);
        }
      })
      .catch(err => {
        console.error(err);
        setDocuments([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [selectedModule, searchQuery, activeTab, currentPage]);

  useEffect(() => {
    if (hasQueried) {
      loadDocuments();
    }
  }, [currentPage]);

  useEffect(() => {
    if (!hasQueried) {
      return;
    }
    if (currentPage !== 1) {
      setCurrentPage(1);
      return;
    }
    loadDocuments();
  }, [activeTab]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedModule, searchQuery, activeTab]);

  useEffect(() => {
    ingestionApi.getModules()
      .then(res => {
        if (res.data && res.data.modules) {
          setModules(res.data.modules);
        }
      })
      .catch(err => console.error(err));
  }, []);

  const handlePreview = async (doc: any) => {
    setPreviewDoc(doc);
    setPreviewContent('加载中...');
    
    try {
      const response = await ingestionApi.getDocumentContent(doc.id);
      if (response.data && response.data.content) {
        setPreviewContent(response.data.content);
      }
    } catch (err) {
      console.error('Failed to load document content:', err);
      setPreviewContent('加载文档内容失败，请稍后重试。');
    }
  };

  const handleDelete = async () => {
    if (!deleteDoc) return;
    
    setDeleting(true);
    try {
      await ingestionApi.deleteDocument(deleteDoc.id);
      setDeleteDoc(null);
      loadDocuments();
    } catch (err) {
      console.error('Failed to delete document:', err);
      alert('删除文档失败，请稍后重试。');
    } finally {
      setDeleting(false);
    }
  };

  const handleSearch = () => {
    if (currentPage === 1) {
      loadDocuments();
      return;
    }
    setCurrentPage(1);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleTabChange = (tab: 'prd' | 'sop') => {
    if (tab === activeTab) {
      return;
    }
    setActiveTab(tab);
    if (hasQueried) {
      setDocuments([]);
      setTotalDocs(0);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 bg-slate-50">
      {showUpload && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h2 className="text-xl font-bold text-slate-900">上传文档</h2>
              <button
                onClick={() => setShowUpload(false)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
              <DataIngestion />
            </div>
          </div>
        </div>
      )}
      
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">知识库管理</h1>
          </div>
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Upload className="w-4 h-4" />
            上传
          </button>
        </div>

        <div className="flex border-b border-slate-200">
          <button
            onClick={() => handleTabChange('prd')}
            className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${
              activeTab === 'prd'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              PRD 知识库
            </div>
          </button>
          <button
            onClick={() => handleTabChange('sop')}
            className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${
              activeTab === 'sop'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              SOP 知识库
            </div>
          </button>
        </div>

        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input 
              type="text" 
              placeholder="搜索文档名称..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="w-full h-11 pl-10 pr-4 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white text-slate-700"
            />
          </div>
          <div className="w-full md:w-48">
            <select 
              value={selectedModule}
              onChange={(e) => setSelectedModule(e.target.value)}
              className="w-full h-11 border border-slate-300 rounded-lg px-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white text-slate-700"
            >
              <option value="全部">全部模块</option>
              {modules.map(mod => (
                <option key={mod} value={mod}>{mod}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleSearch}
            disabled={loading}
            className="w-full md:w-auto h-11 flex items-center justify-center gap-2 px-5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Search className="w-4 h-4" />
            查询
          </button>
        </div>

        {activeTab === 'prd' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {loading ? (
                <div className="col-span-full">
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
                    <h3 className="text-lg font-medium text-slate-700 mb-2">查询中...</h3>
                  </div>
                </div>
              ) : !hasQueried ? (
                <div className="col-span-full">
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
                    <Database className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-700 mb-2">请先点击查询</h3>
                    <p className="text-slate-500">设置筛选条件后，点击右侧【查询】按钮加载文档</p>
                  </div>
                </div>
              ) : documents.length === 0 ? (
                <div className="col-span-full">
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
                    <Database className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-700 mb-2">暂无 PRD 文档</h3>
                    <p className="text-slate-500">前往【数据投喂】上传第一个 PRD 文档</p>
                  </div>
                </div>
              ) : (
                documents.map((doc: any) => (
                  <div 
                    key={doc.id} 
                    className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                          <FileText className="w-6 h-6" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-slate-800 truncate" title={doc.filename}>
                            {doc.filename}
                          </h3>
                          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">
                            {doc.module}
                          </span>
                        </div>
                      </div>
                      {doc.is_latest && (
                        <span className="shrink-0 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded">
                          最新
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-sm text-slate-500 mb-4">
                      <span className="flex items-center gap-1">
                        <BookOpen className="w-4 h-4" />
                        {doc.module}
                      </span>
                      <span>{new Date(doc.upload_time).toLocaleDateString()}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handlePreview(doc)}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                        在线预览
                      </button>
                      <button
                        onClick={() => setDeleteDoc(doc)}
                        className="flex items-center justify-center px-3 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center justify-between px-1">
              <span className="text-sm text-slate-500">
                共 {totalDocs} 个 PRD 文档
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1 || loading}
                  className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ‹
                </button>
                {Array.from({ length: Math.ceil(totalDocs / 6) || 1 }, (_, i) => i + 1).map(page => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      page === currentPage
                        ? 'bg-indigo-600 text-white'
                        : 'border border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {page}
                  </button>
                ))}
                <button
                  onClick={() => setCurrentPage(p => Math.min(Math.ceil(totalDocs / 6) || 1, p + 1))}
                  disabled={currentPage === (Math.ceil(totalDocs / 6) || 1) || loading}
                  className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ›
                </button>
              </div>
            </div>
          </>
        )}

        {activeTab === 'sop' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {loading ? (
            <div className="col-span-full">
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
                <h3 className="text-lg font-medium text-slate-700 mb-2">查询中...</h3>
              </div>
            </div>
          ) : !hasQueried ? (
            <div className="col-span-full">
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
                <Database className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-700 mb-2">请先点击查询</h3>
                <p className="text-slate-500">设置筛选条件后，点击右侧【查询】按钮加载文档</p>
              </div>
            </div>
          ) : documents.length === 0 ? (
            <div className="col-span-full">
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
                <Database className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-700 mb-2">暂无 SOP 文档</h3>
                <p className="text-slate-500">前往【数据投喂】上传第一个 SOP 文档</p>
              </div>
            </div>
          ) : (
                documents.map((doc: any) => (
                  <div 
                    key={doc.id} 
                    className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
                          <BookOpen className="w-6 h-6" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-slate-800 truncate" title={doc.filename}>
                            {doc.filename}
                          </h3>
                          <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">
                            {doc.module}
                          </span>
                        </div>
                      </div>
                      {doc.is_latest && (
                        <span className="shrink-0 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded">
                          最新
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-sm text-slate-500 mb-4">
                      <span className="flex items-center gap-1">
                        <BookOpen className="w-4 h-4" />
                        {doc.module}
                      </span>
                      <span>{new Date(doc.upload_time).toLocaleDateString()}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handlePreview(doc)}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-emerald-600 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                        在线预览
                      </button>
                      <button
                        onClick={() => setDeleteDoc(doc)}
                        className="flex items-center justify-center px-3 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center justify-between px-1">
              <span className="text-sm text-slate-500">
                共 {totalDocs} 个 SOP 文档
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1 || loading}
                  className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ‹
                </button>
                {Array.from({ length: Math.ceil(totalDocs / 6) || 1 }, (_, i) => i + 1).map(page => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      page === currentPage
                        ? 'bg-emerald-600 text-white'
                        : 'border border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {page}
                  </button>
                ))}
                <button
                  onClick={() => setCurrentPage(p => Math.min(Math.ceil(totalDocs / 6) || 1, p + 1))}
                  disabled={currentPage === (Math.ceil(totalDocs / 6) || 1) || loading}
                  className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ›
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {previewDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800">{previewDoc.filename}</h3>
                  <p className="text-xs text-slate-500">{previewDoc.module}</p>
                </div>
              </div>
              <button
                onClick={() => setPreviewDoc(null)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <pre className="whitespace-pre-wrap font-mono text-sm text-slate-700 bg-slate-50 p-4 rounded-lg">
                {previewContent}
              </pre>
            </div>
          </div>
        </div>
      )}

      {deleteDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-red-100 rounded-full">
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">确认删除</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    确定要删除文档 "{deleteDoc.filename}" 吗？
                  </p>
                </div>
              </div>
              <p className="text-sm text-slate-500 mb-6">
                此操作不可撤销，文档将从系统中永久删除。
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteDoc(null)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <span className="animate-pulse">删除中...</span>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      确认删除
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
