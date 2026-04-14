import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000/api/v1';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  const userEmail = localStorage.getItem('rag_user_email');
  const token = localStorage.getItem('rag_access_token');
  const headers = (config.headers || {}) as any;
  if (userEmail) {
    headers['X-User-Email'] = userEmail;
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  config.headers = headers;
  return config;
});

export const ingestionApi = {
  getModules: () => apiClient.get('/ingestion/modules'),
  getHistory: (params?: { module?: string; keyword?: string; doc_type?: string; page?: number }) =>
    apiClient.get('/ingestion/history', { params }),
  uploadDocument: (formData: FormData) => 
    apiClient.post('/ingestion/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }),
  getDocumentContent: (docId: number) => 
    apiClient.get(`/ingestion/document/${docId}`),
  deleteDocument: (docId: number) => 
    apiClient.delete(`/ingestion/document/${docId}`),
};

export const reviewApi = {
  analyze: (data: { module: string; content: string; sop_ids?: string[] }) => 
    apiClient.post('/review/analyze', data),
  listTasks: (params?: { page?: number; page_size?: number; include_snapshots?: boolean }) =>
    apiClient.get('/review/tasks', { params }),
  deleteTask: (taskId: number) =>
    apiClient.delete(`/review/tasks/${taskId}`),
  getTaskStatus: (taskId: number) =>
    apiClient.get(`/review/tasks/${taskId}`),
  saveSnapshot: (taskId: number, data: { module?: string; processing_time_sec?: number; blocks?: any[]; conflicts?: any[]; supplementaryInfo?: any[] }) =>
    apiClient.post(`/review/tasks/${taskId}/snapshots`, data),
  rerunTask: (taskId: number, data: { module?: string; content: string }) =>
    apiClient.post(`/review/tasks/${taskId}/rerun`, data),
  getSystemPrompt: () =>
    apiClient.get('/review/system-prompt'),
  applySystemPrompt: (prompt: string) =>
    apiClient.put('/review/system-prompt', { prompt }),
  merge: (taskId: number, finalContent: string) => 
    apiClient.post(`/review/merge/${taskId}`, { finalContent }),
};

export const chatApi = {
  ask: (data: { query: string; module: string; history: any[] }, signal?: AbortSignal) =>
    apiClient.post('/chat/ask', data, { signal }),
};

export const authApi = {
  getPermissions: () => apiClient.get('/auth/permissions'),
  getPermissionConfig: () => apiClient.get('/auth/permission-config'),
  updatePermissionConfig: (data: { super_admin_emails: string[]; business_line_members: Record<string, string[]> }) =>
    apiClient.put('/auth/permission-config', data),
};

export default apiClient;
