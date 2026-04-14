import { useState } from 'react';
import Sidebar from './components/Sidebar';
import ReviewWorkbench from './components/ReviewWorkbench';
import KnowledgeBase from './components/KnowledgeBase';
import KnowledgeChat from './components/KnowledgeChat';
import PromptManagement from './components/PromptManagement';

function App() {
  const [activeTab, setActiveTab] = useState<'workbench' | 'knowledge' | 'chat' | 'prompt'>('workbench');
  const [knowledgeFocus, setKnowledgeFocus] = useState<{ module: string | null; key: number }>({
    module: null,
    key: 0
  });

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 overflow-hidden flex flex-col">
        <div className={activeTab === 'workbench' ? 'h-full' : 'hidden'}>
          <ReviewWorkbench
            onNavigateKnowledge={(module?: string) => {
              setKnowledgeFocus({ module: module || '全部', key: Date.now() });
              setActiveTab('knowledge');
            }}
          />
        </div>
        <div className={activeTab === 'knowledge' ? 'h-full' : 'hidden'}>
          <KnowledgeBase focusModule={knowledgeFocus.module} focusKey={knowledgeFocus.key} />
        </div>
        <div className={activeTab === 'chat' ? 'h-full' : 'hidden'}>
          <KnowledgeChat />
        </div>
        <div className={activeTab === 'prompt' ? 'h-full' : 'hidden'}>
          <PromptManagement />
        </div>
      </main>
    </div>
  );
}

export default App;
