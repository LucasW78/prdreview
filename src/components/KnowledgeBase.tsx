import React from 'react';
import { BookOpen, FileText, Search, Database, X, Eye, Trash2, AlertTriangle, RefreshCw } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { ingestionApi } from '../api';

export default function KnowledgeBase() {
  const [modules, setModules] = useState<string[]>(['支付模块', '任务调度', '用户中心']);
  const [selectedModule, setSelectedModule] = useState<string>('全部');
  const [documents, setDocuments] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'prd' | 'sop'>('prd');
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [deleteDoc, setDeleteDoc] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadDocuments = useCallback(() => {
    ingestionApi.getHistory()
      .then(res => {
        if (res.data && res.data.documents) {
          console.log('Documents from API:', res.data.documents);
          setDocuments(res.data.documents);
        }
      })
      .catch(err => console.error(err));
  }, []);

  useEffect(() => {
    ingestionApi.getModules()
      .then(res => {
        if (res.data && res.data.modules) {
          setModules(res.data.modules);
        }
      })
      .catch(err => console.error(err));

    loadDocuments();
  }, [loadDocuments, refreshKey]);

  const filteredDocuments = documents.filter(doc => {
    const moduleMatch = selectedModule === '全部' || doc.module === selectedModule;
    const searchMatch = searchQuery === '' || 
      doc.filename.toLowerCase().includes(searchQuery.toLowerCase());
    return moduleMatch && searchMatch;
  });

  const prdDocuments = filteredDocuments.filter(doc => {
    console.log('Checking PRD doc:', doc.filename, 'doc_type:', doc.doc_type);
    return doc.doc_type === 'prd' || !doc.doc_type;
  });
  const sopDocuments = filteredDocuments.filter(doc => {
    console.log('Checking SOP doc:', doc.filename, 'doc_type:', doc.doc_type);
    return doc.doc_type === 'sop';
  });

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
      setRefreshKey(prev => prev + 1);
    } catch (err) {
      console.error('Failed to delete document:', err);
      alert('删除文档失败，请稍后重试。');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 bg-slate-50">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">知识库管理</h1>
            <p className="text-slate-500 mt-1">浏览和管理已上传的 PRD 与 SOP 文档。</p>
          </div>
          <button
            onClick={() => setRefreshKey(prev => prev + 1)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            刷新
          </button>
        </div>

        <div className="flex border-b border-slate-200">
          <button
            onClick={() => setActiveTab('prd')}
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
            onClick={() => setActiveTab('sop')}
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
              className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white text-slate-700"
            />
          </div>
          <div className="w-full md:w-48">
            <select 
              value={selectedModule}
              onChange={(e) => setSelectedModule(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white text-slate-700"
            >
              <option value="全部">全部模块</option>
              {modules.map(mod => (
                <option key={mod} value={mod}>{mod}</option>
              ))}
            </select>
          </div>
        </div>

        {activeTab === 'prd' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {prdDocuments.length === 0 ? (
                <div className="col-span-full">
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
                    <Database className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-700 mb-2">暂无 PRD 文档</h3>
                    <p className="text-slate-500">前往【数据投喂】上传第一个 PRD 文档</p>
                  </div>
                </div>
              ) : (
                prdDocuments.map((doc: any) => (
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
            <div className="text-center text-sm text-slate-500">
              共 {prdDocuments.length} 个 PRD 文档
            </div>
          </>
        )}

        {activeTab === 'sop' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sopDocuments.length === 0 ? (
            <div className="col-span-full">
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
                <Database className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-700 mb-2">暂无 SOP 文档</h3>
                <p className="text-slate-500">前往【数据投喂】上传第一个 SOP 文档</p>
              </div>
            </div>
          ) : (
                sopDocuments.map((doc: any) => (
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
            <div className="text-center text-sm text-slate-500">
              共 {sopDocuments.length} 个 SOP 文档
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
