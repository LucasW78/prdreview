import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Plus, Trash2 } from 'lucide-react';
import { authApi } from '../api';

type BizMap = Record<string, string[]>;

export default function PermissionManagement() {
  const [superAdmins, setSuperAdmins] = useState<string[]>([]);
  const [bizMap, setBizMap] = useState<BizMap>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState('');
  const [isAddBizModalOpen, setIsAddBizModalOpen] = useState(false);
  const [newBizModuleName, setNewBizModuleName] = useState('');

  const sortedModules = useMemo(() => Object.keys(bizMap).sort(), [bizMap]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await authApi.getPermissionConfig();
      setSuperAdmins(res.data?.super_admin_emails || []);
      setBizMap(res.data?.business_line_members || {});
    } catch (e) {
      console.error(e);
      setHint('加载失败，请检查权限或后端状态');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const payload = {
        super_admin_emails: superAdmins.map((i) => i.trim()).filter(Boolean),
        business_line_members: Object.fromEntries(
          Object.entries(bizMap).map(([k, v]) => [k.trim(), v.map((i) => i.trim()).filter(Boolean)]).filter(([k]) => !!k)
        ),
      };
      const res = await authApi.updatePermissionConfig(payload);
      setSuperAdmins(res.data?.super_admin_emails || []);
      setBizMap(res.data?.business_line_members || {});
      setHint('权限配置已应用');
      window.setTimeout(() => setHint(''), 1500);
    } catch (e) {
      console.error(e);
      setHint('保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmAddBusinessLine = () => {
    const m = newBizModuleName.trim();
    if (!m) return;
    setBizMap((prev) => (prev[m] ? prev : { ...prev, [m]: [] }));
    setNewBizModuleName('');
    setIsAddBizModalOpen(false);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 px-6 pt-6 pb-4">
      <div className="max-w-7xl mx-auto bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600" />
            <h1 className="text-2xl font-bold text-slate-900">权限配置管理</h1>
          </div>
          <div className="flex items-center gap-2">
            {hint && <span className="text-xs text-emerald-600">{hint}</span>}
            <button onClick={loadConfig} disabled={loading || saving} className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50">刷新</button>
            <button onClick={saveConfig} disabled={loading || saving} className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">{saving ? '保存中...' : '应用配置'}</button>
          </div>
        </div>

        <div className="border border-slate-200 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">超级管理员名单（邮箱）</h2>
          <div className="space-y-2">
            {superAdmins.map((email, idx) => (
              <div key={`${idx}-${email}`} className="flex items-center gap-2">
                <input
                  value={email}
                  onChange={(e) => setSuperAdmins((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))}
                  className="flex-1 h-10 px-3 border border-slate-300 rounded-lg text-sm"
                  placeholder="admin@company.com"
                />
                <button
                  onClick={() => setSuperAdmins((prev) => prev.filter((_, i) => i !== idx))}
                  className="p-2 rounded-lg border border-slate-300 text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button onClick={() => setSuperAdmins((prev) => [...prev, ''])} className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-slate-300 rounded-md hover:bg-slate-50">
              <Plus className="w-3 h-3" />
              添加管理员
            </button>
          </div>
        </div>

        <div className="border border-slate-200 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">业务线名单（模块 -&gt; 邮箱）</h2>
          <div className="space-y-3">
            {sortedModules.map((module) => (
              <div key={module} className="border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    value={module}
                    readOnly
                    className="w-56 h-9 px-3 border border-slate-200 rounded-lg bg-slate-50 text-sm text-slate-700"
                  />
                  <button
                    onClick={() => setBizMap((prev) => {
                      const next = { ...prev };
                      delete next[module];
                      return next;
                    })}
                    className="p-2 rounded-lg border border-slate-300 text-red-500 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {(bizMap[module] || []).map((email, idx) => (
                  <div key={`${module}-${idx}`} className="flex items-center gap-2">
                    <input
                      value={email}
                      onChange={(e) => setBizMap((prev) => ({
                        ...prev,
                        [module]: (prev[module] || []).map((v, i) => (i === idx ? e.target.value : v))
                      }))}
                      className="flex-1 h-9 px-3 border border-slate-300 rounded-lg text-sm"
                      placeholder="biz_user@company.com"
                    />
                    <button
                      onClick={() => setBizMap((prev) => ({
                        ...prev,
                        [module]: (prev[module] || []).filter((_, i) => i !== idx)
                      }))}
                      className="p-2 rounded-lg border border-slate-300 text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button onClick={() => setBizMap((prev) => ({ ...prev, [module]: [...(prev[module] || []), ''] }))} className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-slate-300 rounded-md hover:bg-slate-50">
                  <Plus className="w-3 h-3" />
                  添加成员
                </button>
              </div>
            ))}
            <button
              onClick={() => {
                setNewBizModuleName('');
                setIsAddBizModalOpen(true);
              }}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-slate-300 rounded-md hover:bg-slate-50"
            >
              <Plus className="w-3 h-3" />
              添加业务线
            </button>
          </div>
        </div>
      </div>

      {isAddBizModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/35 p-4">
          <div className="bg-white w-full max-w-sm rounded-xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
              <h3 className="text-base font-semibold text-slate-800">新增业务线</h3>
            </div>
            <div className="px-4 py-3">
              <label className="text-xs text-slate-500 block mb-1">请输入业务线模块名称</label>
              <input
                value={newBizModuleName}
                onChange={(e) => setNewBizModuleName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConfirmAddBusinessLine();
                  }
                }}
                autoFocus
                className="w-full h-9 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                placeholder="例如：支付模块"
              />
            </div>
            <div className="px-4 py-3 border-t border-slate-200 bg-white flex justify-end gap-2">
              <button
                onClick={() => {
                  setIsAddBizModalOpen(false);
                  setNewBizModuleName('');
                }}
                className="px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmAddBusinessLine}
                disabled={!newBizModuleName.trim()}
                className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
