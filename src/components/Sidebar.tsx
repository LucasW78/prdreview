import { FileSearch, LayoutDashboard, BookOpen, MessageSquare, Settings2, ShieldCheck } from 'lucide-react';

type TabKey = 'workbench' | 'knowledge' | 'chat' | 'prompt' | 'permission';

interface SidebarProps {
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  onPrefetchTab?: (tab: TabKey) => void;
  visibleTabs?: TabKey[];
}

export default function Sidebar({ activeTab, setActiveTab, onPrefetchTab, visibleTabs = ['workbench', 'knowledge', 'chat', 'prompt', 'permission'] }: SidebarProps) {
  const canShow = (tab: TabKey) => visibleTabs.includes(tab);
  return (
    <div className="w-64 bg-slate-900 text-slate-300 flex flex-col">
      <div className="p-4 flex items-center space-x-3 text-white font-semibold text-lg border-b border-slate-800">
        <LayoutDashboard className="w-6 h-6 text-indigo-400" />
        <span>RAG 评审专家</span>
      </div>
      <nav className="flex-1 py-4 space-y-1">
        {canShow('workbench') && <button
          onClick={() => setActiveTab('workbench')}
          onMouseEnter={() => onPrefetchTab?.('workbench')}
          onFocus={() => onPrefetchTab?.('workbench')}
          className={`w-full flex items-center space-x-3 px-4 py-3 transition-colors ${activeTab === 'workbench' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}
        >
          <FileSearch className="w-5 h-5" />
          <span>评审工作台</span>
        </button>}
        {canShow('knowledge') && <button
          onClick={() => setActiveTab('knowledge')}
          onMouseEnter={() => onPrefetchTab?.('knowledge')}
          onFocus={() => onPrefetchTab?.('knowledge')}
          className={`w-full flex items-center space-x-3 px-4 py-3 transition-colors ${activeTab === 'knowledge' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}
        >
          <BookOpen className="w-5 h-5" />
          <span>知识库管理</span>
        </button>}
        {canShow('chat') && <button
          onClick={() => setActiveTab('chat')}
          onMouseEnter={() => onPrefetchTab?.('chat')}
          onFocus={() => onPrefetchTab?.('chat')}
          className={`w-full flex items-center space-x-3 px-4 py-3 transition-colors ${activeTab === 'chat' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}
        >
          <MessageSquare className="w-5 h-5" />
          <span>智能问答</span>
        </button>}
        {canShow('prompt') && <button
          onClick={() => setActiveTab('prompt')}
          onMouseEnter={() => onPrefetchTab?.('prompt')}
          onFocus={() => onPrefetchTab?.('prompt')}
          className={`w-full flex items-center space-x-3 px-4 py-3 transition-colors ${activeTab === 'prompt' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}
        >
          <Settings2 className="w-5 h-5" />
          <span>提示词管理</span>
        </button>}
        {canShow('permission') && <button
          onClick={() => setActiveTab('permission')}
          onMouseEnter={() => onPrefetchTab?.('permission')}
          onFocus={() => onPrefetchTab?.('permission')}
          className={`w-full flex items-center space-x-3 px-4 py-3 transition-colors ${activeTab === 'permission' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}
        >
          <ShieldCheck className="w-5 h-5" />
          <span>权限管理</span>
        </button>}
      </nav>
    </div>
  );
}
