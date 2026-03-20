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
  getHistory: () => apiClient.get('/ingestion/history'),
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
  merge: (taskId: number, finalContent: string) => 
    apiClient.post(`/review/merge/${taskId}`, { finalContent }),
};

export default apiClient;
