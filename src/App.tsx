import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import { authApi } from './api';

const loadReviewWorkbench = () => import('./components/ReviewWorkbench');
const loadKnowledgeBase = () => import('./components/KnowledgeBase');
const loadKnowledgeChat = () => import('./components/KnowledgeChat');
const loadPromptManagement = () => import('./components/PromptManagement');
const loadPermissionManagement = () => import('./components/PermissionManagement');

const ReviewWorkbench = lazy(loadReviewWorkbench);
const KnowledgeBase = lazy(loadKnowledgeBase);
const KnowledgeChat = lazy(loadKnowledgeChat);
const PromptManagement = lazy(loadPromptManagement);
const PermissionManagement = lazy(loadPermissionManagement);

type TabKey = 'workbench' | 'knowledge' | 'chat' | 'prompt' | 'permission';

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('workbench');
  const [role, setRole] = useState<'super_admin' | 'business'>('super_admin');
  const [allowedModules, setAllowedModules] = useState<string[]>([]);
  const [knowledgeFocus, setKnowledgeFocus] = useState<{ module: string | null; key: number }>({
    module: null,
    key: 0
  });
  const [visibleTabs, setVisibleTabs] = useState<TabKey[]>(['workbench', 'knowledge', 'chat', 'prompt']);

  const prefetchTab = useMemo(
    () => (tab: TabKey) => {
      if (tab === 'workbench') return loadReviewWorkbench();
      if (tab === 'knowledge') return loadKnowledgeBase();
      if (tab === 'chat') return loadKnowledgeChat();
      if (tab === 'prompt') return loadPromptManagement();
      return loadPermissionManagement();
    },
    []
  );

  useEffect(() => {
    authApi.getPermissions()
      .then((res) => {
        const nextRole = (res.data?.role || 'super_admin') as 'super_admin' | 'business';
        const modules = res.data?.allowed_modules || [];
        setRole(nextRole);
        setAllowedModules(modules);
        if (nextRole === 'business') {
          setVisibleTabs(['knowledge']);
          setActiveTab('knowledge');
          if (modules.length > 0) {
            setKnowledgeFocus({ module: modules[0], key: Date.now() });
          }
        } else {
          setVisibleTabs(['workbench', 'knowledge', 'chat', 'prompt', 'permission']);
        }
      })
      .catch(() => {
        setRole('super_admin');
        setVisibleTabs(['workbench', 'knowledge', 'chat', 'prompt', 'permission']);
      });
  }, []);

  useEffect(() => {
    const idle = (window as any).requestIdleCallback as
      | ((cb: () => void) => number)
      | undefined;
    const schedule = idle
      ? idle(() => {
          prefetchTab('knowledge');
          prefetchTab('chat');
          prefetchTab('prompt');
          prefetchTab('permission');
        })
      : window.setTimeout(() => {
          prefetchTab('knowledge');
          prefetchTab('chat');
          prefetchTab('prompt');
          prefetchTab('permission');
        }, 1200);
    return () => {
      if (typeof schedule === 'number') {
        if (idle && (window as any).cancelIdleCallback) {
          (window as any).cancelIdleCallback(schedule);
        } else {
          window.clearTimeout(schedule);
        }
      }
    };
  }, [prefetchTab]);

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} onPrefetchTab={prefetchTab} visibleTabs={visibleTabs} />
      <main className="flex-1 overflow-hidden flex flex-col">
        {role === 'business' && (
          <div className="px-4 py-2 text-xs bg-amber-50 border-b border-amber-200 text-amber-700">
            当前为业务线权限，仅可访问知识库上传/查询。可用模块：{allowedModules.join('、') || '无'}
          </div>
        )}
        <Suspense
          fallback={
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">页面加载中...</div>
          }
        >
          <div className="h-full">
            {activeTab === 'workbench' && (
              <ReviewWorkbench
                onNavigateKnowledge={(module?: string) => {
                  setKnowledgeFocus({ module: module || '全部', key: Date.now() });
                  setActiveTab('knowledge');
                }}
              />
            )}
            {activeTab === 'knowledge' && (
              <KnowledgeBase focusModule={knowledgeFocus.module} focusKey={knowledgeFocus.key} />
            )}
            {activeTab === 'chat' && <KnowledgeChat />}
            {activeTab === 'prompt' && <PromptManagement />}
            {activeTab === 'permission' && <PermissionManagement />}
          </div>
        </Suspense>
      </main>
    </div>
  );
}

export default App;
