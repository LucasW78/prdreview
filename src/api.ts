import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000/api/v1';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
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
  listTasks: () =>
    apiClient.get('/review/tasks'),
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

export default apiClient;
