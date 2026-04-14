import React from 'react';
import { UploadCloud, FileText, BookOpen, CheckCircle2, AlertCircle } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { ingestionApi } from '../api';

export default function DataIngestion() {
  const [modules, setModules] = useState<string[]>(['支付模块', '任务调度', '用户中心']);
  
  const [prdUploading, setPrdUploading] = useState(false);
  const [prdUploaded, setPrdUploaded] = useState(false);
  const [prdError, setPrdError] = useState<string | null>(null);
  const [selectedModule, setSelectedModule] = useState('支付模块');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  const [sopUploading, setSopUploading] = useState(false);
  const [sopUploaded, setSopUploaded] = useState(false);
  const [sopError, setSopError] = useState<string | null>(null);
  const [sopSelectedModule, setSopSelectedModule] = useState('支付模块');
  const [sopSelectedFile, setSopSelectedFile] = useState<File | null>(null);
  
  const prdFileInputRef = useRef<HTMLInputElement>(null);
  const sopFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ingestionApi.getModules()
      .then(res => {
        if (res.data && res.data.modules) {
          setModules(res.data.modules);
          setSelectedModule(res.data.modules[0]);
          setSopSelectedModule(res.data.modules[0]);
        }
      })
      .catch(err => console.error("Failed to fetch modules:", err));
  }, []);

  const handlePrdFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
      setPrdError(null);
      setPrdUploaded(false);
    }
  };

  const handleSopFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSopSelectedFile(e.target.files[0]);
      setSopError(null);
      setSopUploaded(false);
    }
  };

  const handlePrdUpload = async () => {
    if (!selectedFile) {
      setPrdError('请先选择要上传的文件');
      return;
    }

    setPrdUploading(true);
    setPrdError(null);
    setPrdUploaded(false);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('module', selectedModule);
      formData.append('doc_type', 'prd');

      const response = await ingestionApi.uploadDocument(formData);
      console.log("PRD Upload response:", response);
      
      if (response.status === 200) {
        setPrdUploaded(true);
        setSelectedFile(null);
        if (prdFileInputRef.current) prdFileInputRef.current.value = '';
        setTimeout(() => setPrdUploaded(false), 3000);
      } else {
        throw new Error("Upload failed with status " + response.status);
      }
    } catch (err: any) {
      console.error('PRD Upload error details:', err);
      let errorMessage = '上传失败，请重试。';
      
      if (err.response) {
        console.error("Server Error Response:", err.response.data);
        errorMessage = err.response.data?.detail || `服务器错误 (${err.response.status})`;
      } else if (err.request) {
        errorMessage = '无法连接到服务器，请检查后端服务是否启动。';
      } else {
        errorMessage = err.message;
      }
      
      setPrdError(errorMessage);
    } finally {
      setPrdUploading(false);
    }
  };

  const handleSopUpload = async () => {
    if (!sopSelectedFile) {
      setSopError('请先选择要上传的文件');
      return;
    }

    setSopUploading(true);
    setSopError(null);
    setSopUploaded(false);

    try {
      const formData = new FormData();
      formData.append('file', sopSelectedFile);
      formData.append('module', sopSelectedModule);
      formData.append('doc_type', 'sop');

      const response = await ingestionApi.uploadDocument(formData);
      console.log("SOP Upload response:", response);
      
      if (response.status === 200) {
        setSopUploaded(true);
        setSopSelectedFile(null);
        if (sopFileInputRef.current) sopFileInputRef.current.value = '';
        setTimeout(() => setSopUploaded(false), 3000);
      } else {
        throw new Error("Upload failed with status " + response.status);
      }
    } catch (err: any) {
      console.error('SOP Upload error details:', err);
      let errorMessage = '上传失败，请重试。';
      
      if (err.response) {
        console.error("Server Error Response:", err.response.data);
        errorMessage = err.response.data?.detail || `服务器错误 (${err.response.status})`;
      } else if (err.request) {
        errorMessage = '无法连接到服务器，请检查后端服务是否启动。';
      } else {
        errorMessage = err.message;
      }
      
      setSopError(errorMessage);
    } finally {
      setSopUploading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 bg-slate-50">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                <FileText className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-semibold text-slate-800">PRD 知识库上传</h2>
            </div>
            <div className="space-y-4">
              {prdError && (
                <div className="bg-red-50 text-red-700 p-3 rounded-lg flex items-center space-x-2 border border-red-200">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm">{prdError}</span>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">业务模块 <span className="text-red-500">*</span></label>
                <select 
                  value={selectedModule}
                  onChange={(e) => setSelectedModule(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white text-slate-700"
                >
                  {modules.map(mod => (
                    <option key={mod} value={mod}>{mod}</option>
                  ))}
                </select>
              </div>
              
              <div 
                onClick={() => prdFileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 transition-colors cursor-pointer group"
              >
                <input 
                  type="file" 
                  ref={prdFileInputRef} 
                  onChange={handlePrdFileChange} 
                  className="hidden" 
                  accept=".md,.txt" 
                />
                {selectedFile ? (
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <FileText className="w-10 h-10 text-indigo-500" />
                    <p className="text-sm text-slate-700 font-medium truncate max-w-[200px]">{selectedFile.name}</p>
                    <p className="text-xs text-slate-400">{(selectedFile.size / 1024).toFixed(2)} KB</p>
                  </div>
                ) : (
                  <>
                    <UploadCloud className="w-10 h-10 text-slate-400 mx-auto mb-3 group-hover:text-indigo-500 transition-colors" />
                    <p className="text-sm text-slate-600 font-medium">点击此处选择文件</p>
                    <p className="text-xs text-slate-400 mt-1">当前 MVP 仅支持 .md, .txt</p>
                  </>
                )}
              </div>
              
              <button 
                onClick={handlePrdUpload}
                disabled={prdUploading || !selectedFile}
                className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {prdUploading ? (
                  <span className="animate-pulse">上传并解析中...</span>
                ) : prdUploaded ? (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    <span>上传成功，已更新索引</span>
                  </>
                ) : (
                  <span>确认上传</span>
                )}
              </button>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
                <BookOpen className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-semibold text-slate-800">SOP 规范库上传</h2>
            </div>
            <div className="space-y-4">
              {sopError && (
                <div className="bg-red-50 text-red-700 p-3 rounded-lg flex items-center space-x-2 border border-red-200">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm">{sopError}</span>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">业务模块 <span className="text-red-500">*</span></label>
                <select 
                  value={sopSelectedModule}
                  onChange={(e) => setSopSelectedModule(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white text-slate-700"
                >
                  {modules.map(mod => (
                    <option key={mod} value={mod}>{mod}</option>
                  ))}
                </select>
              </div>
              
              <div 
                onClick={() => sopFileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 transition-colors cursor-pointer group"
              >
                <input 
                  type="file" 
                  ref={sopFileInputRef} 
                  onChange={handleSopFileChange} 
                  className="hidden" 
                  accept=".md,.txt" 
                />
                {sopSelectedFile ? (
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <BookOpen className="w-10 h-10 text-emerald-500" />
                    <p className="text-sm text-slate-700 font-medium truncate max-w-[200px]">{sopSelectedFile.name}</p>
                    <p className="text-xs text-slate-400">{(sopSelectedFile.size / 1024).toFixed(2)} KB</p>
                  </div>
                ) : (
                  <>
                    <UploadCloud className="w-10 h-10 text-slate-400 mx-auto mb-3 group-hover:text-emerald-500 transition-colors" />
                    <p className="text-sm text-slate-600 font-medium">点击此处选择文件</p>
                    <p className="text-xs text-slate-400 mt-1">当前 MVP 仅支持 .md, .txt</p>
                  </>
                )}
              </div>
              
              <button 
                onClick={handleSopUpload}
                disabled={sopUploading || !sopSelectedFile}
                className="w-full bg-emerald-600 text-white py-2.5 rounded-lg font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sopUploading ? (
                  <span className="animate-pulse">上传并解析中...</span>
                ) : sopUploaded ? (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    <span>上传成功，已更新索引</span>
                  </>
                ) : (
                  <span>确认上传</span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
