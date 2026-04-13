import { FileSearch, LayoutDashboard, BookOpen, MessageSquare, Settings2 } from 'lucide-react';

export default function Sidebar({ activeTab, setActiveTab }: { activeTab: string, setActiveTab: (tab: any) => void }) {
  return (
    <div className="w-64 bg-slate-900 text-slate-300 flex flex-col">
      <div className="p-4 flex items-center space-x-3 text-white font-semibold text-lg border-b border-slate-800">
        <LayoutDashboard className="w-6 h-6 text-indigo-400" />
        <span>RAG 评审专家</span>
      </div>
      <nav className="flex-1 py-4 space-y-1">
        <button
          onClick={() => setActiveTab('workbench')}
          className={`w-full flex items-center space-x-3 px-4 py-3 transition-colors ${activeTab === 'workbench' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}
        >
          <FileSearch className="w-5 h-5" />
          <span>评审工作台</span>
        </button>
        <button
          onClick={() => setActiveTab('knowledge')}
          className={`w-full flex items-center space-x-3 px-4 py-3 transition-colors ${activeTab === 'knowledge' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}
        >
          <BookOpen className="w-5 h-5" />
          <span>知识库管理</span>
        </button>
        <button
          onClick={() => setActiveTab('chat')}
          className={`w-full flex items-center space-x-3 px-4 py-3 transition-colors ${activeTab === 'chat' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}
        >
          <MessageSquare className="w-5 h-5" />
          <span>智能问答</span>
        </button>
        <button
          onClick={() => setActiveTab('prompt')}
          className={`w-full flex items-center space-x-3 px-4 py-3 transition-colors ${activeTab === 'prompt' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}
        >
          <Settings2 className="w-5 h-5" />
          <span>提示词管理</span>
        </button>
      </nav>
    </div>
  );
}
